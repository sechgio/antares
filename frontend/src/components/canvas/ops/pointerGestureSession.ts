
export type PointerGestureSession = {
  readonly aborted: boolean;
  abort: () => void;
  dispose: () => void;
};

export type PointerGestureSessionOptions = {
  onMove: (ev: PointerEvent) => void;
  onEnd: (ev: PointerEvent | null, reason: 'up') => void;
  onKeyDown?: (ev: KeyboardEvent) => void;
  onAbort?: () => void;
};

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
