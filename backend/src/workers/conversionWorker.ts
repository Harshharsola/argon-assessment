/**
 * ConversionWorker
 *
 * Reads the original validated image from R2, normalises it to a
 * consistent JPEG (auto-rotate from EXIF, strip metadata, sRGB),
 * uploads the result, then enqueues a CompressionJob.
 *
 * HEIC files are decoded via heic-convert first (sharp on this platform
 * does not have a HEIC decode plugin), then normalised through sharp.
 *
 * Idempotency: BullMQ guarantees each job is delivered to exactly one
 * worker. If a worker crashes mid-job, BullMQ moves the job back to
 * the active queue after the lock TTL expires and retries up to
 * maxAttempts. R2 PutObject is idempotent so re-uploading is safe.
 */

import { Worker } from 'bullmq';
import sharp from 'sharp';
import {
  redisConnection,
  compressionQueue,
  type ConversionJobData,
} from '../queue/index';
import { getObjectStream, uploadBuffer } from '../services/storage';
import { streamToBuffer } from '../utils/stream';
import { prisma } from '../utils/prisma';

export function startConversionWorker() {
  const worker = new Worker<ConversionJobData>(
    'conversion',
    async (job) => {
      const { imageId, stagingKey } = job.data;
      console.log(`[ConversionWorker] job=${job.id} image=${imageId}`);

      await prisma.image.update({
        where: { id: imageId },
        data: { processingStage: 'CONVERTING' },
      });

      // Read original from R2
      const { stream } = await getObjectStream(stagingKey);
      const raw = await streamToBuffer(stream);

      // If the original is HEIC/HEIF, decode it with heic-convert first.
      // sharp on this platform has no HEIC decode plugin, so we can't feed
      // raw HEIC bytes directly into sharp.
      const isHeic = /\.(heic|heif)$/i.test(stagingKey);
      let decodedBuffer: Buffer;
      if (isHeic) {
        const heicConvert = (await import('heic-convert')).default as (
          opts: { buffer: Buffer; format: 'JPEG' | 'PNG'; quality: number }
        ) => Promise<ArrayBuffer>;
        const decoded = await heicConvert({ buffer: raw, format: 'JPEG', quality: 0.95 });
        decodedBuffer = Buffer.from(decoded);
      } else {
        decodedBuffer = raw;
      }

      // Normalise: auto-orient (from EXIF), strip metadata, enforce sRGB JPEG.
      const converted = await sharp(decodedBuffer)
        .rotate()               // honour EXIF orientation then strip it
        .toColorspace('srgb')
        .jpeg({ quality: 95 })
        .toBuffer();

      // Extract dimensions after conversion
      const meta = await sharp(converted).metadata();

      const convertedKey = `staging/${imageId}/converted.jpg`;
      await uploadBuffer(convertedKey, converted, 'image/jpeg');

      await prisma.image.update({
        where: { id: imageId },
        data: {
          processingStage: 'COMPRESSING',
          stagingKey: convertedKey,
          widthPx: meta.width ?? null,
          heightPx: meta.height ?? null,
        },
      });

      // Chain to next stage — job ID is deterministic to prevent duplicates
      await compressionQueue.add(
        'compress',
        { imageId, convertedKey },
        { jobId: `compress-${imageId}` },
      );
    },
    {
      connection: redisConnection,
      concurrency: 5, // process up to 5 conversions in parallel per worker process
    },
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    // Only mark as REJECTED on final attempt
    if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
      await prisma.image.update({
        where: { id: job.data.imageId },
        data: {
          status: 'REJECTED',
          processingStage: 'FAILED',
          rejectionReason: `Conversion failed: ${err.message}`,
        },
      }).catch(console.error);
    }
  });

  console.log('[ConversionWorker] started');
  return worker;
}
