import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGestureRaf } from '../ops/gestureRaf';

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
