import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import type { Request, Response, NextFunction } from 'express';
import { uploadBuffer, deleteObject, getPresignedUrl } from '../services/storage';
import { validateImage } from '../validators/imageValidator';
import { validateFaces } from '../validators/faceValidator';
import { computePHash, checkSimilarity } from '../validators/similarityValidator';

const prisma = new PrismaClient();

const HEIC_MIMES = new Set(['image/heic', 'image/heif']);

/**
 * Sanitize a filename to prevent path traversal and XSS.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\]/g, '_')        // strip path separators
    .replace(/\0/g, '')            // strip null bytes
    .replace(/[<>"'&]/g, '_')      // strip HTML-special chars
    .slice(0, 255);                // limit length
}

/**
 * Process an image asynchronously after the initial HTTP response.
 * In production this would use a proper job queue (Bull/BullMQ + Redis).
 */
async function processImage(
  imageId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<void> {
  try {
    // 1. Validate format, resolution, and blur
    const validation = await validateImage(buffer);
    if (!validation.valid) {
      await prisma.image.update({
        where: { id: imageId },
        data: { status: 'REJECTED', rejectionReason: validation.reason },
      });
      return;
    }

    // 2. Validate faces (exactly 1 face, large enough)
    const faceResult = await validateFaces(buffer);
    if (!faceResult.valid) {
      await prisma.image.update({
        where: { id: imageId },
        data: { status: 'REJECTED', rejectionReason: faceResult.reason ?? 'Face validation failed' },
      });
      return;
    }

    // 3. Check similarity against existing accepted images
    const pHash = await computePHash(buffer);
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

    // 4. All checks passed — upload to cloud storage
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const key = `images/${uuidv4()}.${ext}`;
    const url = await uploadBuffer(key, buffer, mimeType);

    const { width, height } = await sharp(buffer).metadata();

    await prisma.image.update({
      where: { id: imageId },
      data: {
        storedKey: key,
        url,
        widthPx: width ?? null,
        heightPx: height ?? null,
        status: 'ACCEPTED',
        pHash,
      },
    });
  } catch (err) {
    console.error(`[processImage] Failed for ${imageId}:`, err);
    await prisma.image.update({
      where: { id: imageId },
      data: {
        status: 'REJECTED',
        rejectionReason: 'Processing failed unexpectedly. Please try again.',
      },
    }).catch(() => {}); // Swallow DB errors during error handling
  }
}

/** POST /api/images/upload */
export async function upload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    let buffer = req.file.buffer;
    let mimeType = req.file.mimetype;

    // Convert HEIC → JPEG before processing
    if (HEIC_MIMES.has(mimeType)) {
      // heic-convert ships CJS without type declarations; import dynamically
      const heicConvert = (await import('heic-convert')).default as (opts: {
        buffer: Buffer;
        format: 'JPEG' | 'PNG';
        quality: number;
      }) => Promise<ArrayBuffer>;

      const converted = await heicConvert({ buffer, format: 'JPEG', quality: 0.9 });
      buffer = Buffer.from(converted);
      mimeType = 'image/jpeg';
    }

    // Create the DB record immediately as PROCESSING
    const image = await prisma.image.create({
      data: {
        originalName: sanitizeFilename(req.file.originalname),
        storedKey: null,
        url: null,
        mimeType,
        sizeBytes: buffer.length,
        widthPx: null,
        heightPx: null,
        status: 'PROCESSING',
        rejectionReason: null,
      },
    });

    // Respond immediately — processing happens in the background
    res.status(202).json(image);

    // Kick off async processing (non-blocking)
    // In production, this would enqueue to Bull/BullMQ with Redis
    setImmediate(() => {
      processImage(image.id, buffer, mimeType).catch((err) =>
        console.error('[upload] Background processing error:', err)
      );
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/images — with cursor pagination */
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
      take: limit + 1,  // fetch one extra to determine if there's a next page
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

/** GET /api/images/:id/view — presigned URL for private buckets */
export async function viewUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const image = await prisma.image.findUnique({ where: { id: req.params['id'] } });
    if (!image || !image.storedKey) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    // If bucket is public, redirect directly; otherwise generate presigned URL
    if (image.url) {
      res.redirect(image.url);
      return;
    }
    const url = await getPresignedUrl(image.storedKey);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/images/:id */
export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const image = await prisma.image.findUnique({ where: { id: req.params['id'] } });
    if (!image) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (image.storedKey) {
      await deleteObject(image.storedKey);
    }
    await prisma.image.delete({ where: { id: req.params['id'] } });
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
}
