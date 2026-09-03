export async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      throwIfAborted(signal);
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  throwIfAborted(signal);
  return results;
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
