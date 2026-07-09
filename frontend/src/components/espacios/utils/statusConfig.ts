import type { BoardColumn, TareaStatus } from '../types';
import { pickDefaultColor } from './colors';

/** Built-in keys used by seed + legacy tasks. */
export const BUILTIN_STATUS = {
  todo: 'todo',
  in_progress: 'in_progress',
  done: 'done',
  urgent: 'urgent',
  closed: 'closed',
} as const;

export type BuiltinTareaStatus = (typeof BUILTIN_STATUS)[keyof typeof BUILTIN_STATUS];

export const STATUS_LABELS: Record<BuiltinTareaStatus, string> = {
  todo: 'Pendiente',
  in_progress: 'En curso',
  done: 'Completados',
  urgent: 'Urgente',
  closed: 'Cerrada',
};

/** Solid accents for dots, borders and text (ClickUp-like). */
export const STATUS_COLORS: Record<BuiltinTareaStatus, string> = {
  todo: '#87909E',
  in_progress: '#5F55EE',
  done: '#0F9D58',
  urgent: '#EF4444',
  closed: '#64748B',
};

/** Soft surfaces behind status chips / board columns. */
export const STATUS_SOFT: Record<BuiltinTareaStatus, string> = {
  todo: 'color-mix(in srgb, #87909E 14%, transparent)',
  in_progress: 'color-mix(in srgb, #5F55EE 12%, transparent)',
  done: 'color-mix(in srgb, #0F9D58 12%, transparent)',
  urgent: 'color-mix(in srgb, #EF4444 12%, transparent)',
  closed: 'color-mix(in srgb, #64748B 12%, transparent)',
};

/** Filled header pills (white text on solid). */
export const STATUS_PILL_FILLED: Record<BuiltinTareaStatus, boolean> = {
  todo: false,
  in_progress: true,
  done: true,
  urgent: false,
  closed: false,
};

/** @deprecated Prefer STATUS_COLORS — kept for existing board borders. */
export const STATUS_ACCENT: Record<BuiltinTareaStatus, string> = STATUS_COLORS;

/**
 * Estados principales del flujo (selector, filtros y tablero).
 * Orden: Pendiente → En curso → Completados → Urgente
 */
export const STATUS_OPTIONS: BuiltinTareaStatus[] = ['todo', 'in_progress', 'done', 'urgent'];

/** Columnas del tablero por defecto (siempre visibles). */
export const BOARD_STATUS_OPTIONS: BuiltinTareaStatus[] = STATUS_OPTIONS;

/** Todos los valores built-in válidos (incluye legacy closed). */
export const ALL_STATUS_VALUES: BuiltinTareaStatus[] = [
  'todo',
  'in_progress',
  'done',
  'urgent',
  'closed',
];

export const DEFAULT_BOARD_COLUMN_DEFS: Omit<
  BoardColumn,
  'id' | 'proyecto_id' | 'created_at' | 'updated_at'
>[] = [
  { key: 'todo', name: 'Pendiente', color: '#87909E', sort_order: 0, is_done: false, is_system: true },
  { key: 'in_progress', name: 'En curso', color: '#5F55EE', sort_order: 1, is_done: false, is_system: true },
  { key: 'done', name: 'Completados', color: '#0F9D58', sort_order: 2, is_done: true, is_system: true },
  { key: 'urgent', name: 'Urgente', color: '#EF4444', sort_order: 3, is_done: false, is_system: true },
  { key: 'closed', name: 'Cerrada', color: '#64748B', sort_order: 4, is_done: true, is_system: true },
];

export function isBuiltinStatus(value: string): value is BuiltinTareaStatus {
  return (ALL_STATUS_VALUES as string[]).includes(value);
}

/** @deprecated Use isBuiltinStatus — kept for call sites that validate free-form keys. */
export function isTareaStatus(value: string): value is TareaStatus {
  return value.length > 0;
}

export function columnDropId(status: TareaStatus): string {
  return `column:${status}`;
}

export function parseColumnDropId(id: string): TareaStatus | null {
  if (!id.startsWith('column:')) return null;
  const status = id.slice('column:'.length);
  return status.length > 0 ? status : null;
}

export function softColor(hex: string, amount = 14): string {
  return `color-mix(in srgb, ${hex} ${amount}%, transparent)`;
}

export function columnLabel(columns: BoardColumn[], key: TareaStatus): string {
  const col = columns.find((c) => c.key === key);
  if (col) return col.name;
  if (isBuiltinStatus(key)) return STATUS_LABELS[key];
  return key;
}

export function columnColor(columns: BoardColumn[], key: TareaStatus): string {
  const col = columns.find((c) => c.key === key);
  if (col) return col.color;
  if (isBuiltinStatus(key)) return STATUS_COLORS[key];
  return '#87909E';
}

export function columnSoft(columns: BoardColumn[], key: TareaStatus): string {
  return softColor(columnColor(columns, key));
}

export function columnIsDone(columns: BoardColumn[], key: TareaStatus): boolean {
  const col = columns.find((c) => c.key === key);
  if (col) return col.is_done;
  return key === 'done' || key === 'closed';
}

export function columnPillFilled(columns: BoardColumn[], key: TareaStatus): boolean {
  if (isBuiltinStatus(key)) return STATUS_PILL_FILLED[key];
  return columnIsDone(columns, key);
}

/** Visible board columns: all except closed unless showClosed. */
export function visibleBoardColumns(columns: BoardColumn[], showClosed: boolean): BoardColumn[] {
  const sorted = [...columns].sort((a, b) => a.sort_order - b.sort_order);
  if (showClosed) return sorted;
  return sorted.filter((c) => c.key !== 'closed');
}

/** Status options for pickers/filters (hide closed). */
export function pickerColumns(columns: BoardColumn[]): BoardColumn[] {
  return [...columns]
    .filter((c) => c.key !== 'closed')
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** Fallback columns when API has not loaded yet. */
export function fallbackBoardColumns(proyectoId: string): BoardColumn[] {
  const now = new Date().toISOString();
  return DEFAULT_BOARD_COLUMN_DEFS.map((def, i) => ({
    id: `local-${def.key}`,
    proyecto_id: proyectoId,
    ...def,
    created_at: now,
    updated_at: now,
    sort_order: def.sort_order ?? i,
  }));
}

export function slugifyColumnKey(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base || 'columna';
}

export function uniqueColumnKey(name: string, existingKeys: Set<string>): string {
  const base = slugifyColumnKey(name);
  if (!existingKeys.has(base)) return base;
  let n = 2;
  while (existingKeys.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export function nextColumnColor(columns: BoardColumn[]): string {
  return pickDefaultColor(columns.length + 3);
}

export function nextColumnSortOrder(columns: BoardColumn[]): number {
  if (columns.length === 0) return 0;
  return Math.max(...columns.map((c) => c.sort_order)) + 1;
}
