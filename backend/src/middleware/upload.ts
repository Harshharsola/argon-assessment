import multer, { type FileFilterCallback } from 'multer';
import type { Request } from 'express';

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
]);

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  if (ALLOWED_MIMES.has(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    const err = Object.assign(
      new Error('Only HEIC, PNG, and JPEG formats are allowed'),
      { status: 400 }
    );
    cb(err);
  }
};

export default multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});
