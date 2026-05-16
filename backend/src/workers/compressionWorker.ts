/**
 * CompressionWorker
 *
 * Reads the normalised JPEG from R2, applies quality compression
 * (JPEG q=80 — good visual fidelity at ~40-60% size reduction),
 * records the compression ratio, then enqueues a VariantJob.
 *
 * Compression ratio = originalSizeBytes / compressedSizeBytes
 * where originalSizeBytes is the sizeBytes stored on the Image row
 * (the raw upload size), giving a meaningful ratio.
 */

import { Worker } from 'bullmq';
import sharp from 'sharp';
import {
  redisConnection,
  variantQueue,
  type CompressionJobData,
} from '../queue/index';
import { getObjectStream, uploadBuffer } from '../services/storage';
import { streamToBuffer } from '../utils/stream';
import { prisma } from '../utils/prisma';

const JPEG_QUALITY = 80;

export function startCompressionWorker() {
  const worker = new Worker<CompressionJobData>(
    'compression',
    async (job) => {
      const { imageId, convertedKey } = job.data;
      console.log(`[CompressionWorker] job=${job.id} image=${imageId}`);

      await prisma.image.update({
        where: { id: imageId },
        data: { processingStage: 'COMPRESSING' },
      });

      const { stream } = await getObjectStream(convertedKey);
      const converted = await streamToBuffer(stream);

      const compressed = await sharp(converted)
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();

      // Use original upload size (sizeBytes) for a meaningful ratio
      const image = await prisma.image.findUniqueOrThrow({ where: { id: imageId } });
      const compressionRatio = parseFloat(
        (image.sizeBytes / compressed.length).toFixed(2),
      );

      const compressedKey = `staging/${imageId}/compressed.jpg`;
      await uploadBuffer(compressedKey, compressed, 'image/jpeg');

      await prisma.image.update({
        where: { id: imageId },
        data: {
          processingStage: 'GENERATING_VARIANTS',
          stagingKey: compressedKey,
          compressionRatio,
        },
      });

      await variantQueue.add(
        'generate-variants',
        { imageId, compressedKey },
        { jobId: `variants-${imageId}` },
      );
    },
    {
      connection: redisConnection,
      concurrency: 4,
    },
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
      await prisma.image.update({
        where: { id: job.data.imageId },
        data: {
          status: 'REJECTED',
          processingStage: 'FAILED',
          rejectionReason: `Compression failed: ${err.message}`,
        },
      }).catch(console.error);
    }
  });

  console.log('[CompressionWorker] started');
  return worker;
}
