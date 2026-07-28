import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Artboard from '../editor/Artboard';
import { MM_TO_PX } from '../ops/drawHelpers';
import { createGuide } from '../ops/guides';
import { createEmptyDocument } from '../types';

/**
 * Manual guide dragging (Figma parity): live preview while dragging, commit
 * once on release, drop on the ruler strip to remove (with visual feedback),
 * Esc cancels and restores the original position.
 */
describe('Artboard guide dragging', () => {
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
    const document = createEmptyDocument('Test');
    const guide = createGuide('x', 50, 0);
    document.guides = [guide];
    const onMoveGuide = vi.fn();
    const onRemoveGuide = vi.fn();
    render(
      <Artboard
        document={document}
        selectedIds={[]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
        onMoveGuide={onMoveGuide}
        onRemoveGuide={onRemoveGuide}
      />,
    );
    return { guide, onMoveGuide, onRemoveGuide };
  };

  it('drags a guide with live preview and commits once on release', () => {
    const { guide, onMoveGuide, onRemoveGuide } = setup();
    fireEvent.pointerDown(screen.getByTestId('canvas-manual-guide'), { button: 0, clientX: 189, clientY: 300 });

    act(() => {
      fireEvent.pointerMove(window, { clientX: 265, clientY: 300 });
      tick();
    });
    // Live preview only: chip follows the pointer, nothing committed yet.
    expect(screen.getByTestId('canvas-guide-chip').textContent).toBe('70.1 mm');
    expect(onMoveGuide).not.toHaveBeenCalled();

    act(() => {
      fireEvent.pointerUp(window, { clientX: 265, clientY: 300 });
    });
    expect(onRemoveGuide).not.toHaveBeenCalled();
    expect(onMoveGuide).toHaveBeenCalledTimes(1);
    expect(onMoveGuide.mock.calls[0][0]).toBe(guide.id);
    expect(onMoveGuide.mock.calls[0][1]).toBeCloseTo(265 / MM_TO_PX, 1);
    expect(screen.queryByTestId('canvas-guide-chip')).toBeNull();
  });

  it('shows remove feedback over the ruler and removes on drop there', () => {
    const { guide, onMoveGuide, onRemoveGuide } = setup();
    fireEvent.pointerDown(screen.getByTestId('canvas-manual-guide'), { button: 0, clientX: 189, clientY: 300 });

    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 300 });
      tick();
    });
    expect(screen.getByTestId('canvas-guide-chip').textContent).toBe('Eliminar guía');

    act(() => {
      fireEvent.pointerUp(window, { clientX: 10, clientY: 300 });
    });
    expect(onRemoveGuide).toHaveBeenCalledWith(guide.id);
    expect(onMoveGuide).not.toHaveBeenCalled();
  });

  it('keeps the guide when dragged into the ruler zone and back out', () => {
    const { guide, onMoveGuide, onRemoveGuide } = setup();
    fireEvent.pointerDown(screen.getByTestId('canvas-manual-guide'), { button: 0, clientX: 189, clientY: 300 });

    act(() => {
      fireEvent.pointerMove(window, { clientX: 10, clientY: 300 });
      tick();
    });
    expect(screen.getByTestId('canvas-guide-chip').textContent).toBe('Eliminar guía');

    // Drag back out of the zone → the removal is cancelled.
    act(() => {
      fireEvent.pointerMove(window, { clientX: 265, clientY: 300 });
      tick();
    });
    act(() => {
      fireEvent.pointerUp(window, { clientX: 265, clientY: 300 });
    });
    expect(onRemoveGuide).not.toHaveBeenCalled();
    expect(onMoveGuide).toHaveBeenCalledTimes(1);
    expect(onMoveGuide.mock.calls[0][0]).toBe(guide.id);
  });

  it('Esc cancels the drag and restores the original position', () => {
    const { onMoveGuide, onRemoveGuide } = setup();
    fireEvent.pointerDown(screen.getByTestId('canvas-manual-guide'), { button: 0, clientX: 189, clientY: 300 });

    act(() => {
      fireEvent.pointerMove(window, { clientX: 265, clientY: 300 });
      tick();
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.queryByTestId('canvas-guide-chip')).toBeNull();

    act(() => {
      fireEvent.pointerUp(window, { clientX: 265, clientY: 300 });
    });
    expect(onMoveGuide).not.toHaveBeenCalled();
    expect(onRemoveGuide).not.toHaveBeenCalled();
    // Line restored to its original spot (50mm → 189px at zoom 1).
    expect((screen.getByTestId('canvas-manual-guide') as HTMLElement).style.left).toBe('189px');
  });

  it('keeps guide hit target screen-constant under camera zoom (Figma chrome)', () => {
    const document = createEmptyDocument('Zoom guides');
    document.guides = [createGuide('x', 50, 0)];
    const { rerender } = render(
      <Artboard
        document={document}
        selectedIds={[]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
      />,
    );
    const at1 = screen.getByTestId('canvas-manual-guide') as HTMLElement;
    expect(at1.style.width).toBe('10px');

    rerender(
      <Artboard
        document={document}
        selectedIds={[]}
        zoom={0.5}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
      />,
    );
    const atHalf = screen.getByTestId('canvas-manual-guide') as HTMLElement;
    // Inside CSS zoom 0.5, layout width 20px → 10px on screen.
    expect(atHalf.style.width).toBe('20px');
  });
});

