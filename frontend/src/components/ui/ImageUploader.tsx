import type { ReactNode } from 'react';
import { Upload, X, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useImageUploaderState } from '../../hooks/useImageUploaderState';
import type { ImageAsset } from '../../types/imageAssets';
import Button from './Button';

type ImageUploaderVariant = 'dashed' | 'flat';

interface ImageUploaderLabels {
  dropzoneTitle: string;
  dropzoneSubtitle: string;
  dropzoneAriaLabel: string;
  dismissErrors: string;
  galleryTitle: (count: number) => ReactNode;
  clearLabel: string;
  expandMore: (hiddenCount: number) => ReactNode;
}

interface ImageUploaderProps {
  images: ImageAsset[];
  onAdd: (files: File[]) => string[] | Promise<string[]>;
  onRemove: (index: number) => void;
  onClear: () => void;
  variant: ImageUploaderVariant;
  accept: string;
  labels: ImageUploaderLabels;
  header?: ReactNode;
  acceptFile?: (file: File) => boolean;
}

const SKINS = {
  dashed: {
    wrapper: 'flex flex-col gap-2',
    zoneBase: 'cursor-pointer rounded-lg border-2 border-dashed px-3 py-3 flex items-center gap-2.5 transition-colors',
    zoneIdle: 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--accent-primary)]/50',
    iconBox: () => 'w-8 h-8 rounded-md bg-[var(--bg-elevated)] flex items-center justify-center shrink-0',
    iconSize: 14,
    iconClassName: 'text-[var(--text-muted)]',
    badge: 'ml-auto px-2 py-0.5 rounded-full bg-[var(--accent-primary)] text-[var(--text-on-accent)] text-[11px] font-bold',
    errorsBox: 'flex flex-col gap-1 px-1',
    errorText: 'text-[11px] text-[var(--accent-red)]',
    dismissClass: 'text-[11px] text-[var(--text-muted)] self-start hover:underline',
    galleryWrap: 'flex flex-col gap-2',
    galleryHeader: 'flex items-center justify-between px-0.5',
    galleryHeaderText: 'text-[11px] text-[var(--text-muted)] flex items-center gap-1',
    clearClass: 'text-[11px] text-[var(--accent-red)] hover:opacity-80',
    grid: 'grid grid-cols-5 gap-1.5 place-items-center',
    item: 'relative group rounded-md overflow-hidden border border-[var(--border-subtle)] aspect-square w-full bg-[var(--bg-surface)]',
    img: 'w-full h-full object-cover',
    imgDecoding: 'async' as const,
    overlayAlpha: '50%',
    showIndexBadge: false,
    expandClass: 'mx-auto flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-full text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-subtle)] transition-all',
  },
  flat: {
    wrapper: 'flex flex-col gap-3',
    zoneBase: 'group cursor-pointer rounded-md border px-4 py-4 flex items-center gap-3 transition-all',
    zoneIdle: 'border-transparent bg-[var(--bg-surface)] hover:bg-[var(--border-subtle)]/30',
    iconBox: (isDragging: boolean) =>
      `w-9 h-9 rounded-md flex items-center justify-center shrink-0 transition-colors ${isDragging ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]' : 'bg-[var(--bg-base)] text-[var(--text-muted)] group-hover:text-[var(--text-primary)]'}`,
    iconSize: 16,
    iconClassName: undefined as string | undefined,
    badge: 'px-2 py-0.5 rounded-full bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] text-[10px] font-bold tracking-wide',
    errorsBox: 'flex flex-col gap-1.5 px-2 py-1.5 rounded-md bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/20',
    errorText: 'text-[10px] font-medium text-[var(--accent-red)]',
    dismissClass: 'text-[10px] font-medium text-[var(--accent-red)] self-start hover:underline',
    galleryWrap: 'flex flex-col gap-3 mt-1',
    galleryHeader: 'flex items-center justify-between',
    galleryHeaderText: 'text-[10px] font-medium text-[var(--text-muted)]',
    clearClass: 'text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--accent-red)]',
    grid: 'grid grid-cols-5 gap-1.5',
    item: 'relative group rounded-md overflow-hidden bg-[var(--bg-surface)] border border-[var(--border-subtle)] aspect-square',
    img: 'w-full h-full object-cover transition-transform duration-300 group-hover:scale-110',
    imgDecoding: undefined as 'async' | undefined,
    overlayAlpha: '60%',
    showIndexBadge: true,
    expandClass: 'mt-1 mx-auto flex items-center gap-1.5 text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors',
  },
} satisfies Record<ImageUploaderVariant, Record<string, unknown>>;

const ZONE_DRAGGING = 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/5';

export default function ImageUploader({
  images,
  onAdd,
  onRemove,
  onClear,
  variant,
  accept,
  labels,
  header,
  acceptFile,
}: ImageUploaderProps) {
  const skin = SKINS[variant];
  const {
    inputRef,
    isDragging,
    errors,
    expanded,
    hasMore,
    hiddenCount,
    visibleImages,
    handleFiles,
    onDrop,
    onDragOver,
    onDragLeave,
    clearErrors,
    toggleExpanded,
  } = useImageUploaderState({ images, onAdd, acceptFile });

  return (
    <div className={skin.wrapper}>
      {header}
      <div
        role="button"
        tabIndex={0}
        aria-label={labels.dropzoneAriaLabel}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`${skin.zoneBase} ${isDragging ? ZONE_DRAGGING : skin.zoneIdle}`}
      >
        <div className={skin.iconBox(isDragging)}>
          <Upload size={skin.iconSize} className={skin.iconClassName} />
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-[11px] font-medium text-[var(--text-primary)]">{labels.dropzoneTitle}</span>
          <span className="text-[10px] text-[var(--text-muted)] truncate">{labels.dropzoneSubtitle}</span>
        </div>
        {images.length > 0 && (
          <span className={skin.badge}>
            {images.length}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {errors.length > 0 && (
        <div className={skin.errorsBox}>
          {errors.map((err, i) => (
            <span key={i} className={skin.errorText}>{err}</span>
          ))}
          <Button variant="none" size="none" className={skin.dismissClass} onClick={clearErrors}>{labels.dismissErrors}</Button>
        </div>
      )}

      {images.length > 0 && (
        <div className={skin.galleryWrap}>
          <div className={skin.galleryHeader}>
            <span className={skin.galleryHeaderText}>
              {labels.galleryTitle(images.length)}
            </span>
            <Button variant="none" size="none" onClick={onClear} className={`${skin.clearClass} flex items-center gap-1 transition-colors`}>
              <Trash2 size={variant === 'dashed' ? 11 : 12} />
              {labels.clearLabel}
            </Button>
          </div>

          <div className={skin.grid}>
            {visibleImages.map((img, idx) => (
              <div key={`${img.file.name}-${idx}`} className={skin.item}>
                <img
                  src={img.objectUrl}
                  alt={img.file.name}
                  loading="lazy"
                  decoding={skin.imgDecoding}
                  className={skin.img}
                />
                {skin.showIndexBadge && (
                  <div className="absolute top-0.5 left-0.5 backdrop-blur-sm text-[var(--text-primary)] text-[9px] font-medium px-1.5 py-0.5 rounded flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 70%, transparent)' }}>
                    {idx + 1}
                  </div>
                )}
                <Button variant="none" size="none"
                  aria-label={`Eliminar imagen ${idx + 1}`}
                  onClick={() => onRemove(idx)}
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ backgroundColor: `color-mix(in srgb, var(--bg-base) ${skin.overlayAlpha}, transparent)` }}
                >
                  <X size={14} className="text-[var(--text-primary)]" />
                </Button>
              </div>
            ))}
          </div>

          {hasMore && (
            <Button variant="none" size="none"
              onClick={toggleExpanded}
              className={skin.expandClass}
            >
              {expanded ? (
                <>
                  <ChevronUp size={12} />
                  Ver menos
                </>
              ) : (
                <>
                  <ChevronDown size={12} />
                  {labels.expandMore(hiddenCount)}
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
