import { CheckSquare, Trash2, X } from 'lucide-react';
import ThemedSelect from '../../ui/ThemedSelect';
import type { BoardColumn, TareaStatus } from '../types';
import { pickerColumns } from '../utils/statusConfig';
import Button from '@/components/ui/Button';

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

      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
        <span className="sr-only">Cambiar estado</span>
        <ThemedSelect
          value=""
          onChange={(value) => {
            if (value) onBulkStatus(value as TareaStatus);
          }}
          options={statuses.map((col) => ({ value: col.key, label: col.name }))}
          placeholder="Mover a estado…"
          aria-label="Cambiar estado de seleccionadas"
          className="w-auto min-w-32"
        />
      </span>

      <Button variant="none" size="none"
        onClick={onBulkDelete}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color:color-mix(in_srgb,var(--accent-red)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-red)_8%,transparent)] px-3 text-xs font-medium text-[var(--accent-red)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--accent-red)_15%,transparent)]"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Eliminar
      </Button>

      <Button variant="none" size="none"
        onClick={onClear}
        className="ml-auto inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-base)] hover:text-[var(--text-secondary)]"
        aria-label="Limpiar selección"
      >
        <X className="h-3.5 w-3.5" />
        Quitar selección
      </Button>
    </div>
  );
}
