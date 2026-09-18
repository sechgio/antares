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
  let timedOut = false;
  const msg = `${label} timed out after ${ms}ms`;
  const wrapped = Promise.resolve(promise).then(
    (value) => {
      if (timedOut) throw new Error(msg);
      return value;
    },
    (err) => {
      if (timedOut) throw new Error(msg);
      throw err;
    },
  );
  wrapped.catch(() => {});
  try {
    return await Promise.race([
      wrapped,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(msg));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
