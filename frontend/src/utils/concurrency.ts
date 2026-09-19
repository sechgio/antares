export interface ConcurrencyLimiter {
  <T>(fn: () => Promise<T>): Promise<T>;
  /** Descarta la cola y pone el contador a cero (las tareas en vuelo siguen); para tests. */
  reset(): void;
}

/**
 * Gate FIFO de concurrencia con estado propio: corre `fn` de inmediato si hay
 * cupo, si no la encola (hasta `maxQueue` esperando; sin tope si no se indica)
 * y la drena al liberarse un slot.
 */
export function createConcurrencyLimiter(
  limit: number,
  options: { maxQueue?: number; capacityError?: () => Error } = {},
): ConcurrencyLimiter {
  let active = 0;
  const waitQueue: Array<() => void> = [];

  function runLimited<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active += 1;
        Promise.resolve()
          .then(fn)
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            const next = waitQueue.shift();
            if (next) next();
          });
      };
      if (active < limit) start();
      else if (options.maxQueue === undefined || waitQueue.length < options.maxQueue) {
        waitQueue.push(start);
      } else {
        reject(options.capacityError?.() ?? new Error('Concurrency queue capacity exhausted'));
      }
    });
  }

  runLimited.reset = () => {
    waitQueue.length = 0;
    active = 0;
  };
  return runLimited;
}
