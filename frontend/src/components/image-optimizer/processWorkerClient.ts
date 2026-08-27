import type { BatchSettings, CropOffset } from './types';
import type { ProcessWorkerRequest, ProcessWorkerResponse } from './imageProcess.worker';
import { availableCores, createAbortError, throwIfAborted } from './concurrency';
type Pending = {
  resolve: (value: ProcessWorkerResponse) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
  signal?: AbortSignal;
  abortHandler?: () => void;
};

type PooledWorker = {
  worker: Worker;
  busy: boolean;
  requestId: string | null;
  retired: boolean;
};

type WorkerWaiter = {
  cancelled: boolean;
  start: () => void;
  cancel: () => void;
};

let pool: PooledWorker[] | null = null;
const waitQueue: WorkerWaiter[] = [];
const pendingById = new Map<string, Pending>();
export const PROCESS_WORKER_TIMEOUT_MS = 30_000;
export const MAX_PROCESS_WORKER_QUEUE = 32;

function poolSize(): number {
  const cores = availableCores(2);
  return Math.min(2, Math.max(1, Math.floor(cores / 2) || 1));
}

export function canUseProcessWorker(): boolean {
  return (
    typeof Worker !== 'undefined'
    && typeof OffscreenCanvas !== 'undefined'
    && typeof createImageBitmap === 'function'
  );
}

function wakeNextWorker(): void {
  while (waitQueue.length > 0) {
    const waiter = waitQueue.shift();
    if (!waiter || waiter.cancelled) continue;
    waiter.start();
    return;
  }
}

function normalizeWorkerFailure(error: unknown): Error {
  return error instanceof Error ? error : new Error('Image process worker failed');
}

function clearPending(pending: Pending): void {
  if (pending.timeoutId !== null) clearTimeout(pending.timeoutId);
  if (pending.signal && pending.abortHandler) {
    pending.signal.removeEventListener('abort', pending.abortHandler);
  }
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
      clearPending(pending);
      pending.reject(normalizeWorkerFailure(error));
    }
  }

  if (normalizeWorkerFailure(error).name !== 'AbortError') {
    console.warn('[image-optimizer] worker error', error);
  }
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
    clearPending(pending);
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

function acquireWorker(signal?: AbortSignal): Promise<PooledWorker> {
  if (signal?.aborted) return Promise.reject(createAbortError());
  const workers = ensurePool();
  const idle = workers.find((w) => !w.busy);
  if (idle) {
    idle.busy = true;
    return Promise.resolve(idle);
  }

  if (waitQueue.length >= MAX_PROCESS_WORKER_QUEUE) {
    return Promise.reject(new Error('Image process worker queue capacity exhausted'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let waiter: WorkerWaiter;
    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const remove = () => {
      const index = waitQueue.indexOf(waiter);
      if (index >= 0) waitQueue.splice(index, 1);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      waiter.cancelled = true;
      remove();
      cleanup();
      reject(createAbortError());
    };
    waiter = {
      cancelled: false,
      start: () => {
        if (settled || waiter.cancelled) return;
        settled = true;
        cleanup();
        void acquireWorker(signal).then(resolve, reject);
      },
      cancel: onAbort,
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
    }
    waitQueue.push(waiter);
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
  signal?: AbortSignal;
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
  throwIfAborted(input.signal);

  const requestId = `img-${Date.now()}-${requestSeq += 1}`;
  const entry = await acquireWorker(input.signal);
  try {
    throwIfAborted(input.signal);
  } catch (error) {
    entry.busy = false;
    wakeNextWorker();
    throw error;
  }

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
    const abortHandler = () => {
      retireWorker(entry, createAbortError());
    };
    const pending: Pending = {
      resolve,
      reject,
      timeoutId,
      signal: input.signal,
      abortHandler,
    };
    pendingById.set(requestId, pending);
    entry.requestId = requestId;
    if (input.signal) {
      input.signal.addEventListener('abort', abortHandler, { once: true });
      if (input.signal.aborted) {
        abortHandler();
        return;
      }
    }
    try {
      entry.worker.postMessage(request, [input.buffer]);
    } catch (err) {
      pendingById.delete(requestId);
      clearPending(pending);
      entry.requestId = null;
      entry.busy = false;
      wakeNextWorker();
      reject(err);
    }
  });
  throwIfAborted(input.signal);

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
  pool?.forEach((entry) => entry.worker.terminate());
  pool = null;
  for (const waiter of waitQueue.splice(0)) waiter.cancel();
  for (const pending of pendingById.values()) {
    clearPending(pending);
  }
  pendingById.clear();
  requestSeq = 0;
}
