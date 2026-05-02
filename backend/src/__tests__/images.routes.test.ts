/**
 * Integration tests for /api/images routes.
 *
 * sharp, @prisma/client, and storage are mocked.
 * The express app is constructed inline (not from app.ts) to avoid
 * side effects from the entry-point module evaluation.
 */

// ---------------------------------------------------------------------------
// Mocks — registered before any require/import
// ---------------------------------------------------------------------------

jest.mock('sharp', () => {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['metadata', 'greyscale', 'convolve', 'raw', 'toBuffer', 'clone']) {
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
    delete: jest.fn(),
  };
  return {
    PrismaClient: jest.fn().mockImplementation(() => ({ image })),
    __image: image,
  };
});

jest.mock('../services/storage', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://cdn.example.com/images/test.jpg'),
  deleteObject: jest.fn().mockResolvedValue(undefined),
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

function blurryPixels() {
  return { data: Buffer.alloc(100, 128), info: { channels: 1 } };
}

const DB_IMAGE = {
  id: 'uuid-1',
  originalName: 'photo.jpg',
  storedKey: 'images/uuid-1.jpg',
  url: 'https://cdn.example.com/images/uuid-1.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 12345,
  widthPx: 800,
  heightPx: 800,
  status: 'ACCEPTED',
  rejectionReason: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  const chain = getChain();
  chain['metadata']!.mockResolvedValue(VALID_META);
  chain['toBuffer']!.mockResolvedValue(sharpPixels());
  for (const m of ['greyscale', 'convolve', 'raw', 'clone']) {
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

  it('returns 201 and ACCEPTED for a valid JPEG passing all checks', async () => {
    getDb()['create']!.mockResolvedValue({ ...DB_IMAGE, status: 'ACCEPTED' });

    const res = await request(testApp)
      .post('/api/images/upload')
      .attach('image', Buffer.from('fake-jpeg'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACCEPTED');
    expect(res.body.rejectionReason).toBeNull();
  });

  it('returns 201 and REJECTED when image is too small', async () => {
    getChain()['metadata']!.mockResolvedValue({ ...VALID_META, width: 50, height: 50 });
    getDb()['create']!.mockResolvedValue({
      ...DB_IMAGE,
      status: 'REJECTED',
      rejectionReason: 'Image too small (50×50px). Minimum 200px on each side.',
      widthPx: 50,
      heightPx: 50,
    });

    const res = await request(testApp)
      .post('/api/images/upload')
      .attach('image', Buffer.from('fake-jpeg'), { filename: 'tiny.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('REJECTED');
    expect(res.body.rejectionReason).toMatch(/too small/i);
  });

  it('returns 201 and REJECTED when image is blurry', async () => {
    getChain()['toBuffer']!.mockResolvedValue(blurryPixels());
    getDb()['create']!.mockResolvedValue({
      ...DB_IMAGE,
      status: 'REJECTED',
      rejectionReason: 'Image is too blurry (score: 0.0)',
    });

    const res = await request(testApp)
      .post('/api/images/upload')
      .attach('image', Buffer.from('fake-jpeg'), { filename: 'blurry.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('REJECTED');
    expect(res.body.rejectionReason).toMatch(/blurry/i);
  });

  it('calls uploadBuffer exactly once per request', async () => {
    getDb()['create']!.mockResolvedValue(DB_IMAGE);

    await request(testApp)
      .post('/api/images/upload')
      .attach('image', Buffer.from('fake-jpeg'), { filename: 'photo.jpg', contentType: 'image/jpeg' });

    expect(getStorage().uploadBuffer).toHaveBeenCalledTimes(1);
  });

  it('persists the original filename to the database', async () => {
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
  it('returns 200 with an empty array when there are no images', async () => {
    getDb()['findMany']!.mockResolvedValue([]);
    const res = await request(testApp).get('/api/images');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all stored images', async () => {
    getDb()['findMany']!.mockResolvedValue([DB_IMAGE]);
    const res = await request(testApp).get('/api/images');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(DB_IMAGE.id);
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

  it('deletes from storage and DB for a valid id', async () => {
    getDb()['findUnique']!.mockResolvedValue(DB_IMAGE);
    getDb()['delete']!.mockResolvedValue(DB_IMAGE);

    const res = await request(testApp).delete(`/api/images/${DB_IMAGE.id}`);

    expect(res.status).toBe(200);
    expect(getStorage().deleteObject).toHaveBeenCalledWith(DB_IMAGE.storedKey);
    expect(getDb()['delete']).toHaveBeenCalledTimes(1);
  });
});
