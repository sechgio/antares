/**
 * Thin wrappers that load canvasCloudSync on demand so the Canvas tab chunk
 * does not pull Supabase sync into the initial editor evaluate path.
 */
import type { CanvasDocument } from '../types';

export function queueCanvasCloudPush(doc: CanvasDocument): void {
  void import('./canvasCloudSync').then((m) => m.queueCanvasCloudPush(doc));
}

export function queueCanvasCloudDelete(id: string): void {
  void import('./canvasCloudSync').then((m) => m.queueCanvasCloudDelete(id));
}
