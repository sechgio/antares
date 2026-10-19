import type { CanvasDocument } from '../types';

const PENDING_DELETES_KEY = 'antares:canvas:pending-deletes';
const PENDING_PUSHES_KEY = 'antares:canvas:pending-pushes';
const localDeletesInFlight = new Set<string>();

export type PendingCanvasPush = {
  id: string;
  options?: { forceResurrect?: boolean };
};

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

export function pendingCanvasPushes(): PendingCanvasPush[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_PUSHES_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item: unknown): PendingCanvasPush[] => {
      if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string') return [];
      if (!('options' in item) || item.options === undefined) return [{ id: item.id }];
      const options = item.options;
      if (!options || typeof options !== 'object') return [];
      if (!('forceResurrect' in options)) return [{ id: item.id }];
      if (typeof options.forceResurrect !== 'boolean') return [];
      return [{ id: item.id, options: { forceResurrect: options.forceResurrect } }];
    });
  } catch {
    return [];
  }
}

function persistPendingCanvasPushes(pending: PendingCanvasPush[]): void {
  try {
    if (pending.length) localStorage.setItem(PENDING_PUSHES_KEY, JSON.stringify(pending));
    else localStorage.removeItem(PENDING_PUSHES_KEY);
  } catch {
    // El documento sigue guardado localmente y el envío permanece en memoria.
  }
}

export function recordPendingCanvasPush(push: PendingCanvasPush): void {
  persistPendingCanvasPushes([...pendingCanvasPushes().filter((item) => item.id !== push.id), push]);
}

export function clearPendingCanvasPush(id: string): void {
  persistPendingCanvasPushes(pendingCanvasPushes().filter((item) => item.id !== id));
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
  recordPendingCanvasPush({ id: doc.id, options });
  return import('./canvasCloudSync').then((m) => m.queueCanvasCloudPush(doc, options));
}

export function queueCanvasCloudDelete(id: string): Promise<void> {
  recordPendingCanvasDelete(id);
  return import('./canvasCloudSync').then((m) => m.queueCanvasCloudDelete(id));
}
