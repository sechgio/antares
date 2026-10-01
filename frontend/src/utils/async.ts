import type { RefObject } from 'react';

export function nextRequest(ref: RefObject<number>) {
  const id = ++ref.current;
  return { id, isCurrent: () => ref.current === id };
}

export async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const msg = `${label} timed out after ${ms}ms`;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(msg)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
