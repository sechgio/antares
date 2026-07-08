import { ListTodo, Trash2 } from 'lucide-react';
import EmptyState from '../EmptyState';
import type { Tarea, TeamMember } from '../../types';
import { formatDisplayDate } from '../../utils/dates';
import { isOverdue } from '../../utils/filters';
import { memberLabel } from '../../utils/members';
import { STATUS_COLORS, STATUS_LABELS, STATUS_OPTIONS } from '../../utils/statusConfig';

interface ListViewProps {
  tareas: Tarea[];
  members: TeamMember[];
  onStatusChange: (id: string, status: Tarea['status']) => void;
  onDelete: (id: string) => void;
  onAddTask?: () => void;
}

export default function ListView({ tareas, members, onStatusChange, onDelete, onAddTask }: ListViewProps) {
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

  return (
    <div className="overflow-x-auto px-2">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            <th className="px-4 py-3 font-medium">Tarea</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3 font-medium">Asignado</th>
            <th className="px-4 py-3 font-medium">Vencimiento</th>
            <th className="w-10 px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody>
          {tareas.map((tarea) => {
            const overdue = isOverdue(tarea);
            return (
              <tr
                key={tarea.id}
                className={`border-b border-[var(--border-subtle)] transition-colors hover:bg-[var(--bg-elevated)]/50 ${
                  overdue ? 'bg-[var(--accent-red)]/[0.03]' : ''
                }`}
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-[var(--text-primary)]">{tarea.title}</div>
                  {tarea.description && (
                    <div className="mt-0.5 line-clamp-1 text-xs text-[var(--text-muted)]">{tarea.description}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={tarea.status}
                    onChange={(e) => onStatusChange(tarea.id, e.target.value as Tarea['status'])}
                    aria-label={`Cambiar estado de ${tarea.title}`}
                    className="rounded-full border px-2.5 py-1 text-[11px] font-medium outline-none transition-colors hover:opacity-90 focus:ring-1 focus:ring-[var(--accent-primary)]"
                    style={{
                      color: STATUS_COLORS[tarea.status],
                      background: `color-mix(in srgb, ${STATUS_COLORS[tarea.status]} 14%, transparent)`,
                      borderColor: `color-mix(in srgb, ${STATUS_COLORS[tarea.status]} 28%, transparent)`,
                    }}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">{memberLabel(members, tarea.assignee_id)}</td>
                <td className={`px-4 py-3 ${overdue ? 'font-medium text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}`}>
                  {formatDisplayDate(tarea.due_date)}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onDelete(tarea.id)}
                    className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--accent-red)]"
                    aria-label={`Eliminar ${tarea.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}