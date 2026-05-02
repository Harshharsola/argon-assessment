/**
 * Unit tests for imageValidator.
 *
 * `sharp` is mocked so these tests cover decision logic only.
 * Modules under test are loaded via `require` AFTER jest.mock() to
 * guarantee mocks are in place before module evaluation.
 */

jest.mock('sharp', () => {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['metadata', 'greyscale', 'convolve', 'raw', 'toBuffer', 'clone']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  const mock = jest.fn().mockReturnValue(chain);
  (mock as unknown as Record<string, unknown>).__chain = chain;
  return mock;
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const validator = require('../validators/imageValidator') as typeof import('../validators/imageValidator');
const { validateImage, computeBlurScore } = validator;
const MIN_DIMENSION: number = validator.MIN_DIMENSION;
const BLUR_THRESHOLD: number = validator.BLUR_THRESHOLD;

type SharpChain = Record<string, jest.Mock>;
function getChain(): SharpChain {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('sharp') as jest.Mock & { __chain: SharpChain }).__chain;
}

// ---------------------------------------------------------------------------
// Pixel buffer helpers
// For alternating pixel values a and b: variance = (a - b)² / 4
// ---------------------------------------------------------------------------

/** Variance >> BLUR_THRESHOLD: alternating 0 / 255 → variance ≈ 16 256 */
function sharpPixels() {
  const data = Buffer.alloc(100);
  for (let i = 0; i < 100; i++) data[i] = i % 2 === 0 ? 255 : 0;
  return { data, info: { channels: 1 } };
}

/** Variance = 0: uniform grey → definitely blurry */
function blurryPixels() {
  return { data: Buffer.alloc(100, 128), info: { channels: 1 } };
}

/**
 * Variance just BELOW BLUR_THRESHOLD (49 < 50):
 * v=14 → variance = 14²/4 = 49
 */
function justBelowThresholdPixels() {
  const data = Buffer.alloc(100);
  for (let i = 0; i < 100; i++) data[i] = i % 2 === 0 ? 14 : 0;
  return { data, info: { channels: 1 } };
}

/**
 * Variance just AT/ABOVE BLUR_THRESHOLD (56.25 ≥ 50):
 * v=15 → variance = 15²/4 = 56.25
 */
function justAboveThresholdPixels() {
  const data = Buffer.alloc(100);
  for (let i = 0; i < 100; i++) data[i] = i % 2 === 0 ? 15 : 0;
  return { data, info: { channels: 1 } };
}

const VALID_META = { format: 'jpeg', width: 800, height: 800 };

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
// Rule 1 — Format
// ---------------------------------------------------------------------------

describe('Rule 1: format validation', () => {
  it('accepts jpeg', async () => {
    getChain()['metadata']!.mockResolvedValue({ ...VALID_META, format: 'jpeg' });
    expect((await validateImage(Buffer.from(''))).valid).toBe(true);
  });

  it('accepts png', async () => {
    getChain()['metadata']!.mockResolvedValue({ ...VALID_META, format: 'png' });
    expect((await validateImage(Buffer.from(''))).valid).toBe(true);
  });

  it('accepts heif (decoded HEIC)', async () => {
    getChain()['metadata']!.mockResolvedValue({ ...VALID_META, format: 'heif' });
    expect((await validateImage(Buffer.from(''))).valid).toBe(true);
  });

  it('rejects gif', async () => {
    getChain()['metadata']!.mockResolvedValue({ ...VALID_META, format: 'gif' });
    const result = await validateImage(Buffer.from(''));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/unsupported format/i);
  });

  it('rejects webp', async () => {
    getChain()['metadata']!.mockResolvedValue({ ...VALID_META, format: 'webp' });
    expect((await validateImage(Buffer.from(''))).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — Minimum resolution
// ---------------------------------------------------------------------------

describe('Rule 2: minimum resolution', () => {
  it(`rejects width ${MIN_DIMENSION - 1}px`, async () => {
    getChain()['metadata']!.mockResolvedValue({ ...VALID_META, width: MIN_DIMENSION - 1 });
    const result = await validateImage(Buffer.from(''));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/too small/i);
  });

  it(`rejects height ${MIN_DIMENSION - 1}px`, async () => {
    getChain()['metadata']!.mockResolvedValue({ ...VALID_META, height: MIN_DIMENSION - 1 });
    const result = await validateImage(Buffer.from(''));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/too small/i);
  });

  it(`accepts exactly ${MIN_DIMENSION}×${MIN_DIMENSION}px (boundary)`, async () => {
    getChain()['metadata']!.mockResolvedValue({ ...VALID_META, width: MIN_DIMENSION, height: MIN_DIMENSION });
    expect((await validateImage(Buffer.from(''))).valid).toBe(true);
  });

  it('accepts 4000×3000px', async () => {
    getChain()['metadata']!.mockResolvedValue({ ...VALID_META, width: 4000, height: 3000 });
    expect((await validateImage(Buffer.from(''))).valid).toBe(true);
  });

  it('rejection reason includes actual dimensions', async () => {
    getChain()['metadata']!.mockResolvedValue({ ...VALID_META, width: 100, height: 80 });
    const result = await validateImage(Buffer.from(''));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('100');
      expect(result.reason).toContain('80');
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — Blur detection
// ---------------------------------------------------------------------------

describe('Rule 3: blur detection', () => {
  it('rejects a blurry image (variance = 0)', async () => {
    getChain()['toBuffer']!.mockResolvedValue(blurryPixels());
    const result = await validateImage(Buffer.from(''));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/blurry/i);
  });

  it(`rejects when variance is just below threshold (49 < ${BLUR_THRESHOLD})`, async () => {
    getChain()['toBuffer']!.mockResolvedValue(justBelowThresholdPixels());
    const result = await validateImage(Buffer.from(''));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/blurry/i);
  });

  it(`accepts when variance is just above threshold (56 ≥ ${BLUR_THRESHOLD})`, async () => {
    getChain()['toBuffer']!.mockResolvedValue(justAboveThresholdPixels());
    expect((await validateImage(Buffer.from(''))).valid).toBe(true);
  });

  it('accepts a sharp image (variance >> threshold)', async () => {
    getChain()['toBuffer']!.mockResolvedValue(sharpPixels());
    expect((await validateImage(Buffer.from(''))).valid).toBe(true);
  });

  it('rejection reason includes the blur score', async () => {
    getChain()['toBuffer']!.mockResolvedValue(blurryPixels());
    const result = await validateImage(Buffer.from(''));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/score/i);
  });
});

// ---------------------------------------------------------------------------
// computeBlurScore — unit test the math
// ---------------------------------------------------------------------------

describe('computeBlurScore', () => {
  it('returns 0 for a uniform pixel buffer (no edges)', async () => {
    getChain()['toBuffer']!.mockResolvedValue(blurryPixels());
    expect(await computeBlurScore(Buffer.from(''))).toBe(0);
  });

  it('returns a high score for a maximum-contrast buffer', async () => {
    getChain()['toBuffer']!.mockResolvedValue(sharpPixels());
    const score = await computeBlurScore(Buffer.from(''));
    expect(score).toBeGreaterThan(BLUR_THRESHOLD);
  });

  it('scores blurry lower than sharp for the same size', async () => {
    getChain()['toBuffer']!.mockResolvedValue(sharpPixels());
    const sharpScore = await computeBlurScore(Buffer.from(''));

    getChain()['toBuffer']!.mockResolvedValue(blurryPixels());
    const blurryScore = await computeBlurScore(Buffer.from(''));

    expect(sharpScore).toBeGreaterThan(blurryScore);
  });
});

// ---------------------------------------------------------------------------
// Validation ordering — earlier rules must short-circuit later ones
// ---------------------------------------------------------------------------

describe('validation ordering', () => {
  it('rejects on format before checking resolution', async () => {
    // Invalid format AND too small — reason should be about format, not size
    getChain()['metadata']!.mockResolvedValue({ format: 'gif', width: 50, height: 50 });
    const result = await validateImage(Buffer.from(''));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/unsupported format/i);
  });

  it('rejects on resolution before checking blur', async () => {
    // Too small AND blurry — reason should be about size, not blur
    getChain()['metadata']!.mockResolvedValue({ ...VALID_META, width: 50, height: 50 });
    getChain()['toBuffer']!.mockResolvedValue(blurryPixels());
    const result = await validateImage(Buffer.from(''));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/too small/i);
  });
});
