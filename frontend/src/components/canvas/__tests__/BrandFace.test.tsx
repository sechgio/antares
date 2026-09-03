import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BrandFace from '../editor/BrandFace';

describe('BrandFace pointer batching', () => {
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

  const expectedEyeTransform = (
    clientX: number,
    clientY: number,
    rect: { left: number; top: number; width: number; height: number },
  ) => {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const max = rect.width * 0.15;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > max) {
      dx = (dx / dist) * max;
      dy = (dy / dist) * max;
    }
    return `translate(${dx}px, ${dy}px)`;
  };

  it('coalesces mousemove to one transform write per frame and caches getBoundingClientRect', () => {
    const { container } = render(<BrandFace />);
    const face = container.querySelector<HTMLElement>('.canvas-brand-face')!;
    const eyes = container.querySelectorAll<HTMLElement>('.canvas-brand-face-eye-track');
    expect(eyes).toHaveLength(2);

    const faceRect = {
      left: 100,
      top: 50,
      width: 40,
      height: 40,
      right: 140,
      bottom: 90,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    };
    const rectSpy = vi.spyOn(face, 'getBoundingClientRect').mockReturnValue(faceRect);

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    const readsBeforeMoves = rectSpy.mock.calls.length;

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 100 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 220, clientY: 110 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 240, clientY: 120 }));

    expect(eyes[0]!.style.transform).toBe('');
    expect(eyes[1]!.style.transform).toBe('');

    act(() => tick());

    const latest = expectedEyeTransform(240, 120, faceRect);
    expect(eyes[0]!.style.transform).toBe(latest);
    expect(eyes[1]!.style.transform).toBe(latest);

    expect(rectSpy.mock.calls.length).toBe(readsBeforeMoves + 1);

    const readsAfterFirstFrame = rectSpy.mock.calls.length;
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 126, clientY: 70 }));
    act(() => tick());
    expect(rectSpy.mock.calls.length).toBe(readsAfterFirstFrame);
    expect(eyes[0]!.style.transform).toBe('translate(6px, 0px)');
  });

  it('does not re-render BrandFace on mousemove (imperative eye tracking)', () => {
    let renderCount = 0;
    function Probe() {
      renderCount += 1;
      return <BrandFace />;
    }

    render(<Probe />);
    expect(renderCount).toBe(1);

    for (let i = 0; i < 40; i++) {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 + i, clientY: 50 + i }));
    }
    act(() => tick());

    expect(renderCount).toBe(1);
  });

  it('blinks via data-blink on the DOM without a React state commit', () => {
    vi.useFakeTimers();
    let renderCount = 0;
    function Probe() {
      renderCount += 1;
      return <BrandFace />;
    }

    const { container } = render(<Probe />);
    expect(renderCount).toBe(1);

    const pupils = container.querySelectorAll<HTMLElement>('.canvas-brand-face-eye');
    expect(pupils).toHaveLength(2);
    expect(pupils[0]!.hasAttribute('data-blink')).toBe(false);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(pupils[0]!.getAttribute('data-blink')).toBe('true');
    expect(pupils[1]!.getAttribute('data-blink')).toBe('true');
    expect(renderCount).toBe(1);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(pupils[0]!.hasAttribute('data-blink')).toBe(false);
    expect(renderCount).toBe(1);

    vi.useRealTimers();
  });
});
