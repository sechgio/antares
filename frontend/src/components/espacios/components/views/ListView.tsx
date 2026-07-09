import { ListTodo, Pencil, Trash2 } from 'lucide-react';
import EmptyState from '../EmptyState';
import StatusPicker from '../StatusPicker';
import type { BoardColumn, Tarea, TeamMember } from '../../types';
import { formatDisplayDate } from '../../utils/dates';
import { isOverdue } from '../../utils/filters';
import { memberLabel } from '../../utils/members';

interface ListViewProps {
  tareas: Tarea[];
  members: TeamMember[];
  columns?: BoardColumn[];
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  onStatusChange: (id: string, status: Tarea['status']) => void;
  onEdit?: (tarea: Tarea) => void;
  onDelete: (id: string) => void;
  onAddTask?: () => void;
}

export default function ListView({
  tareas,
  members,
  columns = [],
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onStatusChange,
  onEdit,
  onDelete,
  onAddTask,
}: ListViewProps) {
  if (tareas.length === 0) {
    return (
      <EmptyState
        icon={ListTodo}
        title="Sin tareas"
        description="Crea tareas para organizar el trabajo de tu proyecto. Puedes asignarlas, fecharlas y cambiar su estado."
        actionLabel={onAddTask ? 'Nueva tarea' : undefined}
        onAction={onAddTask}
      />
    );
  }

  const selectable = Boolean(onToggleSelect);
  const allSelected = selectable && tareas.length > 0 && tareas.every((t) => selectedIds?.has(t.id));
  const someSelected = selectable && tareas.some((t) => selectedIds?.has(t.id));

  return (
    <div className="overflow-x-auto px-2">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            {selectable && (
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={() => onToggleSelectAll?.()}
                  aria-label="Seleccionar todas las tareas"
                  className="h-3.5 w-3.5 rounded border-[var(--border-subtle)] accent-[var(--accent-primary)]"
                />
              </th>
            )}
            <th className="px-4 py-3 font-medium">Tarea</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3 font-medium">Asignado</th>
            <th className="px-4 py-3 font-medium">Vencimiento</th>
            <th className="w-10 px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {tareas.map((tarea) => {
            const overdue = isOverdue(tarea, columns);
            const selected = selectedIds?.has(tarea.id) ?? false;
            return (
              <tr
                key={tarea.id}
                className={`border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-elevated)]/50 ${
                  overdue ? 'bg-[var(--accent-red)]/[0.03]' : ''
                } ${selected ? 'bg-[var(--accent-primary)]/[0.06]' : ''}`}
              >
                {selectable && (
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleSelect?.(tarea.id)}
                      aria-label={`Seleccionar ${tarea.title}`}
                      className="h-3.5 w-3.5 rounded border-[var(--border-subtle)] accent-[var(--accent-primary)]"
                    />
                  </td>
                )}
                <td className="px-4 py-3">
                  <button
                    type="button"
                    className="text-left"
                    onClick={() => onEdit?.(tarea)}
                    onDoubleClick={() => onEdit?.(tarea)}
                  >
                    <div className="font-medium text-[var(--text-primary)] hover:text-[var(--accent-primary)]">
                      {tarea.title}
                    </div>
                    {tarea.description && (
                      <div className="mt-0.5 line-clamp-1 text-xs text-[var(--text-muted)]">{tarea.description}</div>
                    )}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <StatusPicker
                    value={tarea.status}
                    columns={columns}
                    onChange={(status) => onStatusChange(tarea.id, status)}
                    label={`Cambiar estado de ${tarea.title}`}
                    size="sm"
                  />
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">{memberLabel(members, tarea.assignee_id)}</td>
                <td className={`px-4 py-3 ${overdue ? 'font-medium text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}`}>
                  {formatDisplayDate(tarea.due_date)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-0.5">
                    {onEdit && (
                      <button
                        type="button"
                        onClick={() => onEdit(tarea)}
                        className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                        aria-label={`Editar ${tarea.title}`}
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDelete(tarea.id)}
                      className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--accent-red)]"
                      aria-label={`Eliminar ${tarea.title}`}
                      title="Eliminar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
