import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import type { Request, Response, NextFunction } from 'express';
import { uploadBuffer, deleteObject } from './storage';
import { validateImage } from '../validators/imageValidator';

const prisma = new PrismaClient();

const HEIC_MIMES = new Set(['image/heic', 'image/heif']);

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

    const validation = await validateImage(buffer);

    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const key = `images/${uuidv4()}.${ext}`;
    const url = await uploadBuffer(key, buffer, mimeType);

    const { width, height } = await sharp(buffer).metadata();

    const image = await prisma.image.create({
      data: {
        originalName: req.file.originalname,
        storedKey: key,
        url,
        mimeType,
        sizeBytes: buffer.length,
        widthPx: width ?? null,
        heightPx: height ?? null,
        status: validation.valid ? 'ACCEPTED' : 'REJECTED',
        rejectionReason: validation.valid ? null : validation.reason,
      },
    });

    res.status(201).json(image);
  } catch (err) {
    next(err);
  }
}

/** GET /api/images */
export async function list(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const images = await prisma.image.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(images);
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

/** DELETE /api/images/:id */
export async function remove(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const image = await prisma.image.findUnique({ where: { id: req.params['id'] } });
    if (!image) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await deleteObject(image.storedKey);
    await prisma.image.delete({ where: { id: req.params['id'] } });
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
}
