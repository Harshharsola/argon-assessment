import type { Request, Response, NextFunction } from 'express';
import { uploadBuffer, deleteObject, getObjectStream } from '../services/storage';
import { validateImage } from '../validators/imageValidator';
import { validateFaces } from '../validators/faceValidator';
import { computePHash, checkSimilarity } from '../validators/similarityValidator';
import { conversionQueue } from '../queue/index';
import { prisma } from '../utils/prisma';

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\]/g, '_')
    .replace(/\0/g, '')
    .replace(/[<>"'&]/g, '_')
    .slice(0, 255);
}

const HEIC_MIMES = new Set(['image/heic', 'image/heif']);

/**
 * Run the 6-stage validation pipeline then hand off to the BullMQ pipeline.
 *
 * Validation always runs on a JPEG-decodable buffer so that sharp-based
 * validators (blur, pHash, face) work reliably. For HEIC uploads we do a
 * quick in-memory decode *for validation only* — the original HEIC buffer
 * is what gets written to staging so the Conversion Worker still owns the
 * real format-conversion step (conversion after validation).
 */
async function validateAndEnqueue(
  imageId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<void> {
  try {
    // Decode HEIC → JPEG in memory so all validators can process it.
    // The original buffer (HEIC) is preserved and written to staging below.
    let validationBuffer = buffer;
    if (HEIC_MIMES.has(mimeType)) {
      const heicConvert = (await import('heic-convert')).default as (opts: {
        buffer: Buffer;
        format: 'JPEG' | 'PNG';
        quality: number;
      }) => Promise<ArrayBuffer>;
      const decoded = await heicConvert({ buffer, format: 'JPEG', quality: 0.9 });
      validationBuffer = Buffer.from(decoded);
    }

    const validation = await validateImage(validationBuffer);
    if (!validation.valid) {
      await prisma.image.update({
        where: { id: imageId },
        data: { status: 'REJECTED', rejectionReason: validation.reason },
      });
      return;
    }

    const faceResult = await validateFaces(validationBuffer);
    if (!faceResult.valid) {
      await prisma.image.update({
        where: { id: imageId },
        data: { status: 'REJECTED', rejectionReason: faceResult.reason ?? 'Face validation failed' },
      });
      return;
    }

    const pHash = await computePHash(validationBuffer);
    const similarity = await checkSimilarity(pHash, prisma);
    if (similarity.similar) {
      await prisma.image.update({
        where: { id: imageId },
        data: {
          status: 'REJECTED',
          rejectionReason: `Too similar to an existing image (distance: ${similarity.distance})`,
          pHash,
        },
      });
      return;
    }

    // All validation passed — upload the ORIGINAL buffer (HEIC stays HEIC)
    // to the staging key. The Conversion Worker will do the proper conversion.
    // Only the key string travels through Redis; no large buffers.
    const ext = HEIC_MIMES.has(mimeType) ? 'heic' : 'jpg';
    const stagingKey = `staging/${imageId}/original.${ext}`;
    await uploadBuffer(stagingKey, buffer, mimeType);

    await prisma.image.update({
      where: { id: imageId },
      data: { pHash, stagingKey, processingStage: 'PENDING' },
    });

    // Enqueue first pipeline stage. jobId is deterministic — BullMQ deduplicates
    // so re-uploading the same image never creates duplicate conversion jobs.
    await conversionQueue.add(
      'convert',
      { imageId, stagingKey },
      { jobId: `convert-${imageId}` },
    );
  } catch (err) {
    console.error(`[validateAndEnqueue] Failed for ${imageId}:`, err);
    await prisma.image.update({
      where: { id: imageId },
      data: {
        status: 'REJECTED',
        rejectionReason: 'Processing failed unexpectedly. Please try again.',
      },
    }).catch(() => {});
  }
}

/** POST /api/images/upload */
export async function upload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;

    // NOTE: HEIC conversion is no longer done here — the Conversion Worker
    // handles format normalisation so the pipeline services match the spec.

    const image = await prisma.image.create({
      data: {
        originalName: sanitizeFilename(req.file.originalname),
        mimeType,
        sizeBytes: buffer.length,
        status: 'PROCESSING',
      },
    });

    res.status(202).json(image);

    setImmediate(() => {
      validateAndEnqueue(image.id, buffer, mimeType).catch((err) =>
        console.error('[upload] validateAndEnqueue error:', err),
      );
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/images — cursor pagination */
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = Math.min(parseInt(req.query['limit'] as string) || 20, 100);
    const cursor = req.query['cursor'] as string | undefined;
    const status = req.query['status'] as string | undefined;

    const where: Record<string, unknown> = {};
    if (status && ['ACCEPTED', 'REJECTED', 'PROCESSING'].includes(status)) {
      where['status'] = status;
    }

    const images = await prisma.image.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = images.length > limit;
    const data = hasMore ? images.slice(0, limit) : images;
    const nextCursor = hasMore ? data[data.length - 1]?.id ?? null : null;

    res.json({ data, nextCursor, hasMore });
  } catch (err) {
    next(err);
  }
}

/** GET /api/images/:id */
export async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const image = await prisma.image.findUnique({ where: { id: req.params['id'] } });
    if (!image) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(image);
  } catch (err) {
    next(err);
  }
}

/** GET /api/images/:id/status — lightweight pipeline status check */
export async function getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const image = await prisma.image.findUnique({
      where: { id: req.params['id'] },
      select: { id: true, status: true, processingStage: true, rejectionReason: true },
    });
    if (!image) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(image);
  } catch (err) {
    next(err);
  }
}

/** GET /api/images/:id/variants */
export async function getVariants(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const image = await prisma.image.findUnique({
      where: { id: req.params['id'] },
      include: { variants: true },
    });
    if (!image) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (image.status !== 'ACCEPTED') {
      res.status(409).json({
        error: 'Variants not yet available',
        processingStage: image.processingStage,
      });
      return;
    }

    const variants = Object.fromEntries(
      image.variants.map((v) => [
        v.variantType.toLowerCase(),
        {
          viewUrl:   `/api/images/${image.id}/variants/${v.variantType.toLowerCase()}/view`,
          widthPx:   v.widthPx,
          heightPx:  v.heightPx,
          sizeBytes: v.sizeBytes,
        },
      ]),
    );

    res.json({
      imageId:          image.id,
      compressionRatio: image.compressionRatio,
      processingStage:  image.processingStage,
      variants,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/images/:id/variants/:type/view — stream a specific variant from R2 */
export async function viewVariant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const variantType = req.params['type']?.toUpperCase() as 'THUMBNAIL' | 'WEB' | 'FULL';
    if (!['THUMBNAIL', 'WEB', 'FULL'].includes(variantType)) {
      res.status(400).json({ error: 'Invalid variant type. Use thumbnail, web, or full.' });
      return;
    }

    const variant = await prisma.imageVariant.findUnique({
      where: { imageId_variantType: { imageId: req.params['id'], variantType } },
    });
    if (!variant) {
      res.status(404).json({ error: 'Variant not found' });
      return;
    }

    const { stream, contentType } = await getObjectStream(variant.key);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

/** GET /api/images/:id/view — stream full image (backward compat) */
export async function viewUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const image = await prisma.image.findUnique({ where: { id: req.params['id'] } });
    if (!image || !image.storedKey) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const { stream, contentType } = await getObjectStream(image.storedKey);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/images/:id */
export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const image = await prisma.image.findUnique({
      where: { id: req.params['id'] },
      include: { variants: true },
    });
    if (!image) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const keysToDelete = [
      image.storedKey,
      image.stagingKey,
      ...image.variants.map((v) => v.key),
    ].filter(Boolean) as string[];

    await Promise.allSettled(keysToDelete.map((k) => deleteObject(k)));
    await prisma.image.delete({ where: { id: req.params['id'] } });
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
}
