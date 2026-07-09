import type { BoardColumn, Tarea, TareaFilters } from '../types';
import { localTodayString } from './dates';
import { columnIsDone } from './statusConfig';

export function filterTareas(
  tareas: Tarea[],
  filters: TareaFilters,
  columns: BoardColumn[] = [],
): Tarea[] {
  return tareas.filter((t) => {
    // Hide done/closed columns unless the user opts in (works with custom is_done keys).
    if (!filters.showClosed && columnIsDone(columns, t.status)) return false;
    if (filters.status !== 'all' && t.status !== filters.status) return false;
    if (filters.assigneeId !== 'all' && t.assignee_id !== filters.assigneeId) return false;
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      const inTitle = t.title.toLowerCase().includes(q);
      const inDesc = (t.description ?? '').toLowerCase().includes(q);
      if (!inTitle && !inDesc) return false;
    }
    return true;
  });
}

export function isOverdue(tarea: Tarea, columns: BoardColumn[] = []): boolean {
  if (!tarea.due_date || columnIsDone(columns, tarea.status)) return false;
  return tarea.due_date < localTodayString();
}

export function countUnscheduled(tareas: Tarea[], columns: BoardColumn[] = []): number {
  return tareas.filter((t) => !columnIsDone(columns, t.status) && !t.due_date).length;
}

export function countOverdue(tareas: Tarea[], columns: BoardColumn[] = []): number {
  return tareas.filter((t) => isOverdue(t, columns)).length;
}

export function countActiveFilters(filters: TareaFilters): number {
  let count = 0;
  if (filters.search.trim()) count += 1;
  if (filters.status !== 'all') count += 1;
  if (filters.assigneeId !== 'all') count += 1;
  if (filters.showClosed) count += 1;
  return count;
}

export interface TaskStats {
  total: number;
  open: number;
  completed: number;
  overdue: number;
  unscheduled: number;
  progress: number;
}

export function computeTaskStats(tareas: Tarea[], columns: BoardColumn[] = []): TaskStats {
  const completed = tareas.filter((t) => columnIsDone(columns, t.status));
  const open = tareas.filter((t) => !columnIsDone(columns, t.status));
  const total = tareas.length;
  const progress = total === 0 ? 0 : Math.round((completed.length / total) * 100);

  return {
    total,
    open: open.length,
    completed: completed.length,
    overdue: countOverdue(tareas, columns),
    unscheduled: countUnscheduled(tareas, columns),
    progress,
  };
}
