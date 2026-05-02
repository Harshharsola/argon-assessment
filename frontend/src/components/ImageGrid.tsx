import type { UploadEntry } from '../types/image';
import { ImageCard } from './ImageCard';

interface ImageGridProps {
  images: UploadEntry[];
  title: string;
  variant: 'accepted' | 'rejected' | 'processing';
  onDelete: (id: string) => Promise<void>;
}

export function ImageGrid({ images, title, variant, onDelete }: ImageGridProps) {
  if (images.length === 0) return null;

  return (
    <section className="image-section" aria-label={`${title} images`}>
      <div className="image-section__header">
        <span className={`image-section__badge image-section__badge--${variant}`}>
          {variant === 'accepted' && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          {variant === 'rejected' && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
          {variant === 'processing' && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          )}
          {title}
        </span>
        <span className="image-section__count">({images.length})</span>
      </div>

      <div className="image-grid" role="list" aria-label={`${title} images`}>
        {images.map((entry) => (
          <div key={entry.id} role="listitem">
            <ImageCard entry={entry} onDelete={onDelete} />
          </div>
        ))}
      </div>
    </section>
  );
}
