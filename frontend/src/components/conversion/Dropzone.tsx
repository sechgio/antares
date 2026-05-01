import Button from '../ui/Button';
import { Folder, Images, Plus, RotateCcw, UploadCloud } from 'lucide-react';

interface DropzoneProps {
  dragOver: boolean;
  onAddFiles: () => void;
  onAddFolder: () => void;
  fileCount?: number;
  onClear?: () => void;
  videoCount?: number;
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

  if (totalCount > 0) {
    return (
      <div
        className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-all duration-200 ${
          dragOver
            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 shadow-[0_0_20px_var(--accent-primary-glow)]'
            : 'bg-[var(--bg-surface)] border-[var(--border-subtle)]'
        }`}
      >
        <div className="flex items-center gap-4">
          <div className={`flex items-center justify-center w-9 h-9 rounded-xl ${dragOver ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'}`}>
            <Images className="h-4 w-4" />
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
          <Button variant="ghost" size="sm" onClick={onAddFiles}>
            <Plus className="h-3.5 w-3.5" />
            Agregar
          </Button>
          <Button variant="ghost" size="sm" onClick={onAddFolder}>
            <Folder className="w-3.5 h-3.5" />
            Carpeta
          </Button>
          <div className="w-px h-4 bg-[var(--border-medium)] mx-1" />
          <Button variant="ghost" size="sm" onClick={onClear} className="text-[var(--accent-red)] hover:text-[var(--accent-red)]">
            <RotateCcw className="h-3.5 w-3.5" />
            Limpiar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition-all duration-300 ${
        dragOver
          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5 shadow-[0_0_20px_var(--accent-primary-glow)]'
          : 'border-[var(--border-medium)] bg-[var(--bg-surface)]'
      }`}
    >
      <div className="mb-5">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-sm">
          <UploadCloud className="h-6 w-6 text-[var(--text-muted)]" />
        </div>
        <h3 className="mb-2 text-xl font-semibold text-[var(--text-primary)]">
          {dragOver ? 'Suelta los archivos aquí' : 'Arrastra imágenes o videos aquí'}
        </h3>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-[var(--text-muted)]">
          JPG, PNG, WEBP, TIFF, BMP, GIF · MP4, AVI, MOV, MKV
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={onAddFiles}>
          <Plus className="h-3.5 w-3.5" />
          Seleccionar archivos
        </Button>
        <Button variant="secondary" size="sm" onClick={onAddFolder}>
          <Folder className="h-3.5 w-3.5" />
          Escanear carpeta
        </Button>
      </div>
    </div>
  );
}
