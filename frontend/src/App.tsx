import { DropZone } from './components/DropZone';
import { ImageGrid } from './components/ImageGrid';
import { useImageUpload } from './hooks/useImageUpload';

export default function App() {
  const { accepted, rejected, processing, isUploading, addFiles } = useImageUpload();

  return (
    <main>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>Argon Image Upload</h1>
        <p style={{ color: '#6e6e73', marginTop: 4 }}>
          Upload your images — we'll validate them automatically
        </p>
      </header>

      <DropZone onDrop={addFiles} isUploading={isUploading} />

      <ImageGrid images={processing} title="Processing" accent="#ff9500" />
      <ImageGrid images={accepted}  title="Accepted"   accent="#34c759" />
      <ImageGrid images={rejected}  title="Rejected"   accent="#ff3b30" />
    </main>
  );
}
