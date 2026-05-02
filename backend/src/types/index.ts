import type { Request } from 'express';

/** Extends Express Request to include the Multer file */
export interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

/** Subset of sharp metadata we use internally */
export interface ImageMeta {
  format: string;
  width: number;
  height: number;
}

export type ValidationResult =
  | { valid: true; meta: ImageMeta }
  | { valid: false; reason: string };
