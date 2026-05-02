import { useState, useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
import type { UploadEntry, ImageRecord, PaginatedResponse } from '../types/image';

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

export function useImageUpload(): UseImageUploadReturn {
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Fetch existing images on mount
  useEffect(() => {
    async function fetchExisting() {
      try {
        const { data } = await axios.get<PaginatedResponse>('/api/images?limit=100');
        const entries: UploadEntry[] = data.data.map((img) => ({
          id: img.id,
          file: new File([], img.originalName), // placeholder File for display purposes
          preview: img.status === 'ACCEPTED' ? `/api/images/${img.id}/view` : null,
          status: img.status,
          rejectionReason: img.rejectionReason,
          widthPx: img.widthPx,
          heightPx: img.heightPx,
        }));
        setUploads(entries);

        // Start polling for any images still processing
        for (const entry of entries) {
          if (entry.status === 'PROCESSING') {
            startPolling(entry.id);
          }
        }
      } catch (err) {
        console.error('Failed to fetch existing images:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchExisting();

    // Cleanup all polling on unmount
    return () => {
      for (const timer of pollTimers.current.values()) {
        clearInterval(timer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Start polling for a PROCESSING image until it transitions */
  const startPolling = useCallback((imageId: string) => {
    if (pollTimers.current.has(imageId)) return;

    const timer = setInterval(async () => {
      try {
        const { data } = await axios.get<ImageRecord>(`/api/images/${imageId}`);

        if (data.status !== 'PROCESSING') {
          // Image finished processing — update state and stop polling
          setUploads((prev) =>
            prev.map((entry) =>
              entry.id === imageId
                ? {
                    ...entry,
                    status: data.status,
                    rejectionReason: data.rejectionReason,
                    preview: entry.preview ?? data.url ?? null, // keep blob URL; only use server URL if no local preview
                    widthPx: data.widthPx,
                    heightPx: data.heightPx,
                  }
                : entry
            )
          );
          clearInterval(timer);
          pollTimers.current.delete(imageId);
        }
      } catch {
        // If we get 404, the image was deleted — remove from state
        setUploads((prev) => prev.filter((entry) => entry.id !== imageId));
        clearInterval(timer);
        pollTimers.current.delete(imageId);
      }
    }, POLL_INTERVAL_MS);

    pollTimers.current.set(imageId, timer);
  }, []);

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

          // Update with server ID; status will be PROCESSING (async)
          setUploads((prev) =>
            prev.map((entry) =>
              entry.id === tempId
                ? { ...entry, id: data.id, status: data.status, rejectionReason: data.rejectionReason }
                : entry
            )
          );

          // If still PROCESSING, start polling
          if (data.status === 'PROCESSING') {
            startPolling(data.id);
          }
        } catch (err) {
          const reason =
            axios.isAxiosError(err) && err.response?.data?.error
              ? (err.response.data.error as string)
              : 'Upload failed. Please try again.';

          // Revoke the preview URL on failure
          URL.revokeObjectURL(preview);

          setUploads((prev) =>
            prev.map((entry) =>
              entry.id === tempId
                ? { ...entry, status: 'REJECTED', rejectionReason: reason, preview: null }
                : entry
            )
          );
        }
      })
    );

    setIsUploading(false);
  }, [startPolling]);

  const deleteImage = useCallback(async (id: string) => {
    try {
      await axios.delete(`/api/images/${id}`);
    } catch {
      // Image may have already been deleted or was never persisted
    }

    setUploads((prev) => {
      const entry = prev.find((u) => u.id === id);
      if (entry?.preview) {
        URL.revokeObjectURL(entry.preview);
      }
      return prev.filter((u) => u.id !== id);
    });

    // Clear any active polling for this image
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
