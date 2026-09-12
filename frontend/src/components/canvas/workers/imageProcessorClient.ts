import type { ImageProcessingResult, ImageProcessingTask } from './imageProcessorWorker';

type Pending = {
  resolve: (value: ImageProcessingResult[]) => void;
  reject: (reason?: unknown) => void;
};

let worker: Worker | null = null;
let pending: Pending | null = null;
let queue: Promise<void> = Promise.resolve();
let workerGeneration = 0;

function canUseWorker(): boolean {
  return typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined';
}

function getWorker(): Worker | null {
  if (!canUseWorker()) return null;
  if (worker) return worker;
  try {
    const createdWorker = new Worker(new URL('./imageProcessorWorker.ts', import.meta.url), { type: 'module' });
    const createdGeneration = workerGeneration;
    worker = createdWorker;
    createdWorker.onmessage = (event: MessageEvent<ImageProcessingResult[]>) => {
      if (worker !== createdWorker || workerGeneration !== createdGeneration) return;
      const wait = pending;
      pending = null;
      wait?.resolve(event.data);
    };
    createdWorker.onerror = (event) => {
      if (worker !== createdWorker || workerGeneration !== createdGeneration) return;
      const wait = pending;
      pending = null;
      worker = null;
      workerGeneration += 1;
      wait?.reject(event.error ?? new Error(event.message || 'image worker error'));
    };
    return createdWorker;
  } catch {
    worker = null;
    return null;
  }
}

const WORKER_TIMEOUT_MS = 60_000;

export function disposeImageProcessorWorker(): void {
  workerGeneration += 1;
  const wait = pending;
  pending = null;
  wait?.reject(new Error('image worker disposed'));
  try {
    worker?.terminate();
  } catch {
  }
  worker = null;
  queue = Promise.resolve();
}

function runOnWorker(tasks: ImageProcessingTask[]): Promise<ImageProcessingResult[]> {
  const scheduledGeneration = workerGeneration;

  const run = () => {
    if (scheduledGeneration !== workerGeneration) {
      return Promise.reject(new Error('image worker disposed'));
    }
    const w = getWorker();
    if (!w) return Promise.reject(new Error('image worker unavailable'));
    return new Promise<ImageProcessingResult[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (
          pending?.resolve === wrappedResolve &&
          worker === w &&
          workerGeneration === scheduledGeneration
        ) {
          pending = null;
          try {
            w.terminate();
          } catch {
          }
          worker = null;
          workerGeneration += 1;
          reject(new Error('image worker timed out'));
        }
      }, WORKER_TIMEOUT_MS);

      const wrappedResolve = (value: ImageProcessingResult[]) => {
        clearTimeout(timer);
        resolve(value);
      };

      const wrappedReject = (reason?: unknown) => {
        clearTimeout(timer);
        reject(reason);
      };

      pending = { resolve: wrappedResolve, reject: wrappedReject };
      w.postMessage(tasks);
    });
  };

  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

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
