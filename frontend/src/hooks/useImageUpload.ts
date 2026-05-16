import { useState, useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
import type {
  UploadEntry,
  ImageRecord,
  PaginatedResponse,
  VariantsResponse,
} from '../types/image';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
]);

const POLL_INTERVAL_MS = 2000;

interface UseImageUploadReturn {
  accepted: UploadEntry[];
  rejected: UploadEntry[];
  processing: UploadEntry[];
  isUploading: boolean;
  isLoading: boolean;
  addFiles: (files: File[]) => Promise<void>;
  deleteImage: (id: string) => Promise<void>;
  stats: { total: number; accepted: number; rejected: number; processing: number };
}

async function fetchVariants(imageId: string): Promise<VariantsResponse | null> {
  try {
    const { data } = await axios.get<VariantsResponse>(`/api/images/${imageId}/variants`);
    return data;
  } catch {
    return null;
  }
}

export function useImageUpload(): UseImageUploadReturn {
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    async function fetchExisting() {
      try {
        const { data } = await axios.get<PaginatedResponse>('/api/images?limit=100');
        const entries: UploadEntry[] = await Promise.all(
          data.data.map(async (img) => {
            const entry: UploadEntry = {
              id: img.id,
              file: new File([], img.originalName),
              // Use thumbnail variant as card preview for accepted images
              preview: img.status === 'ACCEPTED'
                ? `/api/images/${img.id}/variants/thumbnail/view`
                : null,
              status: img.status,
              processingStage: img.processingStage,
              rejectionReason: img.rejectionReason,
              widthPx: img.widthPx,
              heightPx: img.heightPx,
              compressionRatio: img.compressionRatio,
            };
            if (img.status === 'ACCEPTED') {
              const variantData = await fetchVariants(img.id);
              if (variantData) entry.variants = variantData.variants;
            }
            return entry;
          }),
        );
        setUploads(entries);
        for (const entry of entries) {
          if (entry.status === 'PROCESSING') startPolling(entry.id);
        }
      } catch (err) {
        console.error('Failed to fetch existing images:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchExisting();
    return () => {
      for (const timer of pollTimers.current.values()) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPolling = useCallback((imageId: string) => {
    if (pollTimers.current.has(imageId)) return;

    const timer = setInterval(async () => {
      try {
        const { data } = await axios.get<ImageRecord>(`/api/images/${imageId}`);

        // Update processingStage on every poll so users see real-time stage labels
        setUploads((prev) =>
          prev.map((e) =>
            e.id === imageId ? { ...e, processingStage: data.processingStage } : e,
          ),
        );

        if (data.status !== 'PROCESSING') {
          clearInterval(timer);
          pollTimers.current.delete(imageId);

          let variants = undefined;
          let preview: string | null = null;

          if (data.status === 'ACCEPTED') {
            const variantData = await fetchVariants(imageId);
            if (variantData) variants = variantData.variants;
            preview = `/api/images/${imageId}/variants/thumbnail/view`;
          }

          setUploads((prev) =>
            prev.map((e) =>
              e.id === imageId
                ? {
                    ...e,
                    status: data.status,
                    processingStage: data.processingStage,
                    rejectionReason: data.rejectionReason,
                    preview: preview ?? e.preview,
                    widthPx: data.widthPx,
                    heightPx: data.heightPx,
                    compressionRatio: data.compressionRatio,
                    variants,
                  }
                : e,
            ),
          );
        }
      } catch {
        setUploads((prev) => prev.filter((e) => e.id !== imageId));
        clearInterval(timer);
        pollTimers.current.delete(imageId);
      }
    }, POLL_INTERVAL_MS);

    pollTimers.current.set(imageId, timer);
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      setIsUploading(true);
      await Promise.allSettled(
        files.map(async (file) => {
          if (!ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
            setUploads((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                file,
                preview: null,
                status: 'REJECTED',
                processingStage: null,
                rejectionReason: 'Unsupported format. Only HEIC, PNG, and JPEG are allowed.',
              },
            ]);
            return;
          }

          const preview = URL.createObjectURL(file);
          const tempId = crypto.randomUUID();

          setUploads((prev) => [
            ...prev,
            {
              id: tempId,
              file,
              preview,
              status: 'PROCESSING',
              processingStage: 'PENDING',
              rejectionReason: null,
            },
          ]);

          try {
            const formData = new FormData();
            formData.append('image', file);
            const { data } = await axios.post<ImageRecord>('/api/images/upload', formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });

            setUploads((prev) =>
              prev.map((e) =>
                e.id === tempId
                  ? {
                      ...e,
                      id: data.id,
                      status: data.status,
                      processingStage: data.processingStage,
                      rejectionReason: data.rejectionReason,
                    }
                  : e,
              ),
            );
            if (data.status === 'PROCESSING') startPolling(data.id);
          } catch (err) {
            const reason =
              axios.isAxiosError(err) && err.response?.data?.error
                ? (err.response.data.error as string)
                : 'Upload failed. Please try again.';
            URL.revokeObjectURL(preview);
            setUploads((prev) =>
              prev.map((e) =>
                e.id === tempId
                  ? { ...e, status: 'REJECTED', processingStage: 'FAILED', rejectionReason: reason, preview: null }
                  : e,
              ),
            );
          }
        }),
      );
      setIsUploading(false);
    },
    [startPolling],
  );

  const deleteImage = useCallback(async (id: string) => {
    try {
      await axios.delete(`/api/images/${id}`);
    } catch {
      // already deleted or never persisted
    }
    setUploads((prev) => {
      const entry = prev.find((u) => u.id === id);
      if (entry?.preview) URL.revokeObjectURL(entry.preview);
      return prev.filter((u) => u.id !== id);
    });
    const timer = pollTimers.current.get(id);
    if (timer) {
      clearInterval(timer);
      pollTimers.current.delete(id);
    }
  }, []);

  const accepted = uploads.filter((u) => u.status === 'ACCEPTED');
  const rejected = uploads.filter((u) => u.status === 'REJECTED');
  const processing = uploads.filter((u) => u.status === 'PROCESSING');

  return {
    accepted,
    rejected,
    processing,
    isUploading,
    isLoading,
    addFiles,
    deleteImage,
    stats: {
      total: uploads.length,
      accepted: accepted.length,
      rejected: rejected.length,
      processing: processing.length,
    },
  };
}
