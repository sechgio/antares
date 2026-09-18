
export type PointerGestureSession = {
  readonly aborted: boolean;
  abort: () => void;
  dispose: () => void;
};

export type PointerGestureSessionOptions = {
  pointerId?: number;
  onMove: (ev: PointerEvent) => void;
  onEnd: (ev: PointerEvent | null, reason: 'up') => void;
  onKeyDown?: (ev: KeyboardEvent) => void;
  onAbort?: () => void;
};

export type PointerGestureOwner = {
  start: (options: PointerGestureSessionOptions) => PointerGestureSession;
  abort: () => void;
  dispose: () => void;
};

let activeSession: PointerGestureSession | null = null;

export function getActivePointerGestureSession(): PointerGestureSession | null {
  return activeSession;
}

export function abortActivePointerGestureSession(): void {
  activeSession?.abort();
}

export function createPointerGestureOwner(): PointerGestureOwner {
  let ownedSession: PointerGestureSession | null = null;

  return {
    start(options) {
      let session!: PointerGestureSession;
      const clearOwnedSession = () => {
        if (ownedSession === session) ownedSession = null;
      };
      session = createPointerGestureSession({
        ...options,
        onEnd: (event, reason) => {
          clearOwnedSession();
          options.onEnd(event, reason);
        },
        onAbort: () => {
          clearOwnedSession();
          options.onAbort?.();
        },
      });
      ownedSession = session;
      return session;
    },
    abort() {
      ownedSession?.abort();
    },
    dispose() {
      ownedSession?.abort();
      ownedSession = null;
    },
  };
}

export function createPointerGestureSession(
  options: PointerGestureSessionOptions,
): PointerGestureSession {
  activeSession?.abort();

  let finished = false;
  let onMove!: (ev: PointerEvent) => void;
  let onUp!: (ev: PointerEvent) => void;
  let onCancel!: (ev: PointerEvent) => void;
  let onBlur!: () => void;
  let onKey: ((ev: KeyboardEvent) => void) | null = null;

  const detach = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('blur', onBlur);
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
    if (options.pointerId != null && ev.pointerId !== options.pointerId) return;
    options.onMove(ev);
  };

  const finish = (ev: PointerEvent | null) => {
    if (finished) return;
    finished = true;
    detach();
    if (activeSession === session) activeSession = null;
    options.onEnd(ev, 'up');
  };

  onUp = (ev: PointerEvent) => {
    if (options.pointerId != null && ev.pointerId !== options.pointerId) return;
    finish(ev);
  };
  onCancel = (ev: PointerEvent) => {
    if (options.pointerId != null && ev.pointerId !== options.pointerId) return;
    session.abort();
  };
  onBlur = () => session.abort();
  onKey = options.onKeyDown
    ? (ev: KeyboardEvent) => {
        if (finished) return;
        options.onKeyDown!(ev);
      }
    : null;

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('blur', onBlur);
  if (onKey) window.addEventListener('keydown', onKey);

  activeSession = session;
  return session;
}
