export type ImageStatus = 'PROCESSING' | 'ACCEPTED' | 'REJECTED';

export type ProcessingStage =
  | 'PENDING'
  | 'CONVERTING'
  | 'COMPRESSING'
  | 'GENERATING_VARIANTS'
  | 'COMPLETE'
  | 'FAILED';

export interface ImageVariant {
  viewUrl: string;
  widthPx: number;
  heightPx: number;
  sizeBytes: number;
}

export interface ImageVariants {
  thumbnail?: ImageVariant;
  web?: ImageVariant;
  full?: ImageVariant;
}

/** Shape returned by GET /api/images/:id */
export interface ImageRecord {
  id: string;
  originalName: string;
  storedKey: string | null;
  url: string | null;
  mimeType: string;
  sizeBytes: number;
  widthPx: number | null;
  heightPx: number | null;
  status: ImageStatus;
  processingStage: ProcessingStage | null;
  rejectionReason: string | null;
  compressionRatio: number | null;
  pHash: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Shape returned by GET /api/images/:id/variants */
export interface VariantsResponse {
  imageId: string;
  compressionRatio: number | null;
  processingStage: ProcessingStage;
  variants: ImageVariants;
}

/** Paginated API response */
export interface PaginatedResponse {
  data: ImageRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Local upload entry (before and after API response) */
export interface UploadEntry {
  id: string;
  file: File;
  preview: string | null;
  status: ImageStatus;
  processingStage: ProcessingStage | null;
  rejectionReason: string | null;
  widthPx?: number | null;
  heightPx?: number | null;
  compressionRatio?: number | null;
  variants?: ImageVariants;
}
