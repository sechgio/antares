import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  abortActivePointerGestureSession,
  createPointerGestureSession,
  getActivePointerGestureSession,
} from '../ops/pointerGestureSession';

describe('createPointerGestureSession', () => {
  afterEach(() => {
    abortActivePointerGestureSession();
  });

  it('calls onEnd on pointerup and detaches listeners', () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const session = createPointerGestureSession({ onMove, onEnd });
    expect(getActivePointerGestureSession()).toBe(session);

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 1, clientY: 2 }));
    expect(onMove).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 3, clientY: 4 }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd.mock.calls[0]![1]).toBe('up');
    expect(session.aborted).toBe(true);
    expect(getActivePointerGestureSession()).toBeNull();

    onMove.mockClear();
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 9, clientY: 9 }));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('pointercancel aborts without calling onEnd (no commit)', () => {
    const onEnd = vi.fn();
    const onAbort = vi.fn();
    const session = createPointerGestureSession({ onMove: () => {}, onEnd, onAbort });
    window.dispatchEvent(new PointerEvent('pointercancel'));
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
    expect(session.aborted).toBe(true);
    expect(getActivePointerGestureSession()).toBeNull();
  });

  it('Escape via onKeyDown can abort without onEnd', () => {
    const onEnd = vi.fn();
    const onAbort = vi.fn();
    let session: ReturnType<typeof createPointerGestureSession>;
    session = createPointerGestureSession({
      onMove: () => {},
      onEnd,
      onAbort,
      onKeyDown: (ev) => {
        if (ev.key === 'Escape') session.abort();
      },
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('abort skips onEnd, runs onAbort, and blocks later move/up', () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const onAbort = vi.fn();
    const session = createPointerGestureSession({ onMove, onEnd, onAbort });

    session.abort();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
    expect(session.aborted).toBe(true);

    window.dispatchEvent(new PointerEvent('pointermove'));
    window.dispatchEvent(new PointerEvent('pointerup'));
    expect(onMove).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('abortActivePointerGestureSession tears down the active session', () => {
    const onAbort = vi.fn();
    createPointerGestureSession({ onMove: () => {}, onEnd: () => {}, onAbort });
    abortActivePointerGestureSession();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(getActivePointerGestureSession()).toBeNull();
  });

  it('starting a new session aborts the previous one', () => {
    const firstAbort = vi.fn();
    const firstEnd = vi.fn();
    createPointerGestureSession({
      onMove: () => {},
      onEnd: firstEnd,
      onAbort: firstAbort,
    });
    createPointerGestureSession({ onMove: () => {}, onEnd: () => {} });
    expect(firstAbort).toHaveBeenCalledTimes(1);
    expect(firstEnd).not.toHaveBeenCalled();
  });
});
