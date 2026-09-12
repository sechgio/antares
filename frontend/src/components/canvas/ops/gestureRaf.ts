import {
  normalizeWheelDelta,
  wheelGestureKind,
  type CoalescedWheel,
} from './viewportNav';

export interface GestureRaf<E> {
  schedule: (ev: E) => void;
  flush: () => void;
  cancel: () => void;
}

export interface WheelGestureInput {
  deltaX: number;
  deltaY: number;
  deltaMode?: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  clientX: number;
  clientY: number;
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

export function toCoalescedWheel(input: WheelGestureInput): CoalescedWheel {
  return {
    kind: wheelGestureKind(input.ctrlKey, input.metaKey),
    deltaX: normalizeWheelDelta(input.deltaX, input.deltaMode ?? 0),
    deltaY: normalizeWheelDelta(input.deltaY, input.deltaMode ?? 0),
    shiftKey: input.shiftKey,
    clientX: input.clientX,
    clientY: input.clientY,
  };
}

function canMergeWheel(prev: CoalescedWheel, next: CoalescedWheel): boolean {
  if (prev.kind !== next.kind) return false;
  if (prev.kind === 'pan' && prev.shiftKey !== next.shiftKey) return false;
  if (
    prev.kind === 'zoom'
    && (prev.clientX !== next.clientX || prev.clientY !== next.clientY)
  ) {
    return false;
  }
  return true;
}

export function createWheelGestureRaf(
  apply: (segments: CoalescedWheel[]) => void,
): GestureRaf<WheelGestureInput> {
  let rafId: number | null = null;
  let pending: CoalescedWheel[] = [];

  const run = () => {
    rafId = null;
    const segments = pending;
    pending = [];
    if (segments.length) apply(segments);
  };

  return {
    schedule(ev) {
      const next = toCoalescedWheel(ev);
      const last = pending[pending.length - 1];
      if (last && canMergeWheel(last, next)) {
        pending[pending.length - 1] = {
          ...last,
          deltaX: last.deltaX + next.deltaX,
          deltaY: last.deltaY + next.deltaY,
          shiftKey: next.shiftKey,
          clientX: next.clientX,
          clientY: next.clientY,
        };
      } else {
        pending.push(next);
      }
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
      pending = [];
    },
  };
}
