import type { CSSProperties } from 'react';
import type { UploadEntry } from '../types/image';

interface ImageCardProps {
  entry: UploadEntry;
}

const cardStyle: CSSProperties = {
  borderRadius: 12,
  overflow: 'hidden',
  background: '#fff',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  position: 'relative',
};

const thumbStyle: CSSProperties = {
  width: '100%',
  height: 180,
  objectFit: 'cover',
  display: 'block',
};

const placeholderStyle: CSSProperties = {
  width: '100%',
  height: 180,
  background: '#f5f5f7',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 40,
};

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  fontWeight: 600,
};

export function ImageCard({ entry }: ImageCardProps) {
  const isProcessing = entry.status === 'PROCESSING';

  return (
    <article style={cardStyle}>
      {entry.preview ? (
        <img src={entry.preview} alt={entry.file.name} style={thumbStyle} />
      ) : (
        <div style={placeholderStyle} aria-hidden="true">
          🖼️
        </div>
      )}

      {isProcessing && (
        <div style={overlayStyle} role="status" aria-label="Processing">
          Processing…
        </div>
      )}

      <div style={{ padding: '8px 10px' }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={entry.file.name}
        >
          {entry.file.name}
        </p>
        {entry.rejectionReason && (
          <p style={{ fontSize: 11, color: '#ff3b30', marginTop: 3, lineHeight: 1.3 }}>
            {entry.rejectionReason}
          </p>
        )}
      </div>
    </article>
  );
}
