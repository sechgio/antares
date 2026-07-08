import type { TareaStatus } from '../types';

export const STATUS_LABELS: Record<TareaStatus, string> = {
  todo: 'Por hacer',
  in_progress: 'En progreso',
  done: 'Hecho',
  closed: 'Cerrada',
};

export const STATUS_COLORS: Record<TareaStatus, string> = {
  todo: 'var(--text-muted)',
  in_progress: 'var(--accent-primary)',
  done: 'var(--accent-green, #22c55e)',
  closed: 'var(--text-secondary)',
};

export const STATUS_ACCENT: Record<TareaStatus, string> = {
  todo: 'var(--text-muted)',
  in_progress: 'var(--accent-primary)',
  done: 'var(--accent-green, #22c55e)',
  closed: 'var(--text-secondary)',
};

export const STATUS_OPTIONS: TareaStatus[] = ['todo', 'in_progress', 'done', 'closed'];