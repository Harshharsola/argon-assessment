import { useState, useCallback } from 'react';
import axios from 'axios';
import type { UploadEntry, ImageRecord } from '../types/image';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
]);

interface UseImageUploadReturn {
  accepted: UploadEntry[];
  rejected: UploadEntry[];
  processing: UploadEntry[];
  isUploading: boolean;
  addFiles: (files: File[]) => Promise<void>;
}

export function useImageUpload(): UseImageUploadReturn {
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const addFiles = useCallback(async (files: File[]) => {
    setIsUploading(true);

    await Promise.allSettled(
      files.map(async (file) => {
        // Frontend format validation — no network call needed
        if (!ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
          setUploads((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              file,
              preview: null,
              status: 'REJECTED',
              rejectionReason: 'Unsupported format. Only HEIC, PNG, and JPEG are allowed.',
            },
          ]);
          return;
        }

        const preview = URL.createObjectURL(file);
        const tempId = crypto.randomUUID();

        // Optimistically add as PROCESSING
        setUploads((prev) => [
          ...prev,
          { id: tempId, file, preview, status: 'PROCESSING', rejectionReason: null },
        ]);

        try {
          const formData = new FormData();
          formData.append('image', file);

          const { data } = await axios.post<ImageRecord>('/api/images/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });

          setUploads((prev) =>
            prev.map((entry) =>
              entry.id === tempId
                ? { ...entry, id: data.id, status: data.status, rejectionReason: data.rejectionReason }
                : entry
            )
          );
        } catch (err) {
          const reason =
            axios.isAxiosError(err) && err.response?.data?.error
              ? (err.response.data.error as string)
              : 'Upload failed. Please try again.';

          setUploads((prev) =>
            prev.map((entry) =>
              entry.id === tempId
                ? { ...entry, status: 'REJECTED', rejectionReason: reason }
                : entry
            )
          );
        }
      })
    );

    setIsUploading(false);
  }, []);

  return {
    accepted: uploads.filter((u) => u.status === 'ACCEPTED'),
    rejected: uploads.filter((u) => u.status === 'REJECTED'),
    processing: uploads.filter((u) => u.status === 'PROCESSING'),
    isUploading,
    addFiles,
  };
}
