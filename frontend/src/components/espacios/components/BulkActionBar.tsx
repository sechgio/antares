import { CheckSquare, Trash2, X } from 'lucide-react';
import type { BoardColumn, TareaStatus } from '../types';
import { pickerColumns } from '../utils/statusConfig';

interface BulkActionBarProps {
  count: number;
  columns: BoardColumn[];
  onClear: () => void;
  onBulkStatus: (status: TareaStatus) => void;
  onBulkDelete: () => void;
}

export default function BulkActionBar({
  count,
  columns,
  onClear,
  onBulkStatus,
  onBulkDelete,
}: BulkActionBarProps) {
  if (count <= 0) return null;

  const statuses = pickerColumns(columns);

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2"
      role="toolbar"
      aria-label="Acciones en lote"
    >
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
        <CheckSquare className="h-3.5 w-3.5 text-[var(--accent-primary)]" />
        {count} {count === 1 ? 'seleccionada' : 'seleccionadas'}
      </span>

      <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
        <span className="sr-only">Cambiar estado</span>
        <select
          className="h-8 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 text-xs text-[var(--text-secondary)] outline-none hover:border-[var(--border-medium)] focus:border-[var(--accent-primary)]"
          defaultValue=""
          onChange={(e) => {
            const value = e.target.value;
            if (!value) return;
            onBulkStatus(value);
            e.target.value = '';
          }}
          aria-label="Cambiar estado de seleccionadas"
        >
          <option value="" disabled>
            Mover a estado…
          </option>
          {statuses.map((col) => (
            <option key={col.key} value={col.key}>
              {col.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={onBulkDelete}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/8 px-3 text-xs font-medium text-[var(--accent-red)] transition-colors hover:bg-[var(--accent-red)]/15"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Eliminar
      </button>

      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-base)] hover:text-[var(--text-secondary)]"
        aria-label="Limpiar selección"
      >
        <X className="h-3.5 w-3.5" />
        Quitar selección
      </button>
    </div>
  );
}
