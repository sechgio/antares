import type { BoardColumn, Tarea } from '../../types';
import { isOverdue } from '../../utils/filters';

export function priorityMeta(tarea: Tarea, columns: BoardColumn[] = []): { label: string; color: string } | null {
  if (tarea.status === 'urgent') return { label: 'Urgente', color: 'var(--accent-red)' };
  if (isOverdue(tarea, columns)) return { label: 'Alta', color: 'var(--accent-yellow)' };
  if (tarea.status === 'in_progress' || tarea.status === 'todo') {
    return { label: 'Normal', color: '#87909E' };
  }
  return null;
}

export function priorityRank(tarea: Tarea, columns: BoardColumn[] = []): number {
  if (tarea.status === 'urgent') return 3;
  if (isOverdue(tarea, columns)) return 2;
  if (tarea.status === 'in_progress' || tarea.status === 'todo') return 1;
  return 0;
}
