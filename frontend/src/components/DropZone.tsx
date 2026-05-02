import { useDropzone, type Accept } from 'react-dropzone';
import type { CSSProperties } from 'react';

interface DropZoneProps {
  onDrop: (files: File[]) => Promise<void>;
  isUploading: boolean;
}

const ACCEPT: Accept = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
};

export function DropZone({ onDrop, isUploading }: DropZoneProps) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPT,
    multiple: true,
    disabled: isUploading,
  });

  const rootStyle: CSSProperties = {
    border: `2px dashed ${isDragActive ? '#0071e3' : '#d1d1d6'}`,
    borderRadius: 16,
    padding: '3rem 2rem',
    textAlign: 'center',
    cursor: isUploading ? 'not-allowed' : 'pointer',
    background: isDragActive ? '#f0f6ff' : '#fff',
    transition: 'border-color 0.2s, background 0.2s',
    opacity: isUploading ? 0.7 : 1,
  };

  return (
    <div {...getRootProps({ style: rootStyle })}>
      <input {...getInputProps()} />
      <p style={{ fontSize: 48, marginBottom: 12 }}>📸</p>
      <p style={{ fontWeight: 600, fontSize: 18, marginBottom: 6 }}>
        {isDragActive ? 'Drop images here…' : 'Drag & drop images, or click to select'}
      </p>
      <p style={{ color: '#6e6e73', fontSize: 14 }}>
        Accepted: HEIC, PNG, JPEG — max 20 MB each
      </p>
      {isUploading && (
        <p style={{ marginTop: 12, color: '#0071e3', fontWeight: 500 }}>Uploading…</p>
      )}
    </div>
  );
}
