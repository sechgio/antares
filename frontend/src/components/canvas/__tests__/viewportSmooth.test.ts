import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSmoothViewport } from '../hooks/useSmoothViewport';
import {
  inertiaStep,
  lerpViewport,
  MIN_ZOOM,
  PAN_FRICTION,
  PAN_MIN_VELOCITY,
} from '../ops/viewportNav';

describe('lerpViewport / inertiaStep', () => {
  it('lerpViewport eases pan and interpolates zoom in log-space', () => {
    const from = { zoom: 1, pan: { x: 0, y: 0 } };
    const to = { zoom: 4, pan: { x: 100, y: 50 } };
    const mid = lerpViewport(from, to, 0.5);
    // easeOutCubic(0.5) = 0.875 — closer to the target than linear 0.5.
    expect(mid.pan.x).toBeCloseTo(87.5, 5);
    expect(mid.pan.y).toBeCloseTo(43.75, 5);
    // log-space: exp(log(1) + (log(4)-log(1))*0.875) = 4^0.875
    expect(mid.zoom).toBeCloseTo(Math.pow(4, 0.875), 3);
    expect(lerpViewport(from, to, 0)).toMatchObject({ zoom: 1, pan: { x: 0, y: 0 } });
    expect(lerpViewport(from, to, 1)).toMatchObject({ zoom: 4, pan: { x: 100, y: 50 } });
  });

  it('inertiaStep applies friction and stops below the velocity floor', () => {
    const step = inertiaStep({ x: 10, y: 20 }, { vx: 10, vy: -8 });
    expect(step).not.toBeNull();
    expect(step!.velocity.vx).toBeCloseTo(10 * PAN_FRICTION, 5);
    expect(step!.velocity.vy).toBeCloseTo(-8 * PAN_FRICTION, 5);
    expect(step!.pan.x).toBeCloseTo(10 + 10 * PAN_FRICTION, 5);
    expect(step!.pan.y).toBeCloseTo(20 - 8 * PAN_FRICTION, 5);

    expect(inertiaStep({ x: 0, y: 0 }, { vx: PAN_MIN_VELOCITY / 2, vy: 0 })).toBeNull();
  });
});

describe('useSmoothViewport', () => {
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
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const tick = (now: number) => {
    (performance.now as ReturnType<typeof vi.fn>).mockReturnValue(now);
    const queued = [...frames.entries()];
    frames.clear();
    queued.forEach(([, cb]) => cb(now));
  };

  it('setZoom clamps instantly and cancels an in-flight animateTo', () => {
    const { result } = renderHook(() => useSmoothViewport(1));
    act(() => {
      result.current.animateTo({ zoom: 2, pan: { x: 40, y: 0 } }, 200);
    });
    expect(frames.size).toBe(1);
    act(() => {
      result.current.setZoom(0);
    });
    expect(result.current.zoom).toBe(MIN_ZOOM);
    expect(frames.size).toBe(0);
  });

  it('animateTo interpolates toward the target over the duration', () => {
    const { result } = renderHook(() => useSmoothViewport(1));
    act(() => {
      result.current.animateTo({ zoom: 2, pan: { x: 80, y: 0 } }, 200);
    });
    act(() => tick(0));
    act(() => tick(100)); // halfway through duration
    expect(result.current.zoom).toBeGreaterThan(1);
    expect(result.current.zoom).toBeLessThan(2);
    expect(result.current.pan.x).toBeGreaterThan(0);
    act(() => tick(200));
    expect(result.current.zoom).toBe(2);
    expect(result.current.pan.x).toBe(80);
  });

  it('startInertia glides pan then stops when velocity decays', () => {
    const { result } = renderHook(() => useSmoothViewport(1));
    act(() => {
      result.current.setPan({ x: 0, y: 0 });
      result.current.startInertia({ vx: 8, vy: 0 });
    });
    const before = result.current.pan.x;
    // Drive enough frames for friction to settle below PAN_MIN_VELOCITY.
    for (let i = 0; i < 80 && frames.size > 0; i += 1) {
      act(() => tick(i * 16));
    }
    expect(result.current.pan.x).toBeGreaterThan(before);
    expect(frames.size).toBe(0);
  });

  it('setPan cancels running inertia', () => {
    const { result } = renderHook(() => useSmoothViewport(1));
    act(() => {
      result.current.startInertia({ vx: 20, vy: 0 });
    });
    expect(frames.size).toBe(1);
    act(() => {
      result.current.setPan({ x: 5, y: 5 });
    });
    expect(result.current.pan).toEqual({ x: 5, y: 5 });
    expect(frames.size).toBe(0);
  });
});
