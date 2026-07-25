/**
 * Small pool of image-process workers (OffscreenCanvas).
 * Falls back to null when Worker / OffscreenCanvas are unavailable (jsdom/tests).
 */

import type { BatchSettings, CropOffset } from './types';
import type { ProcessWorkerRequest, ProcessWorkerResponse } from './imageProcess.worker';

type Pending = {
  resolve: (value: ProcessWorkerResponse) => void;
  reject: (reason?: unknown) => void;
};

type PooledWorker = {
  worker: Worker;
  busy: boolean;
};

let pool: PooledWorker[] | null = null;
const waitQueue: Array<() => void> = [];
const pendingById = new Map<string, Pending>();

function poolSize(): number {
  try {
    const cores =
      typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
        ? navigator.hardwareConcurrency
        : 2;
    return Math.min(2, Math.max(1, Math.floor(cores / 2) || 1));
  } catch {
    return 1;
  }
}

export function canUseProcessWorker(): boolean {
  return (
    typeof Worker !== 'undefined'
    && typeof OffscreenCanvas !== 'undefined'
    && typeof createImageBitmap === 'function'
  );
}

function ensurePool(): PooledWorker[] {
  if (pool) return pool;
  const size = poolSize();
  pool = [];
  for (let i = 0; i < size; i += 1) {
    const worker = new Worker(new URL('./imageProcess.worker.ts', import.meta.url), {
      type: 'module',
    });
    const entry: PooledWorker = { worker, busy: false };
    worker.onmessage = (event: MessageEvent<ProcessWorkerResponse>) => {
      entry.busy = false;
      const response = event.data;
      const pending = pendingById.get(response.requestId);
      if (pending) {
        pendingById.delete(response.requestId);
        pending.resolve(response);
      }
      const next = waitQueue.shift();
      if (next) next();
    };
    worker.onerror = (err) => {
      entry.busy = false;
      // Reject all in-flight for this worker is hard without tracking; surface next job failure.
      console.warn('[image-optimizer] worker error', err);
      const next = waitQueue.shift();
      if (next) next();
    };
    pool.push(entry);
  }
  return pool;
}

function acquireWorker(): Promise<PooledWorker> {
  const workers = ensurePool();
  const idle = workers.find((w) => !w.busy);
  if (idle) {
    idle.busy = true;
    return Promise.resolve(idle);
  }
  return new Promise((resolve) => {
    waitQueue.push(() => {
      void acquireWorker().then(resolve);
    });
  });
}

let requestSeq = 0;

export type WorkerProcessInput = {
  buffer: ArrayBuffer;
  sourceType: string;
  fileName: string;
  settings: BatchSettings;
  cropOffset?: CropOffset;
  shouldCrop: boolean;
  shouldResize: boolean;
  shouldConvertFormat: boolean;
  shouldCompress: boolean;
};

export async function runProcessInWorker(input: WorkerProcessInput): Promise<{
  buffer: ArrayBuffer;
  mimeType: string;
  width: number;
  height: number;
}> {
  if (!canUseProcessWorker()) {
    throw new Error('Process worker not available');
  }

  const requestId = `img-${Date.now()}-${requestSeq += 1}`;
  const entry = await acquireWorker();

  const request: ProcessWorkerRequest = {
    requestId,
    buffer: input.buffer,
    sourceType: input.sourceType,
    fileName: input.fileName,
    settings: input.settings,
    cropOffset: input.cropOffset,
    shouldCrop: input.shouldCrop,
    shouldResize: input.shouldResize,
    shouldConvertFormat: input.shouldConvertFormat,
    shouldCompress: input.shouldCompress,
  };

  const response = await new Promise<ProcessWorkerResponse>((resolve, reject) => {
    pendingById.set(requestId, { resolve, reject });
    try {
      entry.worker.postMessage(request, [input.buffer]);
    } catch (err) {
      pendingById.delete(requestId);
      entry.busy = false;
      reject(err);
    }
  });

  if (!response.ok) {
    throw new Error(response.error || 'Worker process failed');
  }
  return {
    buffer: response.buffer,
    mimeType: response.mimeType,
    width: response.width,
    height: response.height,
  };
}

/** Test / HMR helper — tear down workers. */
export function _resetProcessWorkersForTests(): void {
  if (pool) {
    for (const entry of pool) {
      entry.worker.terminate();
    }
  }
  pool = null;
  waitQueue.length = 0;
  pendingById.clear();
  requestSeq = 0;
}
