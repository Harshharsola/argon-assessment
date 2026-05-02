import { DropZone } from './components/DropZone';
import { ImageGrid } from './components/ImageGrid';
import { useImageUpload } from './hooks/useImageUpload';

export default function App() {
  const { accepted, rejected, processing, isUploading, isLoading, addFiles, deleteImage, stats } = useImageUpload();

  return (
    <>
      <header className="app-header">
        <div className="app-header__logo">Aragon</div>
        <h1 className="app-header__title">Image Upload & Validation</h1>
        <p className="app-header__subtitle">
          Upload your headshots — AI validates quality, faces, and duplicates automatically
        </p>
      </header>

      {/* Stats */}
      <div className="stats-bar" role="status" aria-label="Upload statistics">
        <div className="stat-pill">
          <span className="stat-pill__dot stat-pill__dot--total" />
          <span>Total</span>
          <span className="stat-pill__count">{stats.total}</span>
        </div>
        <div className="stat-pill">
          <span className="stat-pill__dot stat-pill__dot--accepted" />
          <span>Accepted</span>
          <span className="stat-pill__count">{stats.accepted}</span>
        </div>
        <div className="stat-pill">
          <span className="stat-pill__dot stat-pill__dot--rejected" />
          <span>Rejected</span>
          <span className="stat-pill__count">{stats.rejected}</span>
        </div>
        {stats.processing > 0 && (
          <div className="stat-pill">
            <span className="stat-pill__dot stat-pill__dot--processing" />
            <span>Processing</span>
            <span className="stat-pill__count">{stats.processing}</span>
          </div>
        )}
      </div>

      <DropZone onDrop={addFiles} isUploading={isUploading} />

      {isLoading ? (
        <div className="loading-state">
          <div className="loading-state__spinner" />
          <p>Loading images…</p>
        </div>
      ) : (
        <>
          <ImageGrid images={processing} title="Processing" variant="processing" onDelete={deleteImage} />
          <ImageGrid images={accepted}   title="Accepted"   variant="accepted"   onDelete={deleteImage} />
          <ImageGrid images={rejected}   title="Rejected"   variant="rejected"   onDelete={deleteImage} />

          {stats.total === 0 && (
            <div className="empty-state">
              <div className="empty-state__icon">📷</div>
              <p>No images uploaded yet. Drop some files above to get started.</p>
            </div>
          )}
        </>
      )}
    </>
  );
}
