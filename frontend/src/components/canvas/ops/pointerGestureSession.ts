/**
 * Window-scoped pointer gesture session.
 *
 * Artboard attaches many ephemeral pointermove/up listeners; without a shared
 * abort path, OS pointercancel / mid-drag undo / unmount leave listeners+RAF
 * alive and can re-commit. One session owns attach, finish, and abort.
 * pointercancel and Escape take abort (revert), never onEnd commit.
 */

export type PointerGestureSession = {
  /** True after finish/abort — move handlers must no-op. */
  readonly aborted: boolean;
  /** Tear down without calling onEnd (undo / unmount). */
  abort: () => void;
  /** Same as natural pointerup cleanup; safe to call twice. */
  dispose: () => void;
};

export type PointerGestureSessionOptions = {
  onMove: (ev: PointerEvent) => void;
  /**
   * Called once on intentional pointerup (not on abort() / pointercancel).
   * OS pointercancel takes the abort path so mid-gesture cancel never commits.
   */
  onEnd: (ev: PointerEvent | null, reason: 'up') => void;
  /** Optional extra window listeners cleaned with the session (e.g. keydown). */
  onKeyDown?: (ev: KeyboardEvent) => void;
  /** Called when abort() / pointercancel runs (after listeners removed). */
  onAbort?: () => void;
};

/** Active Artboard/Rulers session — at most one; replaced when a new gesture starts. */
let activeSession: PointerGestureSession | null = null;

export function getActivePointerGestureSession(): PointerGestureSession | null {
  return activeSession;
}

export function abortActivePointerGestureSession(): void {
  activeSession?.abort();
}

export function createPointerGestureSession(
  options: PointerGestureSessionOptions,
): PointerGestureSession {
  // New gesture supersedes any leftover session (defensive; should be rare).
  activeSession?.abort();

  let finished = false;
  let onMove!: (ev: PointerEvent) => void;
  let onUp!: (ev: PointerEvent) => void;
  let onCancel!: (ev: PointerEvent) => void;
  let onKey: ((ev: KeyboardEvent) => void) | null = null;

  const detach = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    if (onKey) window.removeEventListener('keydown', onKey);
  };

  const session: PointerGestureSession = {
    get aborted() {
      return finished;
    },
    abort() {
      if (finished) return;
      finished = true;
      detach();
      if (activeSession === session) activeSession = null;
      options.onAbort?.();
    },
    dispose() {
      if (finished) return;
      finished = true;
      detach();
      if (activeSession === session) activeSession = null;
    },
  };

  onMove = (ev: PointerEvent) => {
    if (finished) return;
    options.onMove(ev);
  };

  const finish = (ev: PointerEvent | null) => {
    if (finished) return;
    finished = true;
    detach();
    if (activeSession === session) activeSession = null;
    options.onEnd(ev, 'up');
  };

  onUp = (ev: PointerEvent) => finish(ev);
  // OS cancel / lost capture: same as supersede — revert, never commit.
  onCancel = () => session.abort();
  onKey = options.onKeyDown
    ? (ev: KeyboardEvent) => {
        if (finished) return;
        options.onKeyDown!(ev);
      }
    : null;

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  if (onKey) window.addEventListener('keydown', onKey);

  activeSession = session;
  return session;
}
