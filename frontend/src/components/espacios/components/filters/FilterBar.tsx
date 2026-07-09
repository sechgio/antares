import { Plus, Search, X } from 'lucide-react';
import { useMemo } from 'react';
import type { BoardColumn, TeamMember, TareaFilters } from '../../types';
import { countActiveFilters } from '../../utils/filters';
import { pickerColumns } from '../../utils/statusConfig';
import SelectPicker from './SelectPicker';

/** Shared compact control: same height, radius and type scale across the bar. */
const CTRL =
  'h-8 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-xs text-[var(--text-secondary)] outline-none transition-colors placeholder:text-[var(--text-muted)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)] focus:border-[var(--border-medium)] focus:text-[var(--text-primary)]';

interface FilterBarProps {
  filters: TareaFilters;
  members: TeamMember[];
  columns?: BoardColumn[];
  resultCount: number;
  onChange: (patch: Partial<TareaFilters>) => void;
  onClear: () => void;
  onAddTask: () => void;
}

export default function FilterBar({
  filters,
  members,
  columns = [],
  resultCount,
  onChange,
  onClear,
  onAddTask,
}: FilterBarProps) {
  const activeCount = countActiveFilters(filters);
  const statusOptions = useMemo(() => {
    const cols = pickerColumns(columns);
    return [
      { value: 'all', label: 'Todos los estados' },
      ...cols.map((col) => ({ value: col.key, label: col.name, color: col.color })),
    ];
  }, [columns]);

  const assigneeOptions = useMemo(
    () => [
      { value: 'all', label: 'Cualquier persona' },
      ...members.map((m) => ({ value: m.user_id, label: m.display_name })),
    ],
    [members],
  );

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
      <div className="relative min-w-[160px] max-w-[220px] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
        <input
          type="search"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Buscar tareas..."
          className={`${CTRL} w-full pl-8 pr-3`}
          aria-label="Buscar tareas"
        />
      </div>

      <SelectPicker
        value={filters.status}
        options={statusOptions}
        onChange={(status) => onChange({ status: status as TareaFilters['status'] })}
        aria-label="Filtrar por estado"
      />

      <SelectPicker
        value={filters.assigneeId}
        options={assigneeOptions}
        onChange={(assigneeId) => onChange({ assigneeId })}
        aria-label="Filtrar por asignado"
      />

      <label className={`${CTRL} inline-flex cursor-pointer items-center gap-1.5 px-3`}>
        <input
          type="checkbox"
          checked={filters.showClosed}
          onChange={(e) => onChange({ showClosed: e.target.checked })}
          className="h-3 w-3 rounded border-[var(--border-subtle)] accent-[var(--accent-primary)]"
        />
        <span className="whitespace-nowrap">Incluir completadas</span>
      </label>

      {activeCount > 0 && (
        <button
          type="button"
          onClick={onClear}
          className={`${CTRL} inline-flex items-center gap-1 px-2.5 hover:bg-[var(--bg-base)]`}
        >
          <X className="h-3 w-3" />
          Limpiar
          <span className="text-[var(--text-muted)]">({activeCount})</span>
        </button>
      )}

      <span className="px-1 text-[11px] tabular-nums text-[var(--text-muted)]">
        {resultCount} {resultCount === 1 ? 'tarea' : 'tareas'}
      </span>

      <div className="ml-auto">
        <button
          type="button"
          onClick={onAddTask}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-[var(--text-primary)] bg-[var(--text-primary)] px-3 text-xs font-medium text-[var(--bg-elevated)] transition-opacity hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
          Nueva tarea
        </button>
      </div>
    </div>
  );
}
