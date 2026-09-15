import type { Tarea, TareaPriority } from '../types';

export const PRIORITY_OPTIONS: { value: TareaPriority; label: string }[] = [
  { value: 'low', label: 'Baja' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
];

const PRIORITY_META: Record<TareaPriority, { label: string; color: string; rank: number }> = {
  low: { label: 'Baja', color: 'var(--text-muted)', rank: 0 },
  normal: { label: 'Normal', color: 'var(--text-secondary)', rank: 1 },
  high: { label: 'Alta', color: 'var(--accent-yellow)', rank: 2 },
  urgent: { label: 'Urgente', color: 'var(--accent-red)', rank: 3 },
};

export function isTareaPriority(value: unknown): value is TareaPriority {
  return value === 'low' || value === 'normal' || value === 'high' || value === 'urgent';
}

export function tareaPriority(tarea: Pick<Tarea, 'status' | 'priority'>): TareaPriority {
  if (isTareaPriority(tarea.priority)) return tarea.priority;
  // Read compatibility only: a persisted priority always wins over legacy status.
  // Never derive priority from due dates, completion, or customized board columns.
  return tarea.status === 'urgent' ? 'urgent' : 'normal';
}

export function priorityDetails(tarea: Pick<Tarea, 'status' | 'priority'>) {
  return PRIORITY_META[tareaPriority(tarea)];
}
