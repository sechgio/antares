import Button from '../ui/Button';

interface DropzoneProps {
  dragOver: boolean;
  onAddFiles: () => void;
  onAddFolder: () => void;
  fileCount?: number;
  onClear?: () => void;
  videoCount?: number;
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

export default function Dropzone({
  dragOver,
  onAddFiles,
  onAddFolder,
  fileCount = 0,
  onClear,
  videoCount = 0,
}: DropzoneProps) {
  const totalCount = fileCount + videoCount;
  const imageCount = fileCount;

  // When files exist: show a polished compact status bar
  if (totalCount > 0) {
    return (
      <div
        className={`flex items-center justify-between rounded-2xl border px-5 py-3 transition-all duration-200 ${
          dragOver
            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 shadow-[0_0_20px_rgba(94,106,210,0.08)]'
            : 'bg-[var(--bg-surface)] border-[var(--border-subtle)]'
        }`}
      >
        <div className="flex items-center gap-4">
          <div className={`flex items-center justify-center w-9 h-9 rounded-xl ${dragOver ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'}`}>
            <ImageIcon className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {imageCount} imagen{imageCount !== 1 ? 'es' : ''}{videoCount > 0 ? ` + ${videoCount} video${videoCount !== 1 ? 's' : ''}` : ''}
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              Listo para convertir
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onAddFiles}>+ Agregar</Button>
          <Button variant="ghost" size="sm" onClick={onAddFolder}>
            <FolderIcon className="w-3.5 h-3.5" />
            Carpeta
          </Button>
          <div className="w-px h-4 bg-[var(--border-medium)] mx-1" />
          <Button variant="ghost" size="sm" onClick={onClear} className="text-[var(--accent-red)] hover:text-[var(--accent-red)]">
            Limpiar
          </Button>
        </div>
      </div>
    );
  }

  // No files: show full dropzone area
  return (
    <div
      className={`flex flex-col items-center justify-center text-center rounded-2xl border-2 border-dashed transition-all duration-300 ${
        dragOver
          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5 scale-[1.01] shadow-[0_0_30px_rgba(94,106,210,0.1)]'
          : 'border-[var(--border-medium)] bg-[var(--bg-surface)] min-h-[55vh]'
      }`}
    >
      <div className="mb-8">
        <div className="w-20 h-20 rounded-2xl bg-[var(--bg-elevated)] flex items-center justify-center mb-5 border border-[var(--border-subtle)] shadow-sm">
          <UploadIcon className="w-9 h-9 text-[var(--text-muted)]" />
        </div>
        <h3 className="text-2xl font-semibold text-[var(--text-primary)] mb-2">
          {dragOver ? 'Suelta los archivos aquí' : 'Arrastra imágenes aquí'}
        </h3>
        <p className="text-sm text-[var(--text-muted)] max-w-sm mx-auto leading-relaxed">
          JPG, PNG, WEBP, TIFF, BMP, GIF<br />
          <span className="text-[var(--text-secondary)]">También soporta videos:</span> MP4, AVI, MOV, MKV
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={onAddFiles}>Seleccionar archivos</Button>
        <Button variant="secondary" size="sm" onClick={onAddFolder}>Escanear carpeta</Button>
      </div>
    </div>
  );
}
