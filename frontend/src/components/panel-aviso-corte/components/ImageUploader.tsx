import { useCallback, useRef, useState } from 'react';
import { Upload, X, Trash2, ImageIcon } from 'lucide-react';
import { ARIA_LABELS, ACCEPTED_IMAGE_TYPES } from '../constants';
import type { LocalImage } from '../types';

interface Props {
  images: LocalImage[];
  onAdd: (files: File[]) => string[];
  onRemove: (index: number) => void;
  onClear: () => void;
}

export default function ImageUploader({ images, onAdd, onRemove, onClear }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const fileList = Array.from(files).filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
    const errs = onAdd(fileList);
    if (errs.length) setErrors(errs);
  }, [onAdd]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div className="flex flex-col gap-2">
      {/* Drop zone */}
      <div
        aria-label={ARIA_LABELS.imageUploader}
        onClick={() => inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-4 flex items-center gap-3 transition-colors ${
          isDragging ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--accent-primary)]/50'
        }`}
      >
        <div className="w-9 h-9 rounded-lg bg-[var(--bg-elevated)] flex items-center justify-center shrink-0">
          <Upload size={16} className="text-[var(--text-muted)]" />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-medium text-[var(--text-primary)]">Arrastra imágenes o haz clic</span>
          <span className="text-[11px] text-[var(--text-muted)]">PNG, JPG, WebP · máx. 15 MB</span>
        </div>
        {images.length > 0 && (
          <span className="ml-auto px-2 py-0.5 rounded-full bg-[var(--accent-primary)] text-white text-[11px] font-bold">
            {images.length}
          </span>
        )}
      </div>
      <input ref={inputRef} type="file" multiple accept={ACCEPTED_IMAGE_TYPES.join(',')} className="hidden" onChange={(e) => handleFiles(e.target.files)} />

      {/* Errors */}
      {errors.length > 0 && (
        <div className="flex flex-col gap-1 px-1">
          {errors.map((err, i) => (
            <span key={i} className="text-[11px] text-red-500">{err}</span>
          ))}
          <button className="text-[11px] text-[var(--text-muted)] self-start hover:underline" onClick={() => setErrors([])}>Descartar</button>
        </div>
      )}

      {/* Thumbnail grid */}
      {images.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
              <ImageIcon size={11} />
              {images.length} imagen{images.length !== 1 && 'es'}
            </span>
            <button onClick={onClear} className="text-[11px] text-red-500 hover:text-red-400 flex items-center gap-1 transition-colors">
              <Trash2 size={11} />
              Limpiar
            </button>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {images.map((img, idx) => (
              <div key={idx} className="relative group rounded-md overflow-hidden border border-[var(--border-subtle)] aspect-square bg-[var(--bg-surface)]">
                <img src={img.objectUrl} alt={img.file.name} className="w-full h-full object-cover" />
                <button
                  onClick={() => onRemove(idx)}
                  className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={14} className="text-white" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
