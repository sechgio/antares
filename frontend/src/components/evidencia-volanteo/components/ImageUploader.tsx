import { useCallback, useMemo, useRef, useState } from 'react';
import { Upload, X, Trash2, ChevronDown, ChevronUp, Image as ImageIconSVG } from 'lucide-react';
import { ACCEPTED_IMAGE_TYPES } from '../constants';
import type { LocalImage } from '../types';

const VISIBLE_LIMIT = 10;

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
  const [expanded, setExpanded] = useState(false);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const fileList = Array.from(files);
    const errs = onAdd(fileList);
    if (errs.length) setErrors(errs);
  }, [onAdd]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const hasMore = images.length > VISIBLE_LIMIT;
  const visibleImages = useMemo(
    () => (expanded || !hasMore ? images : images.slice(0, VISIBLE_LIMIT)),
    [images, expanded, hasMore],
  );
  const hiddenCount = images.length - VISIBLE_LIMIT;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
        <ImageIconSVG size={14} />
        <span className="text-[11px] font-semibold uppercase tracking-wider">Imágenes de Evidencia</span>
      </div>

      <div
        onClick={() => inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        className={`group cursor-pointer rounded-md border px-4 py-4 flex items-center gap-3 transition-all ${
          isDragging
            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5'
            : 'border-transparent bg-[var(--bg-surface)] hover:bg-[var(--border-subtle)]/30'
        }`}
      >
        <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 transition-colors ${isDragging ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]' : 'bg-[var(--bg-base)] text-[var(--text-muted)] group-hover:text-[var(--text-primary)]'}`}>
          <Upload size={16} />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-[11px] font-medium text-[var(--text-primary)]">Cargar lote de fotos</span>
          <span className="text-[10px] text-[var(--text-muted)] truncate">Formatos PNG/JPG · Orden secuencial</span>
        </div>
        {images.length > 0 && (
          <div className="px-2 py-0.5 rounded-full bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] text-[10px] font-bold tracking-wide">
            {images.length}
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" multiple accept={ACCEPTED_IMAGE_TYPES.join(',')} className="hidden" onChange={(e) => handleFiles(e.target.files)} />

      {errors.length > 0 && (
        <div className="flex flex-col gap-1.5 px-2 py-1.5 rounded-md bg-red-500/10 border border-red-500/20">
          {errors.map((err, i) => (
            <span key={i} className="text-[10px] font-medium text-red-500">{err}</span>
          ))}
          <button type="button" className="text-[10px] font-medium text-red-600 self-start hover:underline" onClick={() => setErrors([])}>Descartar errores</button>
        </div>
      )}

      {images.length > 0 && (
        <div className="flex flex-col gap-3 mt-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-[var(--text-muted)]">
              Galería cargada
            </span>
            <button type="button" onClick={onClear} className="text-[10px] font-medium text-[var(--text-muted)] hover:text-red-500 flex items-center gap-1 transition-colors">
              <Trash2 size={12} />
              Vaciar galería
            </button>
          </div>
          
          <div className="grid grid-cols-5 gap-1.5">
            {visibleImages.map((img, idx) => (
              <div key={`${img.file.name}-${idx}`} className="relative group rounded-md overflow-hidden bg-[var(--bg-surface)] border border-[var(--border-subtle)] aspect-square">
                <img src={img.objectUrl} alt={img.file.name} loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110" />
                <div className="absolute top-0.5 left-0.5 bg-black/70 backdrop-blur-sm text-white text-[9px] font-medium px-1.5 py-0.5 rounded flex items-center justify-center">
                  {idx + 1}
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(idx)}
                  className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={`Eliminar imagen ${idx + 1}`}
                >
                  <X size={14} className="text-white" />
                </button>
              </div>
            ))}
          </div>
          
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="mt-1 mx-auto flex items-center gap-1.5 text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              {expanded ? (
                <><ChevronUp size={12} /> Ver menos</>
              ) : (
                <><ChevronDown size={12} /> Mostrar {hiddenCount} restantes</>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}