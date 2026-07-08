import type { Tarea, TareaFilters } from '../types';
import { localTodayString } from './dates';

export function filterTareas(tareas: Tarea[], filters: TareaFilters): Tarea[] {
  return tareas.filter((t) => {
    if (!filters.showClosed && t.status === 'closed') return false;
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

export function isOverdue(tarea: Tarea): boolean {
  if (!tarea.due_date || tarea.status === 'closed' || tarea.status === 'done') return false;
  return tarea.due_date < localTodayString();
}

export function countUnscheduled(tareas: Tarea[]): number {
  return tareas.filter((t) => t.status !== 'closed' && !t.due_date).length;
}

export function countOverdue(tareas: Tarea[]): number {
  return tareas.filter(isOverdue).length;
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

export function computeTaskStats(tareas: Tarea[]): TaskStats {
  const open = tareas.filter((t) => t.status !== 'closed' && t.status !== 'done');
  const completed = tareas.filter((t) => t.status === 'done' || t.status === 'closed');
  const total = tareas.length;
  const progress = total === 0 ? 0 : Math.round((completed.length / total) * 100);

  return {
    total,
    open: open.length,
    completed: completed.length,
    overdue: countOverdue(tareas),
    unscheduled: countUnscheduled(tareas),
    progress,
  };
}