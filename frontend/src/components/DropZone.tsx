import { useDropzone, type Accept } from 'react-dropzone';

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

  const className = [
    'dropzone',
    isDragActive && 'dropzone--active',
    isUploading && 'dropzone--disabled',
  ].filter(Boolean).join(' ');

  return (
    <div {...getRootProps({ className })} id="dropzone">
      <input {...getInputProps()} />

      <div className="dropzone__icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>

      <p className="dropzone__title">
        {isDragActive ? 'Drop images here…' : 'Drag & drop images, or click to select'}
      </p>
      <p className="dropzone__subtitle">
        Accepted: HEIC, PNG, JPEG — max 20 MB each
      </p>

      {isUploading && (
        <p className="dropzone__uploading">Uploading…</p>
      )}
    </div>
  );
}
