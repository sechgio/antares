import { Plus, Search, X } from 'lucide-react';
import Button from '../../../ui/Button';
import Input from '../../../ui/Input';
import type { TeamMember, TareaFilters } from '../../types';
import { countActiveFilters } from '../../utils/filters';
import { STATUS_LABELS, STATUS_OPTIONS } from '../../utils/statusConfig';

const SELECT_CLASS =
  'rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border-medium)] focus:border-[var(--accent-primary)]';

interface FilterBarProps {
  filters: TareaFilters;
  members: TeamMember[];
  resultCount: number;
  onChange: (patch: Partial<TareaFilters>) => void;
  onClear: () => void;
  onAddTask: () => void;
}

export default function FilterBar({ filters, members, resultCount, onChange, onClear, onAddTask }: FilterBarProps) {
  const activeCount = countActiveFilters(filters);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-6 py-3">
      <div className="relative max-w-xs flex-1 min-w-[180px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
        <Input
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Buscar tareas..."
          className="pl-9"
        />
      </div>

      <select
        value={filters.status}
        onChange={(e) => onChange({ status: e.target.value as TareaFilters['status'] })}
        className={SELECT_CLASS}
        aria-label="Filtrar por estado"
      >
        <option value="all">Todos los estados</option>
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>{STATUS_LABELS[s]}</option>
        ))}
      </select>

      <select
        value={filters.assigneeId}
        onChange={(e) => onChange({ assigneeId: e.target.value })}
        className={SELECT_CLASS}
        aria-label="Filtrar por asignado"
      >
        <option value="all">Cualquier persona</option>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
        ))}
      </select>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={filters.showClosed}
          onChange={(e) => onChange({ showClosed: e.target.checked })}
          className="rounded border-[var(--border-subtle)] accent-[var(--accent-primary)]"
        />
        Incluir cerradas
      </label>

      {activeCount > 0 && (
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
        >
          <X className="h-3 w-3" />
          Limpiar ({activeCount})
        </button>
      )}

      <span className="text-xs text-[var(--text-muted)]">
        {resultCount} {resultCount === 1 ? 'tarea' : 'tareas'}
      </span>

      <div className="ml-auto">
        <Button type="button" size="sm" onClick={onAddTask}>
          <Plus className="h-4 w-4" />
          Nueva tarea
        </Button>
      </div>
    </div>
  );
}