/**
 * VariantWorker
 *
 * Generates 3 resized variants from the compressed JPEG, uploads
 * each to R2 under images/{imageId}/{type}.jpg, writes ImageVariant
 * rows, then marks the image ACCEPTED.
 *
 * Idempotency: ImageVariant has @@unique([imageId, variantType]) so
 * upsert is safe on retry. The final Image update is idempotent too.
 * Staging keys are cleaned up last — if cleanup fails, the pipeline
 * result is still correct (orphaned staging keys cost cents on R2).
 */

import { Worker } from 'bullmq';
import sharp from 'sharp';
import { redisConnection, type VariantJobData } from '../queue/index';
import { getObjectStream, uploadBuffer, deleteObject } from '../services/storage';
import { streamToBuffer } from '../utils/stream';
import { prisma } from '../utils/prisma';
import { VARIANT_SPECS } from '../types/index';

export function startVariantWorker() {
  const worker = new Worker<VariantJobData>(
    'variant-generation',
    async (job) => {
      const { imageId, compressedKey } = job.data;
      console.log(`[VariantWorker] job=${job.id} image=${imageId}`);

      await prisma.image.update({
        where: { id: imageId },
        data: { processingStage: 'GENERATING_VARIANTS' },
      });

      const { stream } = await getObjectStream(compressedKey);
      const source = await streamToBuffer(stream);

      // Generate all variants in parallel
      await Promise.all(
        VARIANT_SPECS.map(async (spec) => {
          const resized = await sharp(source)
            .resize({
              width: spec.width,
              height: spec.height ?? undefined,
              fit: spec.fit,
              withoutEnlargement: true,
            })
            .jpeg({ quality: spec.type === 'THUMBNAIL' ? 85 : 80 })
            .toBuffer();

          const meta = await sharp(resized).metadata();
          const key = `images/${imageId}/${spec.type.toLowerCase()}.jpg`;
          await uploadBuffer(key, resized, 'image/jpeg');

          // Upsert — safe to retry
          await prisma.imageVariant.upsert({
            where: { imageId_variantType: { imageId, variantType: spec.type } },
            create: {
              imageId,
              variantType: spec.type,
              key,
              widthPx:   meta.width  ?? spec.width,
              heightPx:  meta.height ?? spec.height ?? spec.width,
              sizeBytes: resized.length,
            },
            update: {
              key,
              widthPx:   meta.width  ?? spec.width,
              heightPx:  meta.height ?? spec.height ?? spec.width,
              sizeBytes: resized.length,
            },
          });
        }),
      );

      // Fetch the full variant key so we can set the canonical URL
      const fullVariant = await prisma.imageVariant.findUniqueOrThrow({
        where: { imageId_variantType: { imageId, variantType: 'FULL' } },
      });

      await prisma.image.update({
        where: { id: imageId },
        data: {
          status:         'ACCEPTED',
          processingStage: 'COMPLETE',
          storedKey:      fullVariant.key,
          url:            `/api/images/${imageId}/variants/full/view`,
          stagingKey:     null,
        },
      });

      // Best-effort cleanup of staging keys
      await Promise.allSettled([
        deleteObject(`staging/${imageId}/original.jpg`),
        deleteObject(`staging/${imageId}/converted.jpg`),
        deleteObject(`staging/${imageId}/compressed.jpg`),
      ]);
    },
    {
      connection: redisConnection,
      concurrency: 3, // variant generation is CPU-heavy via sharp
    },
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
      await prisma.image.update({
        where: { id: job.data.imageId },
        data: {
          status:          'REJECTED',
          processingStage: 'FAILED',
          rejectionReason: `Variant generation failed: ${err.message}`,
        },
      }).catch(console.error);
    }
  });

  console.log('[VariantWorker] started');
  return worker;
}
