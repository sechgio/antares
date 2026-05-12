import { Download, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { ARIA_LABELS } from '../constants';

interface Props {
  canExport: boolean;
  isExporting: boolean;
  format: 'pdf' | 'docx';
  onFormatChange: (fmt: 'pdf' | 'docx') => void;
  onExport: () => void;
  totalPages?: number;
  pageIndex?: number;
  onPrev?: () => void;
  onNext?: () => void;
}

export default function ExportBar({ canExport, isExporting, format, onFormatChange, onExport, totalPages = 0, pageIndex = 0, onPrev, onNext }: Props) {
  return (
    <div className="flex items-center justify-between w-full">
      {/* Left: panel counter */}
      <span className="text-xs text-[var(--text-muted)] shrink-0">
        {totalPages > 0 ? `${totalPages} panel${totalPages !== 1 ? 'es' : ''}` : 'Sin paneles'}
      </span>

      {/* Center: pagination */}
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

      {/* Right: format + export */}
      <div className="flex items-center gap-2 shrink-0">
        <select
          aria-label="Formato de exportación"
          value={format}
          onChange={(e) => onFormatChange(e.target.value as 'pdf' | 'docx')}
          className="px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
        >
          <option value="pdf">PDF</option>
          <option value="docx">Word</option>
        </select>
        <button
          aria-label={ARIA_LABELS.exportButton}
          onClick={onExport}
          disabled={!canExport || isExporting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-primary)] text-white text-xs font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {isExporting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}
          {isExporting ? 'Exportando...' : `Exportar ${format.toUpperCase()}`}
        </button>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[10px] text-[var(--text-muted)]">
          Ctrl+Enter
        </kbd>
      </div>
    </div>
  );
}
