/**
 * Integration tests for /api/images routes.
 *
 * sharp, @prisma/client, storage, face validation, and similarity are mocked.
 * The express app is constructed inline (not from app.ts) to avoid
 * side effects from the entry-point module evaluation.
 */

// ---------------------------------------------------------------------------
// Mocks — registered before any require/import
// ---------------------------------------------------------------------------

jest.mock('sharp', () => {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['metadata', 'greyscale', 'convolve', 'raw', 'toBuffer', 'clone', 'resize']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  const mock = jest.fn().mockReturnValue(chain);
  (mock as unknown as Record<string, unknown>).__chain = chain;
  return mock;
});

jest.mock('@prisma/client', () => {
  const image = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  };
  const imageVariant = {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  };
  return {
    PrismaClient: jest.fn().mockImplementation(() => ({ image, imageVariant, $queryRaw: jest.fn() })),
    __image: image,
    __imageVariant: imageVariant,
  };
});

jest.mock('../services/storage', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://cdn.example.com/images/test.jpg'),
  deleteObject: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../validators/faceValidator', () => ({
  validateFaces: jest.fn().mockResolvedValue({ valid: true }),
}));

jest.mock('../validators/similarityValidator', () => ({
  computePHash: jest.fn().mockResolvedValue('0'.repeat(64)),
  checkSimilarity: jest.fn().mockResolvedValue({ similar: false }),
}));

jest.mock('../queue/index', () => ({
  redisConnection: { host: 'localhost', port: 6379 },
  conversionQueue: { add: jest.fn().mockResolvedValue({ id: 'job-1' }) },
  compressionQueue: { add: jest.fn().mockResolvedValue({ id: 'job-2' }) },
  variantQueue: { add: jest.fn().mockResolvedValue({ id: 'job-3' }) },
}));

// The controller imports prisma from utils/prisma — mock it to use the same mock object
const { PrismaClient: MockPrisma } = require('@prisma/client');
jest.mock('../utils/prisma', () => ({
  prisma: new MockPrisma(),
}));

// ---------------------------------------------------------------------------
// Build a test app from constituent parts (not app.ts) to stay isolated
// ---------------------------------------------------------------------------

import express from 'express';
import cors from 'cors';

// Load routes via require so mocks are active
// eslint-disable-next-line @typescript-eslint/no-require-imports
const imageRoutes = require('../routes/images').default as express.Router;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const errorHandler = require('../middleware/errorHandler').default as express.ErrorRequestHandler;

const testApp = express();
testApp.use(cors());
testApp.use(express.json());
testApp.use('/api/images', imageRoutes);
testApp.use(errorHandler);

import request from 'supertest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SharpChain = Record<string, jest.Mock>;
type DbMocks = Record<string, jest.Mock>;

function getChain(): SharpChain {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('sharp') as jest.Mock & { __chain: SharpChain }).__chain;
}

function getDb(): DbMocks {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@prisma/client') as { __image: DbMocks }).__image;
}

function getStorage() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../services/storage') as { uploadBuffer: jest.Mock; deleteObject: jest.Mock };
}

const VALID_META = { format: 'jpeg', width: 800, height: 800 };

function sharpPixels() {
  const data = Buffer.alloc(100);
  for (let i = 0; i < 100; i++) data[i] = i % 2 === 0 ? 200 : 0;
  return { data, info: { channels: 1 } };
}

const DB_IMAGE = {
  id: 'uuid-1',
  originalName: 'photo.jpg',
  storedKey: null,
  url: null,
  mimeType: 'image/jpeg',
  sizeBytes: 12345,
  widthPx: null,
  heightPx: null,
  status: 'PROCESSING',
  rejectionReason: null,
  pHash: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  const chain = getChain();
  chain['metadata']!.mockResolvedValue(VALID_META);
  chain['toBuffer']!.mockResolvedValue(sharpPixels());
  for (const m of ['greyscale', 'convolve', 'raw', 'clone', 'resize']) {
    chain[m]!.mockReturnValue(chain);
  }
});

// ---------------------------------------------------------------------------
// POST /api/images/upload
// ---------------------------------------------------------------------------

describe('POST /api/images/upload', () => {
  it('returns 400 when no file is sent', async () => {
    const res = await request(testApp).post('/api/images/upload');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for an unsupported MIME type (gif)', async () => {
    const res = await request(testApp)
      .post('/api/images/upload')
      .attach('image', Buffer.from('GIF89a'), { filename: 'anim.gif', contentType: 'image/gif' });
    expect(res.status).toBe(400);
  });

  it('returns 202 with PROCESSING status for a valid JPEG (async model)', async () => {
    getDb()['create']!.mockResolvedValue({ ...DB_IMAGE, status: 'PROCESSING' });

    const res = await request(testApp)
      .post('/api/images/upload')
      .attach('image', Buffer.from('fake-jpeg'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('PROCESSING');
  });

  it('persists the sanitized filename to the database', async () => {
    getDb()['create']!.mockResolvedValue(DB_IMAGE);

    await request(testApp)
      .post('/api/images/upload')
      .attach('image', Buffer.from('fake-jpeg'), { filename: 'my-portrait.jpg', contentType: 'image/jpeg' });

    expect(getDb()['create']).toHaveBeenCalledTimes(1);
    const { data } = (getDb()['create']!.mock.calls[0] as [{ data: { originalName: string } }])[0];
    expect(data.originalName).toBe('my-portrait.jpg');
  });
});

// ---------------------------------------------------------------------------
// GET /api/images
// ---------------------------------------------------------------------------

describe('GET /api/images', () => {
  it('returns 200 with paginated empty response', async () => {
    getDb()['findMany']!.mockResolvedValue([]);
    const res = await request(testApp).get('/api/images');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.hasMore).toBe(false);
  });

  it('returns paginated images', async () => {
    getDb()['findMany']!.mockResolvedValue([DB_IMAGE]);
    const res = await request(testApp).get('/api/images');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(DB_IMAGE.id);
  });
});

// ---------------------------------------------------------------------------
// GET /api/images/:id
// ---------------------------------------------------------------------------

describe('GET /api/images/:id', () => {
  it('returns 404 for an unknown id', async () => {
    getDb()['findUnique']!.mockResolvedValue(null);
    const res = await request(testApp).get('/api/images/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns the image for a known id', async () => {
    getDb()['findUnique']!.mockResolvedValue(DB_IMAGE);
    const res = await request(testApp).get(`/api/images/${DB_IMAGE.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(DB_IMAGE.id);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/images/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/images/:id', () => {
  it('returns 404 for an unknown id', async () => {
    getDb()['findUnique']!.mockResolvedValue(null);
    const res = await request(testApp).delete('/api/images/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('deletes from storage and DB for a valid id with storedKey', async () => {
    const imageWithKey = { ...DB_IMAGE, storedKey: 'images/uuid-1.jpg', stagingKey: null, variants: [] };
    getDb()['findUnique']!.mockResolvedValue(imageWithKey);
    getDb()['delete']!.mockResolvedValue(imageWithKey);

    const res = await request(testApp).delete(`/api/images/${DB_IMAGE.id}`);

    expect(res.status).toBe(200);
    expect(getStorage().deleteObject).toHaveBeenCalledWith(imageWithKey.storedKey);
    expect(getDb()['delete']).toHaveBeenCalledTimes(1);
  });

  it('skips S3 deletion when storedKey is null (rejected image)', async () => {
    getDb()['findUnique']!.mockResolvedValue({ ...DB_IMAGE, storedKey: null, stagingKey: null, variants: [] });
    getDb()['delete']!.mockResolvedValue(DB_IMAGE);

    const res = await request(testApp).delete(`/api/images/${DB_IMAGE.id}`);

    expect(res.status).toBe(200);
    expect(getStorage().deleteObject).not.toHaveBeenCalled();
    expect(getDb()['delete']).toHaveBeenCalledTimes(1);
  });
});
