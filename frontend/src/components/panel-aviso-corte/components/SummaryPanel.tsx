import type { MatchResult } from '../types';

interface Props {
  result: MatchResult | null;
  exportMode: 'skip_empty' | 'include_empty';
  onExportModeChange: (mode: 'skip_empty' | 'include_empty') => void;
}

export default function SummaryPanel({ result, exportMode, onExportModeChange }: Props) {
  if (!result) return null;
  const s = result.summary;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Resumen de emparejamiento</h3>
        <select
          aria-label="Modo de exportación"
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1 text-xs text-[var(--text-primary)]"
          value={exportMode}
          onChange={(e) => onExportModeChange(e.target.value as any)}
        >
          <option value="skip_empty">Omitir vacíos</option>
          <option value="include_empty">Incluir vacíos</option>
        </select>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-md bg-[var(--bg-elevated)] px-2 py-1.5">
          <span className="block text-[var(--text-muted)]">Filas</span>
          <span className="block font-semibold text-[var(--text-primary)]">{s.totalRows}</span>
        </div>
        <div className="rounded-md bg-[var(--bg-elevated)] px-2 py-1.5">
          <span className="block text-[var(--text-muted)]">Con imágenes</span>
          <span className="block font-semibold text-[var(--text-primary)]">{s.rowsWithImages}</span>
        </div>
        <div className="rounded-md bg-[var(--bg-elevated)] px-2 py-1.5">
          <span className="block text-[var(--text-muted)]">Imágenes</span>
          <span className="block font-semibold text-[var(--text-primary)]">{s.totalImages}</span>
        </div>
        <div className="rounded-md bg-[var(--bg-elevated)] px-2 py-1.5">
          <span className="block text-[var(--text-muted)]">Sin emparejar</span>
          <span className="block font-semibold text-[var(--text-primary)]">{s.unmatchedImages}</span>
        </div>
      </div>
      {result.warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Advertencias</span>
          {result.warnings.map((w, i) => (
            <span key={i} className="text-[11px] text-amber-600">{w}</span>
          ))}
        </div>
      )}
      {s.unmatchedImageNames.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Imágenes no emparejadas</span>
          <div className="flex flex-wrap gap-1">
            {s.unmatchedImageNames.map((n) => (
              <span key={n} className="px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[10px] text-[var(--text-muted)] border border-[var(--border-subtle)]">{n}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
