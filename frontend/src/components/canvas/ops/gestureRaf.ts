/**
 * Coalesce high-frequency gesture updates to one apply per animation frame
 * (Figma-style drag loop). Pointer events can fire several times per display
 * frame; applying each one wastes renders on states nobody ever sees. The
 * latest event wins — intermediate positions are skipped, never queued.
 */
export interface GestureRaf<E> {
  /** Keep the newest event and schedule a single frame apply (noop if one is queued). */
  schedule: (ev: E) => void;
  /** Apply the pending event synchronously (if any) and cancel the queued frame. */
  flush: () => void;
  /** Drop the pending event without applying it. */
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
