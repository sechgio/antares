import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef, type MutableRefObject } from 'react';
import { usePinchZoom } from '../hooks/usePinchZoom';

/**
 * Two-finger pinch (Figma/Canva-like): second touch starts the gesture,
 * moves coalesce to one apply per frame, activeRef stays true until all
 * fingers lift.
 */
function PinchHost({
  navRef,
  activeRef,
  onStart,
}: {
  navRef: MutableRefObject<{
    zoom: number;
    pan: { x: number; y: number };
    onZoom?: (z: number) => void;
    onPan?: (p: { x: number; y: number }) => void;
  }>;
  activeRef: MutableRefObject<boolean>;
  onStart?: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  usePinchZoom(viewportRef, navRef, { activeRef, onStart });
  return (
    <div
      ref={viewportRef}
      data-testid="pinch-viewport"
      style={{ width: 400, height: 300 }}
    />
  );
}

describe('usePinchZoom', () => {
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

  const touch = (type: string, pointerId: number, clientX: number, clientY: number, target: Element) => {
    target.dispatchEvent(
      new PointerEvent(type, {
        pointerId,
        pointerType: 'touch',
        clientX,
        clientY,
        bubbles: true,
      }),
    );
  };

  it('coalesces two-finger moves to one zoom/pan apply per frame and clears activeRef on lift', () => {
    const onZoom = vi.fn();
    const onPan = vi.fn();
    const onStart = vi.fn();
    const navRef = {
      current: { zoom: 1, pan: { x: 0, y: 0 }, onZoom, onPan },
    };
    const activeRef = { current: false };

    const { getByTestId } = render(
      <PinchHost navRef={navRef} activeRef={activeRef} onStart={onStart} />,
    );
    const el = getByTestId('pinch-viewport');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      right: 400,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    });

    // First finger alone does not start a pinch.
    act(() => {
      touch('pointerdown', 1, 150, 150, el);
    });
    expect(onStart).not.toHaveBeenCalled();
    expect(activeRef.current).toBe(false);

    // Second finger begins the gesture.
    act(() => {
      touch('pointerdown', 2, 250, 150, el);
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(activeRef.current).toBe(true);

    // Spread fingers (distance 100 → 200 = 2×) within one frame.
    act(() => {
      touch('pointermove', 1, 100, 150, el);
      touch('pointermove', 2, 300, 150, el);
    });
    expect(onZoom).not.toHaveBeenCalled();
    act(() => tick());
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onZoom.mock.calls[0]![0]).toBeCloseTo(2, 5);
    expect(onPan).toHaveBeenCalledTimes(1);

    act(() => {
      touch('pointerup', 1, 100, 150, el);
      touch('pointerup', 2, 300, 150, el);
    });
    expect(activeRef.current).toBe(false);
  });

  it('ignores non-touch pointers', () => {
    const onZoom = vi.fn();
    const navRef = {
      current: {
        zoom: 1,
        pan: { x: 0, y: 0 },
        onZoom,
        onPan: vi.fn(),
      },
    };
    const activeRef = { current: false };
    const { getByTestId } = render(<PinchHost navRef={navRef} activeRef={activeRef} />);
    const el = getByTestId('pinch-viewport');

    act(() => {
      el.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 1,
          pointerType: 'mouse',
          clientX: 100,
          clientY: 100,
          bubbles: true,
        }),
      );
      el.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 2,
          pointerType: 'mouse',
          clientX: 200,
          clientY: 100,
          bubbles: true,
        }),
      );
    });
    expect(activeRef.current).toBe(false);
    expect(onZoom).not.toHaveBeenCalled();
  });
});
