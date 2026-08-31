/**
 * Client for canvas/workers/imageProcessorWorker — downscale large image
 * uploads off the main thread before registerImageBlob.
 */
import type { ImageProcessingResult, ImageProcessingTask } from './imageProcessorWorker';

type Pending = {
  resolve: (value: ImageProcessingResult[]) => void;
  reject: (reason?: unknown) => void;
};

let worker: Worker | null = null;
let pending: Pending | null = null;
let queue: Promise<void> = Promise.resolve();

function canUseWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined';
}

function getWorker(): Worker | null {
  if (!canUseWorker()) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./imageProcessorWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ImageProcessingResult[]>) => {
      const wait = pending;
      pending = null;
      wait?.resolve(event.data);
    };
    worker.onerror = (event) => {
      const wait = pending;
      pending = null;
      wait?.reject(event.error ?? new Error(event.message || 'image worker error'));
    };
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

function runOnWorker(tasks: ImageProcessingTask[]): Promise<ImageProcessingResult[]> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('image worker unavailable'));

  const run = () =>
    new Promise<ImageProcessingResult[]>((resolve, reject) => {
      pending = { resolve, reject };
      w.postMessage(tasks);
    });

  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** Downscale / compress a single image file in a worker; falls back to the original File. */
export async function processImageFileForCanvas(
  file: File,
  maxDimension = 2048,
  opts?: { quality?: number; outputType?: string },
): Promise<{ blob: Blob; width: number; height: number }> {
  if (!getWorker()) {
    return { blob: file, width: 0, height: 0 };
  }

  try {
    const task: ImageProcessingTask = {
      id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      file,
      maxDimension,
      quality: opts?.quality,
      outputType: opts?.outputType,
    };
    const results = await runOnWorker([task]);
    const first = results[0];
    if (!first || first.error) {
      return { blob: file, width: 0, height: 0 };
    }
    return {
      blob: first.blob,
      width: first.width ?? 0,
      height: first.height ?? 0,
    };
  } catch {
    return { blob: file, width: 0, height: 0 };
  }
}
