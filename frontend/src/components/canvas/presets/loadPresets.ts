/**
 * Lazy loader for CANVAS_PRESETS so the heavy preset factories stay out of the
 * initial CanvasView chunk until templates are shown or a preset is applied.
 */
import type { CanvasDocument } from '../types';

export type CanvasPreset = {
  id: string;
  label: string;
  create: (name?: string) => CanvasDocument;
};

let cache: ReadonlyArray<CanvasPreset> | null = null;
let inflight: Promise<ReadonlyArray<CanvasPreset>> | null = null;

export async function loadCanvasPresets(): Promise<ReadonlyArray<CanvasPreset>> {
  if (cache) return cache;
  if (!inflight) {
    inflight = import('../presets').then((m) => {
      cache = m.CANVAS_PRESETS;
      return cache;
    });
  }
  return inflight;
}

export function prefetchCanvasPresets(): void {
  void loadCanvasPresets();
}
