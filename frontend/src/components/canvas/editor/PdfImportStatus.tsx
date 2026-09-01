import type { PdfImportProgress, PdfImportReport } from '../import/pdfImportTypes';

interface PdfImportStatusProps {
  progress: PdfImportProgress | null;
  report: PdfImportReport | null;
  error?: string | null;
  importing: boolean;
  onCancel: () => void;
}

export default function PdfImportStatus({
  progress,
  report,
  error,
  importing,
  onCancel,
}: PdfImportStatusProps) {
  if (!importing && !report && !error) return null;
  return (
    <aside className="absolute bottom-3 left-1/2 z-30 w-[min(28rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-md border border-[var(--cv-border)] bg-[var(--cv-bg)]/95 p-3 text-xs shadow-lg" role="status">
      {progress ? (
        <div className="flex items-center justify-between gap-3">
          <span>
            PDF: {progress.stage} · página {progress.page}/{progress.totalPages || '…'} · {progress.layers} capas · {progress.skipped} omitidos
          </span>
          {importing ? (
            <button type="button" className="shrink-0 rounded border px-2 py-1" onClick={onCancel}>
              Cancelar
            </button>
          ) : null}
        </div>
      ) : null}
      {!progress && importing ? (
        <div className="flex items-center justify-between gap-3">
          <span>Procesando PDF…</span>
          <button type="button" className="shrink-0 rounded border px-2 py-1" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      ) : null}
      {error ? <p className="text-red-600">{error}</p> : null}
      {report && !importing ? (
        <p className="mt-1 text-[var(--cv-text-muted)]">
          {report.importedCount} importados · {report.skippedCount} aproximados u omitidos
        </p>
      ) : null}
      {report?.issues.length ? (
        <ul className="mt-1 max-h-24 overflow-auto text-[var(--cv-text-muted)]">
          {report.issues.slice(0, 5).map((issue) => (
            <li key={`${issue.pageNumber}-${issue.reason}`}>
              Página {issue.pageNumber}: {issue.message} ({issue.count})
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
