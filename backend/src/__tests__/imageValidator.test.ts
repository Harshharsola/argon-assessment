import sharp from 'sharp';
import { validateImage, computeBlurScore, MIN_DIMENSION } from '../validators/imageValidator';

/** Create a solid-colour JPEG buffer at given dimensions */
async function makeImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } },
  })
    .jpeg()
    .toBuffer();
}

describe('validateImage', () => {
  it('accepts a valid large image', async () => {
    const buf = await makeImage(800, 800);
    const result = await validateImage(buf);
    expect(result.valid).toBe(true);
  });

  it('rejects an image below the minimum dimension', async () => {
    const buf = await makeImage(MIN_DIMENSION - 1, MIN_DIMENSION - 1);
    const result = await validateImage(buf);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/too small/i);
    }
  });

  it('accepts an image exactly at the minimum dimension', async () => {
    const buf = await makeImage(MIN_DIMENSION, MIN_DIMENSION);
    const result = await validateImage(buf);
    expect(result.valid).toBe(true);
  });
});

describe('computeBlurScore', () => {
  it('returns a numeric score for any image', async () => {
    const buf = await makeImage(800, 800);
    const score = await computeBlurScore(buf);
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
