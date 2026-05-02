import sharp from 'sharp';
import type { ValidationResult, ImageMeta } from '../types';

const MIN_DIMENSION = 200; // px
const BLUR_THRESHOLD = 50; // Laplacian variance

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'heif']);

/**
 * Run all synchronous validation checks on an image buffer.
 * Face detection and similarity checks are handled in the controller
 * as they require DB / external service access.
 */
export async function validateImage(buffer: Buffer): Promise<ValidationResult> {
  const metadata = await sharp(buffer).metadata();

  const format = metadata.format ?? '';
  if (!ALLOWED_FORMATS.has(format)) {
    return { valid: false, reason: 'Unsupported format' };
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    return {
      valid: false,
      reason: `Image too small (${width}×${height}px). Minimum ${MIN_DIMENSION}px on each side.`,
    };
  }

  const blurScore = await computeBlurScore(buffer);
  if (blurScore < BLUR_THRESHOLD) {
    return { valid: false, reason: `Image is too blurry (score: ${blurScore.toFixed(1)})` };
  }

  const meta: ImageMeta = { format, width, height };
  return { valid: true, meta };
}

/**
 * Laplacian variance — higher means sharper edges.
 * A uniform/blurry image produces low variance.
 */
export async function computeBlurScore(buffer: Buffer): Promise<number> {
  const { data, info } = await sharp(buffer)
    .greyscale()
    .convolve({
      width: 3,
      height: 3,
      kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = data.length / info.channels;
  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < data.length; i += info.channels) {
    const v = data[i] as number;
    sum += v;
    sumSq += v * v;
  }

  const mean = sum / pixels;
  return sumSq / pixels - mean * mean;
}

export { MIN_DIMENSION, BLUR_THRESHOLD };
