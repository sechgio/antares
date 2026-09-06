import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGestureRaf, createWheelGestureRaf, type WheelGestureInput } from '../ops/gestureRaf';

describe('createGestureRaf', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextId: number;

  beforeEach(() => {
    frames = new Map();
    nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const tick = (now = 16.7) => {
    const queued = [...frames.values()];
    frames.clear();
    queued.forEach((cb) => cb(now));
  };

  it('applies only the latest event once per frame', () => {
    const seen: number[] = [];
    const raf = createGestureRaf((n: number) => seen.push(n));
    raf.schedule(1);
    raf.schedule(2);
    raf.schedule(3);
    expect(seen).toEqual([]);
    tick();
    expect(seen).toEqual([3]);
  });

  it('schedules again on the next frame after applying', () => {
    const seen: number[] = [];
    const raf = createGestureRaf((n: number) => seen.push(n));
    raf.schedule(1);
    tick();
    raf.schedule(2);
    tick();
    expect(seen).toEqual([1, 2]);
  });

  it('flush applies the pending event synchronously and cancels the queued frame', () => {
    const seen: number[] = [];
    const raf = createGestureRaf((n: number) => seen.push(n));
    raf.schedule(1);
    raf.schedule(2);
    raf.flush();
    expect(seen).toEqual([2]);
    tick();
    expect(seen).toEqual([2]);
  });

  it('flush without a pending event is a noop', () => {
    const apply = vi.fn();
    const raf = createGestureRaf(apply);
    raf.flush();
    expect(apply).not.toHaveBeenCalled();
  });

  it('cancel drops the pending event without applying it', () => {
    const apply = vi.fn();
    const raf = createGestureRaf(apply);
    raf.schedule(1);
    raf.cancel();
    tick();
    expect(apply).not.toHaveBeenCalled();
    raf.schedule(5);
    tick();
    expect(apply).toHaveBeenCalledWith(5);
  });
});

function wheel(partial: Partial<WheelGestureInput> & Pick<WheelGestureInput, 'deltaY'>): WheelGestureInput {
  return {
    deltaX: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    clientX: 100,
    clientY: 80,
    ...partial,
  };
}

describe('createWheelGestureRaf', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextId: number;

  beforeEach(() => {
    frames = new Map();
    nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const tick = (now = 16.7) => {
    const queued = [...frames.values()];
    frames.clear();
    queued.forEach((cb) => cb(now));
  };

  it('accumulates same-kind wheel deltas instead of keeping only the last event', () => {
    const seen: Array<{ kind: string; deltaX: number; deltaY: number }> = [];
    const raf = createWheelGestureRaf((segments) => {
      seen.push(...segments.map((s) => ({ kind: s.kind, deltaX: s.deltaX, deltaY: s.deltaY })));
    });
    raf.schedule(wheel({ deltaY: 10 }));
    raf.schedule(wheel({ deltaY: 25 }));
    raf.schedule(wheel({ deltaX: 4, deltaY: 5 }));
    expect(seen).toEqual([]);
    tick();
    expect(seen).toEqual([{ kind: 'pan', deltaX: 4, deltaY: 40 }]);
  });

  it('normalizes deltaMode line and page units to pixels before accumulating', () => {
    const seen: number[] = [];
    const raf = createWheelGestureRaf((segments) => {
      seen.push(...segments.map((s) => s.deltaY));
    });
    raf.schedule(wheel({ deltaY: 2, deltaMode: 1 }));
    raf.schedule(wheel({ deltaY: 1, deltaMode: 2 }));
    tick();
    expect(seen).toEqual([2 * 16 + 400]);
  });

  it('does not merge pan and zoom that arrive in the same frame', () => {
    const seen: Array<{ kind: string; deltaY: number }> = [];
    const raf = createWheelGestureRaf((segments) => {
      seen.push(...segments.map((s) => ({ kind: s.kind, deltaY: s.deltaY })));
    });
    raf.schedule(wheel({ deltaY: 12 }));
    raf.schedule(wheel({ deltaY: 30, ctrlKey: true, clientX: 40, clientY: 50 }));
    raf.schedule(wheel({ deltaY: 8, metaKey: true, clientX: 42, clientY: 51 }));
    tick();
    expect(seen).toEqual([
      { kind: 'pan', deltaY: 12 },
      { kind: 'zoom', deltaY: 38 },
    ]);
  });

  it('does not merge pan events with different shift modifiers', () => {
    const seen: Array<{ shiftKey: boolean; deltaY: number }> = [];
    const raf = createWheelGestureRaf((segments) => {
      seen.push(...segments.map((s) => ({ shiftKey: s.shiftKey, deltaY: s.deltaY })));
    });
    raf.schedule(wheel({ deltaY: 10, shiftKey: true }));
    raf.schedule(wheel({ deltaY: 6, shiftKey: false }));
    tick();
    expect(seen).toEqual([
      { shiftKey: true, deltaY: 10 },
      { shiftKey: false, deltaY: 6 },
    ]);
  });

  it('flush applies the accumulated burst and cancel drops it', () => {
    const apply = vi.fn();
    const raf = createWheelGestureRaf(apply);
    raf.schedule(wheel({ deltaY: 3 }));
    raf.schedule(wheel({ deltaY: 4 }));
    raf.flush();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0][0]).toMatchObject({ kind: 'pan', deltaY: 7 });
    tick();
    expect(apply).toHaveBeenCalledTimes(1);

    raf.schedule(wheel({ deltaY: 9 }));
    raf.cancel();
    tick();
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
