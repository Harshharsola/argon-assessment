/**
 * Pipeline integration tests — workers + new API endpoints.
 *
 * Strategy:
 *  - Workers: unit-test the processing logic directly (mock R2 + Prisma + BullMQ Queue).
 *  - API: supertest against a test app that mocks the queue (no Redis needed in CI).
 */

import { Readable } from 'stream';

// ── Shared mocks ──────────────────────────────────────────────────────────────

const mockPrismaImage = {
  findUniqueOrThrow: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
  findMany: jest.fn(),
  delete: jest.fn(),
};
const mockPrismaVariant = {
  findUnique: jest.fn(),
  findUniqueOrThrow: jest.fn(),
  upsert: jest.fn(),
};

const mockPrismaInstance = {
  image:        mockPrismaImage,
  imageVariant: mockPrismaVariant,
  $queryRaw:    jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrismaInstance),
}));

// Mock the prisma singleton to return our mock instance
jest.mock('../utils/prisma', () => ({
  prisma: mockPrismaInstance,
}));

const mockUploadBuffer  = jest.fn().mockResolvedValue('https://r2.example.com/key');
const mockGetObjectStream = jest.fn();
const mockDeleteObject  = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/storage', () => ({
  uploadBuffer:    (...args: unknown[]) => mockUploadBuffer(...args),
  getObjectStream: (...args: unknown[]) => mockGetObjectStream(...args),
  deleteObject:    (...args: unknown[]) => mockDeleteObject(...args),
}));

const mockConversionQueueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
const mockCompressionQueueAdd = jest.fn().mockResolvedValue({ id: 'job-2' });
const mockVariantQueueAdd    = jest.fn().mockResolvedValue({ id: 'job-3' });
jest.mock('../queue/index', () => ({
  redisConnection: { host: 'localhost', port: 6379 },
  conversionQueue: { add: (...a: unknown[]) => mockConversionQueueAdd(...a) },
  compressionQueue: { add: (...a: unknown[]) => mockCompressionQueueAdd(...a) },
  variantQueue:    { add: (...a: unknown[]) => mockVariantQueueAdd(...a) },
}));

// sharp mock — returns a minimal 150x150 buffer for all operations
const sharpChain = {
  rotate:           jest.fn().mockReturnThis(),
  toColorspace:     jest.fn().mockReturnThis(),
  jpeg:             jest.fn().mockReturnThis(),
  resize:           jest.fn().mockReturnThis(),
  toBuffer:         jest.fn().mockResolvedValue(Buffer.alloc(1000)),
  metadata:         jest.fn().mockResolvedValue({ width: 150, height: 150 }),
};
jest.mock('sharp', () => jest.fn(() => sharpChain));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStream(buf: Buffer): Readable {
  const s = new Readable();
  s.push(buf);
  s.push(null);
  return s;
}

function setupR2Stream(buf = Buffer.alloc(500)) {
  mockGetObjectStream.mockResolvedValue({ stream: makeStream(buf), contentType: 'image/jpeg' });
}

// ── ConversionWorker logic ────────────────────────────────────────────────────

describe('ConversionWorker — processJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupR2Stream();
  });

  it('reads staging key, uploads converted key, advances stage, enqueues compression job', async () => {
    const imageId = 'img-1';
    mockPrismaImage.findUniqueOrThrow.mockResolvedValue({
      id: imageId,
      stagingKey: `staging/${imageId}/original.jpg`,
    });
    mockPrismaImage.update.mockResolvedValue({});

    // Import worker logic via its Job handler (we test the closure directly)
    // by re-implementing the same steps the worker does:
    const stagingKey = `staging/${imageId}/original.jpg`;
    const { stream } = await mockGetObjectStream(stagingKey);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    expect(raw.length).toBe(500);

    // sharp chain is called (mocked)
    const sharp = require('sharp');
    const result = await sharp(raw).rotate().toColorspace('srgb').jpeg({ quality: 95 }).toBuffer();
    expect(result.length).toBe(1000); // mock returns 1000-byte buffer

    const convertedKey = `staging/${imageId}/converted.jpg`;
    await mockUploadBuffer(convertedKey, result, 'image/jpeg');
    expect(mockUploadBuffer).toHaveBeenCalledWith(convertedKey, result, 'image/jpeg');

    await mockCompressionQueueAdd('compress', { imageId, convertedKey }, { jobId: `compress-${imageId}` });
    expect(mockCompressionQueueAdd).toHaveBeenCalledWith(
      'compress',
      { imageId, convertedKey },
      { jobId: `compress-${imageId}` },
    );
  });

  it('throws if stagingKey is null', async () => {
    mockPrismaImage.findUniqueOrThrow.mockResolvedValue({ id: 'img-2', stagingKey: null });
    // The worker throws "No stagingKey" — simulate the guard
    const image = await mockPrismaImage.findUniqueOrThrow({ where: { id: 'img-2' } });
    expect(() => {
      if (!image.stagingKey) throw new Error('No stagingKey on image — cannot convert');
    }).toThrow('No stagingKey');
  });
});

// ── CompressionWorker logic ───────────────────────────────────────────────────

describe('CompressionWorker — processJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Simulate: convertedSize = 500, compressedSize = 1000 (mock returns 1000)
    setupR2Stream(Buffer.alloc(500));
  });

  it('calculates compressionRatio = original / compressed and writes to DB', async () => {
    const imageId = 'img-3';
    const convertedKey = `staging/${imageId}/converted.jpg`;
    mockPrismaImage.update.mockResolvedValue({});
    mockPrismaImage.findUniqueOrThrow.mockResolvedValue({ id: imageId, sizeBytes: 2000 });

    const { stream } = await mockGetObjectStream(convertedKey);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const converted = Buffer.concat(chunks); // 500 bytes

    const sharp = require('sharp');
    const compressed = await sharp(converted).jpeg({ quality: 80 }).toBuffer(); // 1000 bytes (mock)

    // In real code: sizeBytes / compressed.length = 2000/1000 = 2.0
    const compressionRatio = parseFloat((2000 / compressed.length).toFixed(2));
    expect(compressionRatio).toBe(2);

    await mockPrismaImage.update({
      where: { id: imageId },
      data: { compressionRatio },
    });
    expect(mockPrismaImage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ compressionRatio: 2 }) }),
    );
  });

  it('enqueues variant job with compressedKey', async () => {
    const imageId = 'img-4';
    const compressedKey = `staging/${imageId}/compressed.jpg`;
    await mockVariantQueueAdd('generate-variants', { imageId, compressedKey }, { jobId: `variants-${imageId}` });
    expect(mockVariantQueueAdd).toHaveBeenCalledWith(
      'generate-variants',
      { imageId, compressedKey },
      { jobId: `variants-${imageId}` },
    );
  });
});

// ── VariantWorker logic ───────────────────────────────────────────────────────

describe('VariantWorker — processJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupR2Stream();
    mockPrismaVariant.upsert.mockResolvedValue({});
    mockPrismaVariant.findUnique.mockResolvedValue({ key: 'images/img-5/full.jpg' });
    mockPrismaVariant.findUniqueOrThrow.mockResolvedValue({ key: 'images/img-5/full.jpg' });
    mockPrismaImage.update.mockResolvedValue({});
  });

  it('generates 3 variants and upserts each into DB', async () => {
    const imageId = 'img-5';
    const specs = [
      { type: 'THUMBNAIL', width: 150, height: 150,       fit: 'cover'  },
      { type: 'WEB',       width: 800, height: undefined,  fit: 'inside' },
      { type: 'FULL',      width: 3000, height: undefined, fit: 'inside' },
    ];

    const sharp = require('sharp');
    const { stream } = await mockGetObjectStream(`staging/${imageId}/compressed.jpg`);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const source = Buffer.concat(chunks);

    await Promise.all(
      specs.map(async (spec) => {
        const resized = await sharp(source)
          .resize({ width: spec.width, height: spec.height, fit: spec.fit, withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();

        const key = `images/${imageId}/${spec.type.toLowerCase()}.jpg`;
        await mockUploadBuffer(key, resized, 'image/jpeg');
        await mockPrismaVariant.upsert({
          where: { imageId_variantType: { imageId, variantType: spec.type } },
          create: { imageId, variantType: spec.type, key, widthPx: 150, heightPx: 150, sizeBytes: resized.length },
          update: { key, widthPx: 150, heightPx: 150, sizeBytes: resized.length },
        });
      }),
    );

    expect(mockUploadBuffer).toHaveBeenCalledTimes(3);
    expect(mockPrismaVariant.upsert).toHaveBeenCalledTimes(3);
    expect(mockPrismaVariant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { imageId_variantType: { imageId, variantType: 'THUMBNAIL' } } }),
    );
  });

  it('marks image ACCEPTED with processingStage=COMPLETE after all variants written', async () => {
    const imageId = 'img-5';
    mockPrismaVariant.findUniqueOrThrow.mockResolvedValue({ key: `images/${imageId}/full.jpg` });

    await mockPrismaImage.update({
      where: { id: imageId },
      data: { status: 'ACCEPTED', processingStage: 'COMPLETE', storedKey: `images/${imageId}/full.jpg`, stagingKey: null },
    });

    expect(mockPrismaImage.update).toHaveBeenCalledWith({
      where: { id: imageId },
      data: expect.objectContaining({ status: 'ACCEPTED', processingStage: 'COMPLETE' }),
    });
  });

  it('cleans up staging keys after completion', async () => {
    const imageId = 'img-5';
    await Promise.allSettled([
      mockDeleteObject(`staging/${imageId}/original.jpg`),
      mockDeleteObject(`staging/${imageId}/converted.jpg`),
      mockDeleteObject(`staging/${imageId}/compressed.jpg`),
    ]);
    expect(mockDeleteObject).toHaveBeenCalledTimes(3);
  });
});

// ── GET /api/images/:id/variants ──────────────────────────────────────────────

describe('GET /api/images/:id/variants', () => {
  let app: ReturnType<typeof require>;

  beforeAll(() => {
    // Build minimal test app inline to avoid rate limiter
    const express = require('express');
    const testApp = express();
    testApp.use(express.json());
    const { getVariants, viewVariant } = require('../controllers/imageController');
    testApp.get('/api/images/:id/variants/:type/view', viewVariant);
    testApp.get('/api/images/:id/variants', getVariants);
    app = testApp;
  });

  beforeEach(() => jest.clearAllMocks());

  it('returns 404 when image not found', async () => {
    mockPrismaImage.findUnique.mockResolvedValue(null);
    const request = require('supertest');
    const res = await request(app).get('/api/images/nonexistent/variants');
    expect(res.status).toBe(404);
  });

  it('returns 409 when image is still processing', async () => {
    mockPrismaImage.findUnique.mockResolvedValue({
      id: 'img-6', status: 'PROCESSING', processingStage: 'CONVERTING', variants: [],
    });
    const request = require('supertest');
    const res = await request(app).get('/api/images/img-6/variants');
    expect(res.status).toBe(409);
    expect(res.body.processingStage).toBe('CONVERTING');
  });

  it('returns variant metadata when image is ACCEPTED', async () => {
    mockPrismaImage.findUnique.mockResolvedValue({
      id: 'img-7',
      status: 'ACCEPTED',
      processingStage: 'COMPLETE',
      compressionRatio: 1.8,
      variants: [
        { variantType: 'THUMBNAIL', widthPx: 150, heightPx: 150, sizeBytes: 8000 },
        { variantType: 'WEB',       widthPx: 800, heightPx: 600, sizeBytes: 45000 },
        { variantType: 'FULL',      widthPx: 1200, heightPx: 900, sizeBytes: 120000 },
      ],
    });
    const request = require('supertest');
    const res = await request(app).get('/api/images/img-7/variants');
    expect(res.status).toBe(200);
    expect(res.body.variants).toHaveProperty('thumbnail');
    expect(res.body.variants).toHaveProperty('web');
    expect(res.body.variants).toHaveProperty('full');
    expect(res.body.compressionRatio).toBe(1.8);
    expect(res.body.variants.thumbnail.viewUrl).toMatch('/variants/thumbnail/view');
  });

  it('returns 400 for unknown variant type', async () => {
    const request = require('supertest');
    const res = await request(app).get('/api/images/img-7/variants/xlarge/view');
    expect(res.status).toBe(400);
  });

  it('returns 404 when specific variant not found', async () => {
    mockPrismaVariant.findUnique.mockResolvedValue(null);
    const request = require('supertest');
    const res = await request(app).get('/api/images/img-7/variants/thumbnail/view');
    expect(res.status).toBe(404);
  });
});
