/**
 * Small pool of image-process workers (OffscreenCanvas).
 * Falls back to null when Worker / OffscreenCanvas are unavailable (jsdom/tests).
 */

import type { BatchSettings, CropOffset } from './types';
import type { ProcessWorkerRequest, ProcessWorkerResponse } from './imageProcess.worker';

type Pending = {
  resolve: (value: ProcessWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
};

type PooledWorker = {
  worker: Worker;
  busy: boolean;
  requestId: string | null;
  retired: boolean;
};

let pool: PooledWorker[] | null = null;
const waitQueue: Array<() => void> = [];
const pendingById = new Map<string, Pending>();
export const PROCESS_WORKER_TIMEOUT_MS = 30_000;

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

function wakeNextWorker(): void {
  const next = waitQueue.shift();
  if (next) next();
}

function normalizeWorkerFailure(error: unknown): Error {
  return error instanceof Error ? error : new Error('Image process worker failed');
}

function retireWorker(entry: PooledWorker, error: unknown): void {
  if (entry.retired) return;
  entry.retired = true;
  entry.busy = false;

  const requestId = entry.requestId;
  entry.requestId = null;
  if (requestId) {
    const pending = pendingById.get(requestId);
    if (pending) {
      pendingById.delete(requestId);
      if (pending.timeoutId !== null) clearTimeout(pending.timeoutId);
      pending.reject(normalizeWorkerFailure(error));
    }
  }

  console.warn('[image-optimizer] worker error', error);
  entry.worker.terminate();

  if (pool) {
    const index = pool.indexOf(entry);
    if (index >= 0) pool[index] = createPooledWorker();
  }
  wakeNextWorker();
}

function createPooledWorker(): PooledWorker {
  const entry: PooledWorker = {
    worker: new Worker(new URL('./imageProcess.worker.ts', import.meta.url), {
      type: 'module',
    }),
    busy: false,
    requestId: null,
    retired: false,
  };

  entry.worker.onmessage = (event: MessageEvent<ProcessWorkerResponse>) => {
    if (entry.retired) return;
    const response = event.data;
    const pending = pendingById.get(response.requestId);
    if (!pending || entry.requestId !== response.requestId) return;

    pendingById.delete(response.requestId);
    if (pending.timeoutId !== null) clearTimeout(pending.timeoutId);
    entry.requestId = null;
    entry.busy = false;
    pending.resolve(response);
    wakeNextWorker();
  };
  entry.worker.onerror = (error) => retireWorker(entry, error);
  entry.worker.onmessageerror = () => {
    retireWorker(entry, new Error('Image process worker message failed'));
  };

  return entry;
}

function ensurePool(): PooledWorker[] {
  if (pool) return pool;
  const size = poolSize();
  pool = [];
  for (let i = 0; i < size; i += 1) {
    pool.push(createPooledWorker());
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
    const timeoutId = setTimeout(() => {
      retireWorker(entry, new Error('Image process worker timed out'));
    }, PROCESS_WORKER_TIMEOUT_MS);
    pendingById.set(requestId, { resolve, reject, timeoutId });
    entry.requestId = requestId;
    try {
      entry.worker.postMessage(request, [input.buffer]);
    } catch (err) {
      pendingById.delete(requestId);
      clearTimeout(timeoutId);
      entry.requestId = null;
      entry.busy = false;
      wakeNextWorker();
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
  for (const pending of pendingById.values()) {
    if (pending.timeoutId !== null) clearTimeout(pending.timeoutId);
  }
  pendingById.clear();
  requestSeq = 0;
}
