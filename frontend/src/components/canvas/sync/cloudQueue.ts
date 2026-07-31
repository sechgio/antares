/**
 * Thin wrappers that load canvasCloudSync on demand so the Canvas tab chunk
 * does not pull Supabase sync into the initial editor evaluate path.
 */
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
