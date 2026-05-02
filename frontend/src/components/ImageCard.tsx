import type { UploadEntry } from '../types/image';

interface ImageCardProps {
  entry: UploadEntry;
  onDelete: (id: string) => Promise<void>;
}

export function ImageCard({ entry, onDelete }: ImageCardProps) {
  const isProcessing = entry.status === 'PROCESSING';
  const isRejected = entry.status === 'REJECTED';
  const isAccepted = entry.status === 'ACCEPTED';

  return (
    <article className="image-card" id={`image-card-${entry.id}`}>
      {/* Thumbnail area */}
      <div className="image-card__thumb-wrapper">
        {entry.preview ? (
          <img
            src={entry.preview}
            alt={entry.file.name}
            className="image-card__thumb"
            loading="lazy"
          />
        ) : (
          <div className="image-card__placeholder">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
        )}

        {/* Processing spinner overlay */}
        {isProcessing && (
          <div className="image-card__overlay image-card__overlay--processing" role="status" aria-label="Processing">
            <div className="image-card__spinner" />
          </div>
        )}

        {/* Rejected tint overlay */}
        {isRejected && entry.preview && (
          <div className="image-card__overlay image-card__overlay--rejected" />
        )}

        {/* Status badge */}
        {isAccepted && (
          <div className="image-card__status-badge image-card__status-badge--accepted" aria-label="Accepted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}
        {isRejected && (
          <div className="image-card__status-badge image-card__status-badge--rejected" aria-label="Rejected">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
        )}

        {/* Delete button */}
        <button
          className="image-card__delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(entry.id);
          }}
          aria-label={`Delete ${entry.file.name}`}
          title="Delete image"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Card body */}
      <div className="image-card__body">
        <p className="image-card__name" title={entry.file.name}>
          {entry.file.name}
        </p>
        {(entry.widthPx && entry.heightPx) && (
          <p className="image-card__meta">
            {entry.widthPx} × {entry.heightPx}px
          </p>
        )}
        {entry.rejectionReason && (
          <p className="image-card__rejection">
            {entry.rejectionReason}
          </p>
        )}
      </div>
    </article>
  );
}
