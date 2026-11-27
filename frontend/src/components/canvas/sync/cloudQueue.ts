import type { CanvasDocument } from '../types';
import { recordPendingCanvasDelete, recordPendingCanvasPush } from './pendingCloudOperations';

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
