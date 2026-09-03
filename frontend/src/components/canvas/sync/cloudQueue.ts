import type { CanvasDocument } from '../types';

export function queueCanvasCloudPush(
  doc: CanvasDocument,
  options?: { forceResurrect?: boolean },
): Promise<void> {
  return import('./canvasCloudSync').then((m) => m.queueCanvasCloudPush(doc, options));
}

export function queueCanvasCloudDelete(id: string): Promise<void> {
  return import('./canvasCloudSync').then((m) => m.queueCanvasCloudDelete(id));
}
