import type { Tarea, TareaStatus } from '../types';
import { parseColumnDropId } from './statusConfig';

export type BoardItems = Record<string, string[]>;

export function buildBoardItems(tareas: Tarea[], columnKeys: string[]): BoardItems {
  const map = Object.fromEntries(columnKeys.map((s) => [s, [] as string[]])) as BoardItems;
  const sorted = [...tareas].sort((a, b) => a.sort_order - b.sort_order);
  for (const t of sorted) {
    if (map[t.status]) map[t.status].push(t.id);
  }
  return map;
}

export function findContainer(items: BoardItems, id: string): TareaStatus | null {
  const fromColumn = parseColumnDropId(id);
  if (fromColumn && fromColumn in items) return fromColumn;
  if (id in items) return id;

  for (const status of Object.keys(items)) {
    if (items[status].includes(id)) return status;
  }
  return null;
}

export function computeInsertSortOrder(
  items: BoardItems,
  tareasById: Map<string, Tarea>,
  targetStatus: TareaStatus,
  tareaId: string,
  overId: string | null,
): number {
  const columnTasks = (items[targetStatus] ?? []).filter((id) => id !== tareaId);
  const overIndex =
    overId && !overId.startsWith('column:') && !(overId in items)
      ? (items[targetStatus] ?? []).indexOf(overId)
      : -1;

  if (overIndex >= 0) {
    const without = (items[targetStatus] ?? []).filter((id) => id !== tareaId);
    const insertAt = without.indexOf(overId!);
    const prevId = insertAt > 0 ? without[insertAt - 1] : null;
    const nextId = insertAt >= 0 ? without[insertAt] : null;
    const prev = prevId ? tareasById.get(prevId) : null;
    const next = nextId ? tareasById.get(nextId) : null;
    if (prev && next) return (prev.sort_order + next.sort_order) / 2;
    if (next) return next.sort_order - 1;
    if (prev) return prev.sort_order + 1;
  }

  if (columnTasks.length > 0) {
    const last = tareasById.get(columnTasks[columnTasks.length - 1]);
    return (last?.sort_order ?? Date.now()) + 1;
  }

  return Date.now();
}
