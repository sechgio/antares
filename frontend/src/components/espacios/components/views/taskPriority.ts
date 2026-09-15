import type { BoardColumn, Tarea } from '../../types';
import { priorityDetails } from '../../utils/priority';

export function priorityMeta(tarea: Tarea, _columns: BoardColumn[] = []): { label: string; color: string } {
  const { label, color } = priorityDetails(tarea);
  return { label, color };
}

export function priorityRank(tarea: Tarea, _columns: BoardColumn[] = []): number {
  return priorityDetails(tarea).rank;
}
