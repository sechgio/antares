import { mapWithConcurrencyLimit as mapWithSharedConcurrencyLimit } from '../../utils/mapWithConcurrencyLimit';

export function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  return mapWithSharedConcurrencyLimit(items, limit, fn, { signal, createAbortError });
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Image processing cancelled');
    error.name = 'AbortError';
    throw error;
  }
}

export function createAbortError(): Error {
  const error = new Error('Image processing cancelled');
  error.name = 'AbortError';
  return error;
}

export function availableCores(fallback: number): number {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number') {
      return navigator.hardwareConcurrency;
    }
  } catch {}
  return fallback;
}

export function resolveImportConcurrency(): number {
  const cores = availableCores(4);
  return Math.min(6, Math.max(2, Math.floor(cores / 2) || 2));
}

export function resolveProcessConcurrency(): number {
  const cores = availableCores(2);
  return Math.min(3, Math.max(1, Math.floor(cores / 2) || 1));
}
