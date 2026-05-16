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

// ── Pipeline types ─────────────────────────────────────────────────────────────

export type PipelineStage = 'CONVERSION' | 'COMPRESSION' | 'VARIANT_GENERATION';
export type JobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
export type VariantType = 'THUMBNAIL' | 'WEB' | 'FULL';

export interface ClaimedJob {
  id: string;
  imageId: string;
  stage: PipelineStage;
  attempts: number;
}

export interface VariantSpec {
  type: VariantType;
  width: number;
  height: number | null; // null = preserve aspect ratio
  fit: 'cover' | 'inside';
}

export const VARIANT_SPECS: VariantSpec[] = [
  { type: 'THUMBNAIL', width: 150, height: 150,  fit: 'cover'  },
  { type: 'WEB',       width: 800, height: null,  fit: 'inside' },
  { type: 'FULL',      width: 3000, height: null, fit: 'inside' }, // passthrough for normal portraits
];
