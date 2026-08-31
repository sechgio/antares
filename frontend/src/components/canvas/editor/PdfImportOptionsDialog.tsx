import { useState } from 'react';
import type { PdfImportOptionsValue, PdfImportPreflight } from '../import/pdfImportTypes';
import { DEFAULT_PDF_IMPORT_LIMITS } from '../import/pdfImportLimits';

interface PdfImportOptionsDialogProps {
  preflight: PdfImportPreflight;
  onCancel: () => void;
  onConfirm: (options: PdfImportOptionsValue) => void;
}

export default function PdfImportOptionsDialog({
  preflight,
  onCancel,
  onConfirm,
}: PdfImportOptionsDialogProps) {
  const maxSelectablePage = Math.min(preflight.pageCount, DEFAULT_PDF_IMPORT_LIMITS.maxPages);
  const [pageStart, setPageStart] = useState(1);
  const [pageEnd, setPageEnd] = useState(Math.max(1, maxSelectablePage));
  const [mixedPagePolicy, setMixedPagePolicy] = useState<'reject' | 'scale-to-first'>('reject');

  const clampPage = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(maxSelectablePage, Math.max(1, Math.floor(value)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-import-options-title"
        className="w-full max-w-md rounded-lg border border-[var(--cv-border)] bg-[var(--cv-bg)] p-5 shadow-xl"
      >
        <h2 id="pdf-import-options-title" className="text-sm font-semibold">Importar PDF</h2>
        <p className="mt-1 text-xs text-[var(--cv-text-muted)]">
          {preflight.pageCount} páginas detectadas. Selecciona el rango editable.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-xs">
            Desde
            <input
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
              type="number"
              min={1}
              max={maxSelectablePage}
              value={pageStart}
              onChange={(event) => setPageStart(clampPage(Number(event.target.value), pageStart))}
            />
          </label>
          <label className="text-xs">
            Hasta
            <input
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
              type="number"
              min={1}
              max={maxSelectablePage}
              value={pageEnd}
              onChange={(event) => setPageEnd(clampPage(Number(event.target.value), pageEnd))}
            />
          </label>
        </div>
        {preflight.hasMixedPageSizes ? (
          <fieldset className="mt-4 space-y-2 text-xs">
            <legend className="font-medium">Tamaños de página diferentes</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="pdf-mixed-page-policy"
                checked={mixedPagePolicy === 'reject'}
                onChange={() => setMixedPagePolicy('reject')}
              />
              Rechazar importación
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="pdf-mixed-page-policy"
                checked={mixedPagePolicy === 'scale-to-first'}
                onChange={() => setMixedPagePolicy('scale-to-first')}
              />
              Escalar al primer tamaño
            </label>
          </fieldset>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1.5 text-xs" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="rounded bg-[var(--cv-accent)] px-3 py-1.5 text-xs text-white"
            disabled={pageStart > pageEnd}
            onClick={() => onConfirm({ pageStart, pageEnd, mixedPagePolicy })}
          >
            Importar
          </button>
        </div>
      </section>
    </div>
  );
}
