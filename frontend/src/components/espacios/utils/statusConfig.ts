import type { TareaStatus } from '../types';

export const STATUS_LABELS: Record<TareaStatus, string> = {
  todo: 'Por hacer',
  in_progress: 'En progreso',
  done: 'Hecho',
  closed: 'Cerrada',
};

/** Solid accents for dots, borders and text. */
export const STATUS_COLORS: Record<TareaStatus, string> = {
  todo: '#94A3B8',
  in_progress: '#6366F1',
  done: '#22C55E',
  closed: '#64748B',
};

/** Soft surfaces behind status chips. */
export const STATUS_SOFT: Record<TareaStatus, string> = {
  todo: 'color-mix(in srgb, #94A3B8 16%, transparent)',
  in_progress: 'color-mix(in srgb, #6366F1 16%, transparent)',
  done: 'color-mix(in srgb, #22C55E 16%, transparent)',
  closed: 'color-mix(in srgb, #64748B 14%, transparent)',
};

/** @deprecated Prefer STATUS_COLORS — kept for existing board borders. */
export const STATUS_ACCENT: Record<TareaStatus, string> = STATUS_COLORS;

export const STATUS_OPTIONS: TareaStatus[] = ['todo', 'in_progress', 'done', 'closed'];
