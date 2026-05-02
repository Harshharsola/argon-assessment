export type ImageStatus = 'PROCESSING' | 'ACCEPTED' | 'REJECTED';

/** Shape returned by the backend API */
export interface ImageRecord {
  id: string;
  originalName: string;
  storedKey: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  widthPx: number | null;
  heightPx: number | null;
  status: ImageStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
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
}
