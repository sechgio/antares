export interface MapWithConcurrencyOptions {
  signal?: AbortSignal;
  createAbortError?: () => Error;
}

function throwIfAborted(options?: MapWithConcurrencyOptions): void {
  if (!options?.signal?.aborted) return;
  if (options.createAbortError) throw options.createAbortError();
  const error = new Error('Operation cancelled');
  error.name = 'AbortError';
  throw error;
}

export async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  options?: MapWithConcurrencyOptions,
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      throwIfAborted(options);
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  throwIfAborted(options);
  return results;
}
