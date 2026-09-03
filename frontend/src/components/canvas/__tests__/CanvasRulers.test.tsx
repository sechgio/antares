import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasRulers from '../editor/CanvasRulers';
import { MM_TO_PX } from '../ops/drawHelpers';

describe('CanvasRulers guide creation', () => {
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

  const setup = () => {
    const onCreateGuide = vi.fn();
    const onCommitGuideCreate = vi.fn();
    const onCancelCreate = vi.fn();
    render(
      <CanvasRulers
        zoom={1}
        pan={{ x: 0, y: 0 }}
        pageWidthMm={210}
        pageHeightMm={297}
        pageIndex={2}
        onCreateGuide={onCreateGuide}
        onCommitGuideCreate={onCommitGuideCreate}
        onCancelCreate={onCancelCreate}
      />,
    );
    return { onCreateGuide, onCommitGuideCreate, onCancelCreate };
  };

  it('aligns tick origin with the page edge despite the ruler strip offset', () => {
    setup();
    const frameW = Math.round(210 * MM_TO_PX);
    const topTicks = screen.getByTestId('canvas-ruler-top').firstElementChild as HTMLElement;
    expect(topTicks.style.left).toBe(`calc(50% - ${frameW / 2 + 10}px)`);
    const frameH = Math.round(297 * MM_TO_PX);
    const leftTicks = screen.getByTestId('canvas-ruler-left').firstElementChild as HTMLElement;
    expect(leftTicks.style.top).toBe(`calc(50% - ${frameH / 2 + 10}px)`);
  });

  it('creates a horizontal guide dragged out of the top ruler, with a position chip', () => {
    const { onCreateGuide, onCommitGuideCreate, onCancelCreate } = setup();
    const top = screen.getByTestId('canvas-ruler-top');
    fireEvent.pointerDown(top, { button: 0, clientX: 200, clientY: 5 });

    act(() => {
      fireEvent.pointerMove(window, { clientX: 200, clientY: 6 });
      tick();
    });
    expect(onCreateGuide).not.toHaveBeenCalled();
    expect(screen.queryByTestId('canvas-guide-create-preview')).toBeNull();

    act(() => {
      fireEvent.pointerMove(window, { clientX: 200, clientY: 120 });
      tick();
    });
    expect(onCreateGuide).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('canvas-guide-create-preview')).toBeTruthy();
    expect(screen.getByTestId('canvas-guide-chip').textContent).toMatch(/mm$/);

    act(() => {
      fireEvent.pointerUp(window, { clientX: 200, clientY: 120 });
    });
    expect(onCommitGuideCreate).toHaveBeenCalledTimes(1);
    const guide = onCommitGuideCreate.mock.calls[0][0];
    expect(guide.axis).toBe('y');
    expect(guide.pageIndex).toBe(2);
    expect(guide.posMm).toBeGreaterThan(0);
    expect(onCancelCreate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('canvas-guide-chip')).toBeNull();
  });

  it('clamps a vertical guide to the page extent', () => {
    const { onCreateGuide, onCommitGuideCreate, onCancelCreate } = setup();
    const left = screen.getByTestId('canvas-ruler-left');
    fireEvent.pointerDown(left, { button: 0, clientX: 5, clientY: 300 });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 5000, clientY: 300 });
      tick();
    });
    expect(onCreateGuide).toHaveBeenCalledTimes(1);
    act(() => {
      fireEvent.pointerUp(window, { clientX: 5000, clientY: 300 });
    });
    expect(onCommitGuideCreate).toHaveBeenCalledTimes(1);
    const guide = onCommitGuideCreate.mock.calls[0][0];
    expect(guide.axis).toBe('x');
    expect(guide.posMm).toBe(210);
    expect(onCancelCreate).not.toHaveBeenCalled();
  });

  it('cancels creation when released back onto the ruler', () => {
    const { onCreateGuide, onCommitGuideCreate, onCancelCreate } = setup();
    const top = screen.getByTestId('canvas-ruler-top');
    fireEvent.pointerDown(top, { button: 0, clientX: 200, clientY: 5 });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 200, clientY: 120 });
      tick();
    });
    expect(onCreateGuide).toHaveBeenCalled();
    act(() => {
      fireEvent.pointerMove(window, { clientX: 200, clientY: 10 });
      tick();
    });
    act(() => {
      fireEvent.pointerUp(window, { clientX: 200, clientY: 10 });
    });
    expect(onCommitGuideCreate).not.toHaveBeenCalled();
    expect(onCancelCreate).toHaveBeenCalledTimes(1);
  });

  it('Esc aborts creation and ignores further moves', () => {
    const { onCreateGuide, onCommitGuideCreate, onCancelCreate } = setup();
    const top = screen.getByTestId('canvas-ruler-top');
    fireEvent.pointerDown(top, { button: 0, clientX: 200, clientY: 5 });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 200, clientY: 120 });
      tick();
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onCancelCreate).toHaveBeenCalledTimes(1);
    expect(onCommitGuideCreate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('canvas-guide-chip')).toBeNull();
    act(() => {
      fireEvent.pointerMove(window, { clientX: 200, clientY: 200 });
      tick();
      fireEvent.pointerUp(window, { clientX: 200, clientY: 200 });
    });
    expect(onCommitGuideCreate).not.toHaveBeenCalled();
    expect(onCreateGuide.mock.calls.length).toBe(1);
  });
});
