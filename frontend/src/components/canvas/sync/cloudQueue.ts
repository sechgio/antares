import type { CanvasDocument } from '../types';

const PENDING_DELETES_KEY = 'antares:canvas:pending-deletes';
const localDeletesInFlight = new Set<string>();

export function pendingCanvasDeletes(readyOnly = false): string[] {
  const ids: unknown = JSON.parse(localStorage.getItem(PENDING_DELETES_KEY) || '[]');
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    throw new Error('El registro de borrados pendientes de Canvas es inválido');
  }
  return readyOnly ? ids.filter((id) => !localDeletesInFlight.has(id)) : ids;
}

export function recordPendingCanvasDelete(id: string, localPending = false): void {
  localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify([...new Set([...pendingCanvasDeletes(), id])]));
  if (localPending) localDeletesInFlight.add(id);
  else localDeletesInFlight.delete(id);
}

export function clearPendingCanvasDelete(id: string): void {
  const remaining = pendingCanvasDeletes().filter((pending) => pending !== id);
  if (remaining.length) localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(remaining));
  else localStorage.removeItem(PENDING_DELETES_KEY);
  localDeletesInFlight.delete(id);
}

export function queueCanvasCloudPush(
  doc: CanvasDocument,
  options?: { forceResurrect?: boolean },
): Promise<void> {
  return import('./canvasCloudSync').then((m) => m.queueCanvasCloudPush(doc, options));
}

export function queueCanvasCloudDelete(id: string): Promise<void> {
  recordPendingCanvasDelete(id);
  return import('./canvasCloudSync').then((m) => m.queueCanvasCloudDelete(id));
}
