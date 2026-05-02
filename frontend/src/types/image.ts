export type ImageStatus = 'PROCESSING' | 'ACCEPTED' | 'REJECTED';

/** Shape returned by the backend API */
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
  rejectionReason: string | null;
  pHash: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Paginated API response */
export interface PaginatedResponse {
  data: ImageRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Local upload entry (before and after API response) */
export interface UploadEntry {
  /** Temporary local ID before server responds; replaced by server ID on success */
  id: string;
  file: File;
  /** Object URL for preview — revoke when no longer needed */
  preview: string | null;
  status: ImageStatus;
  rejectionReason: string | null;
  /** Image dimensions from the server (available after processing) */
  widthPx?: number | null;
  heightPx?: number | null;
}
