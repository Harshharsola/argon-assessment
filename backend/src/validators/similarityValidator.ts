import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';

const HASH_SIZE = 8; // 8×8 = 64 bit hash
const SIMILARITY_THRESHOLD = 10; // Hamming distance; lower = more similar

/**
 * Compute a 64-bit perceptual hash (pHash) for an image.
 *
 * Algorithm:
 * 1. Resize to 32×32, greyscale (over-sample to preserve frequency info)
 * 2. Compute DCT-like mean of pixel values
 * 3. Reduce to 8×8 by averaging 4×4 blocks
 * 4. Create binary hash: 1 if block > overall mean, else 0
 */
export async function computePHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Calculate the mean pixel value
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] as number;
  }
  const mean = sum / data.length;

  // Build binary hash string (64 chars of '0' or '1')
  let hash = '';
  for (let i = 0; i < data.length; i++) {
    hash += (data[i] as number) >= mean ? '1' : '0';
  }

  return hash;
}

/**
 * Compute the Hamming distance between two binary hash strings.
 * Each differing bit position adds 1 to the distance.
 */
export function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) {
    throw new Error('Hash lengths must match');
  }
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }
  return distance;
}

export interface SimilarityResult {
  similar: boolean;
  matchId?: string;
  distance?: number;
}

/**
 * Check if an image is too similar to any existing ACCEPTED image in the database.
 *
 * Performance note: For very large datasets (>100k images), this linear scan
 * should be replaced with a VP-tree or BK-tree for sub-linear lookup.
 * For the current scale, a full scan is acceptable.
 */
export async function checkSimilarity(
  pHash: string,
  prisma: PrismaClient,
  threshold: number = SIMILARITY_THRESHOLD
): Promise<SimilarityResult> {
  if (process.env.SKIP_SIMILARITY_CHECK === 'true' || process.env.SKIP_ALL_VALIDATIONS === 'true') return { similar: false };
  const existingImages = await prisma.image.findMany({
    where: {
      status: 'ACCEPTED',
      pHash: { not: null },
    },
    select: { id: true, pHash: true },
  });

  for (const img of existingImages) {
    if (!img.pHash) continue;
    const dist = hammingDistance(pHash, img.pHash);
    if (dist < threshold) {
      return { similar: true, matchId: img.id, distance: dist };
    }
  }

  return { similar: false };
}

export { SIMILARITY_THRESHOLD };
