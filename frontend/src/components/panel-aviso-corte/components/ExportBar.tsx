import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  totalPages?: number;
  pageIndex?: number;
  onPrev?: () => void;
  onNext?: () => void;
}

export default function ExportBar({ totalPages = 0, pageIndex = 0, onPrev, onNext }: Props) {
  return (
    <div className="flex items-center justify-between w-full">
      <span className="text-xs text-[var(--text-muted)] shrink-0">
        {totalPages > 0 ? `${totalPages} panel${totalPages !== 1 ? 'es' : ''}` : 'Sin paneles'}
      </span>

      {totalPages > 1 && (
        <div className="flex items-center gap-1.5">
          <button
            aria-label="Panel anterior"
            onClick={onPrev}
            disabled={pageIndex <= 0}
            className="p-1 rounded-md bg-[var(--bg-surface)] text-[var(--text-secondary)] disabled:opacity-30 border border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] text-[var(--text-secondary)] font-medium tabular-nums min-w-[60px] text-center">
            {pageIndex + 1} / {totalPages}
          </span>
          <button
            aria-label="Panel siguiente"
            onClick={onNext}
            disabled={pageIndex >= totalPages - 1}
            className="p-1 rounded-md bg-[var(--bg-surface)] text-[var(--text-secondary)] disabled:opacity-30 border border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
