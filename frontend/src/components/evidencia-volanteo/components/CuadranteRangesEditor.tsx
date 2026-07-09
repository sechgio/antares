import { Plus, Trash2, MapPin } from 'lucide-react';
import { DEFAULT_CUADRANTE_LABEL } from '../constants';
import type { CuadranteRange } from '../types';

interface Props {
  ranges: CuadranteRange[];
  totalPages: number;
  cuadranteLabel: string;
  showCuadranteLabel: boolean;
  onCuadranteLabelChange: (value: string) => void;
  onShowCuadranteLabelChange: (value: boolean) => void;
  onChange: (ranges: CuadranteRange[]) => void;
  onAdd: () => void;
}

function updateRange(
  ranges: CuadranteRange[],
  id: string,
  patch: Partial<CuadranteRange>,
): CuadranteRange[] {
  return ranges.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

export default function CuadranteRangesEditor({
  ranges,
  totalPages,
  cuadranteLabel,
  showCuadranteLabel,
  onCuadranteLabelChange,
  onShowCuadranteLabelChange,
  onChange,
  onAdd,
}: Props) {
  const maxPage = Math.max(1, totalPages);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
          <MapPin size={14} />
          <span className="text-[11px] font-semibold uppercase tracking-wider">
            Cuadrantes por hojas
          </span>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 text-[10px] font-medium text-[var(--accent-primary)] hover:opacity-80 transition-opacity"
        >
          <Plus size={12} />
          Agregar
        </button>
      </div>

      <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 flex flex-col gap-2.5">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showCuadranteLabel}
            onChange={(e) => onShowCuadranteLabelChange(e.target.checked)}
            className="rounded border-[var(--border-subtle)] text-[var(--accent-primary)] focus:ring-[var(--accent-primary)]"
          />
          <span className="text-[11px] font-medium text-[var(--text-secondary)]">
            Mostrar etiqueta en el documento
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium text-[var(--text-muted)]">Texto de la etiqueta</span>
          <input
            type="text"
            value={cuadranteLabel}
            onChange={(e) => onCuadranteLabelChange(e.target.value)}
            disabled={!showCuadranteLabel}
            placeholder={DEFAULT_CUADRANTE_LABEL}
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] focus:border-[var(--accent-primary)] transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </label>
      </div>

      <div className="flex flex-col gap-3">
        {ranges.map((range, index) => (
          <div
            key={range.id}
            className="group rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 flex flex-col gap-3 transition-colors hover:border-[var(--text-muted)]/30"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
                Rango {index + 1}
              </span>
              {ranges.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(ranges.filter((r) => r.id !== range.id))}
                  className="p-1 text-[var(--text-muted)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Eliminar rango"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <label className="flex flex-col gap-1 flex-1 min-w-0">
                <span className="text-[10px] font-medium text-[var(--text-muted)]">Desde hoja</span>
                <input
                  type="number"
                  min={1}
                  max={maxPage}
                  value={range.fromPage}
                  onChange={(e) => {
                    const fromPage = Math.max(1, Math.min(maxPage, Number(e.target.value) || 1));
                    const toPage = Math.max(fromPage, range.toPage);
                    onChange(updateRange(ranges, range.id, { fromPage, toPage }));
                  }}
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] focus:border-[var(--accent-primary)] transition-shadow"
                />
              </label>
              <span className="text-[10px] text-[var(--text-muted)] pt-5">al</span>
              <label className="flex flex-col gap-1 flex-1 min-w-0">
                <span className="text-[10px] font-medium text-[var(--text-muted)]">Hasta hoja</span>
                <input
                  type="number"
                  min={range.fromPage}
                  max={maxPage}
                  value={range.toPage}
                  onChange={(e) => {
                    const toPage = Math.max(
                      range.fromPage,
                      Math.min(maxPage, Number(e.target.value) || range.fromPage),
                    );
                    onChange(updateRange(ranges, range.id, { toPage }));
                  }}
                  className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] focus:border-[var(--accent-primary)] transition-shadow"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-[var(--text-muted)]">Cuadrante afectado</span>
              <textarea
                rows={2}
                value={range.cuadrante}
                onChange={(e) => onChange(updateRange(ranges, range.id, { cuadrante: e.target.value }))}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] focus:border-[var(--accent-primary)] transition-shadow placeholder:text-[var(--text-muted)]/50"
                placeholder="AV EL SOL-AV.GUARDIA CIVIL, DISTRITO CHORRILLOS"
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
