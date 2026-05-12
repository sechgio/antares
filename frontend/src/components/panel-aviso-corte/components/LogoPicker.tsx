import { useCallback, useRef, useState } from 'react';
import { ImagePlus, X, Upload } from 'lucide-react';
import { ARIA_LABELS, ACCEPTED_IMAGE_TYPES, ACCEPTED_IMAGE_EXTENSIONS } from '../constants';
import type { LogoAsset } from '../types';

interface Props {
  right: LogoAsset | null;
  onRight: (file: File | null) => string | null;
}

export default function LogoPicker({ right, onRight }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback((file: File | null) => {
    if (!file) return;
    const err = onRight(file);
    if (err) alert(err);
  }, [onRight]);

  const openFilePicker = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    // Reset value so re-selecting the same file triggers onChange
    input.value = '';
    input.click();
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onRight(null);
  }, [onRight]);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-[var(--text-muted)]">Logo del panel</span>
      <div
        role="button"
        tabIndex={0}
        aria-label={ARIA_LABELS.logoRight}
        onClick={openFilePicker}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openFilePicker(); }}
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        className={`relative cursor-pointer rounded-lg border border-dashed overflow-hidden transition-all duration-200 ${
          dragging
            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/8 shadow-[0_0_0_2px_var(--accent-primary)/15]'
            : 'border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/50 hover:bg-[var(--bg-surface)]'
        }`}
      >
        {right ? (
          /* ── Logo loaded state ── */
          <div className="flex items-center gap-3 p-2.5">
            <div className="w-10 h-10 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center overflow-hidden shrink-0">
              <img src={right.objectUrl} alt="" className="w-full h-full object-contain p-0.5" />
            </div>
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span className="text-[11px] font-medium text-[var(--text-primary)] truncate">
                {right.file.name}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">
                {(right.file.size / 1024).toFixed(0)} KB · Click para cambiar
              </span>
            </div>
            <button
              type="button"
              onClick={handleRemove}
              className="p-1 rounded-md text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
              aria-label="Quitar logo"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          /* ── Empty state ── */
          <div className="flex items-center gap-3 p-2.5">
            <div className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 transition-colors ${
              dragging ? 'bg-[var(--accent-primary)]/10' : 'bg-[var(--bg-surface)]'
            }`}>
              {dragging ? (
                <Upload size={16} className="text-[var(--accent-primary)]" />
              ) : (
                <ImagePlus size={16} className="text-[var(--text-muted)]" />
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                {dragging ? 'Suelta aquí' : 'Seleccionar logo'}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">
                PNG, JPG, WebP · máx. 5 MB
              </span>
            </div>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={[...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_IMAGE_EXTENSIONS].join(',')}
        className="hidden"
        onChange={handleInputChange}
      />
    </div>
  );
}
