import { daysBetweenIsoDates, localTodayString } from './dates';

export const DUE_SOON_DAYS = 3;

export type DueUrgency = 'overdue' | 'today' | 'soon';

export interface DueTaskInput {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  proyecto_id: string;
  proyecto_name?: string;
  espacio_id?: string | null;
  espacio_name?: string | null;
}

export interface DueNotification {
  id: string;
  title: string;
  due_date: string;
  status: string;
  proyecto_id: string;
  proyecto_name: string;
  espacio_id: string | null;
  espacio_name: string | null;
  daysUntil: number;
  urgency: DueUrgency;
}

const DONE_LIKE = new Set(['done', 'closed']);

export function isDoneLikeStatus(
  status: string,
  options?: { doneKeys?: Set<string> },
): boolean {
  if (options?.doneKeys) return options.doneKeys.has(status);
  return DONE_LIKE.has(status);
}

export function urgencyFromDays(daysUntil: number): DueUrgency {
  if (daysUntil < 0) return 'overdue';
  if (daysUntil === 0) return 'today';
  return 'soon';
}

export function collectDueNotifications(
  tasks: DueTaskInput[],
  options: { today?: string; soonDays?: number; doneKeys?: Set<string> } = {},
): DueNotification[] {
  const today = options.today ?? localTodayString();
  const soonDays = options.soonDays ?? DUE_SOON_DAYS;
  const doneOpts = options.doneKeys ? { doneKeys: options.doneKeys } : undefined;

  const items: DueNotification[] = [];

  for (const task of tasks) {
    if (!task.due_date || isDoneLikeStatus(task.status, doneOpts)) continue;
    const daysUntil = daysBetweenIsoDates(today, task.due_date);
    if (daysUntil == null) continue;
    if (daysUntil > soonDays) continue;

    items.push({
      id: task.id,
      title: task.title,
      due_date: task.due_date,
      status: task.status,
      proyecto_id: task.proyecto_id,
      proyecto_name: task.proyecto_name?.trim() || 'Proyecto',
      espacio_id: task.espacio_id ?? null,
      espacio_name: task.espacio_name ?? null,
      daysUntil,
      urgency: urgencyFromDays(daysUntil),
    });
  }

  items.sort((a, b) => {
    if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
    return a.title.localeCompare(b.title, 'es');
  });

  return items;
}

export interface DueRealtimePayload {
  eventType: string;
  table: string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

// Due-notification state only depends on tareas with a due date (or tasks the
// bell is already showing). Other table writes cannot change the list, so the
// global subscription can skip the refetch for them. Unknown shapes fail open.
export function shouldRefreshForDueChange(
  payload: DueRealtimePayload | null | undefined,
  notifiedTaskIds: ReadonlySet<string>,
): boolean {
  if (!payload || payload.eventType === 'DELETE') return true;
  if (payload.table !== 'tareas') return true;
  const row = payload.new;
  if (!row || typeof row !== 'object') return true;
  if (row.due_date != null && row.due_date !== '') return true;
  return typeof row.id === 'string' && notifiedTaskIds.has(row.id);
}
