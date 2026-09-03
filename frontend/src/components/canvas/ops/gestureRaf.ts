export interface GestureRaf<E> {
  schedule: (ev: E) => void;
  flush: () => void;
  cancel: () => void;
}

export function createGestureRaf<E>(apply: (ev: E) => void): GestureRaf<E> {
  let rafId: number | null = null;
  let pending: E | null = null;

  const run = () => {
    rafId = null;
    const ev = pending;
    pending = null;
    if (ev !== null) apply(ev);
  };

  return {
    schedule(ev) {
      pending = ev;
      if (rafId === null) rafId = requestAnimationFrame(run);
    },
    flush() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      run();
    },
    cancel() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pending = null;
    },
  };
}
