import type { CSSProperties } from 'react';
import type { UploadEntry } from '../types/image';
import { ImageCard } from './ImageCard';

interface ImageGridProps {
  images: UploadEntry[];
  title: string;
  accent: string;
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: 16,
};

export function ImageGrid({ images, title, accent }: ImageGridProps) {
  if (images.length === 0) return null;

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
        <span style={{ color: accent }} aria-hidden="true">● </span>
        {title}{' '}
        <span style={{ color: '#6e6e73', fontWeight: 400 }}>({images.length})</span>
      </h2>
      <div style={gridStyle} role="list" aria-label={`${title} images`}>
        {images.map((entry) => (
          <div key={entry.id} role="listitem">
            <ImageCard entry={entry} />
          </div>
        ))}
      </div>
    </section>
  );
}
