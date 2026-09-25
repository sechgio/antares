import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import Artboard from '../editor/Artboard';
import { createFrameRectCache } from '../editor/frameRectCache';
import { createEmptyDocument, type CanvasLayer } from '../types';

const { applyLayerDomGeometrySpy, collectReferenceGapsSpy } = vi.hoisted(() => ({
  applyLayerDomGeometrySpy: vi.fn(),
  collectReferenceGapsSpy: vi.fn(),
}));

vi.mock('../ops/guides', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ops/guides')>();
  return {
    ...actual,
    collectReferenceGaps: (...args: Parameters<typeof actual.collectReferenceGaps>) => {
      collectReferenceGapsSpy(...args);
      return actual.collectReferenceGaps(...args);
    },
  };
});

vi.mock('../ops/imperativeLayerDom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ops/imperativeLayerDom')>();
  return {
    ...actual,
    applyLayerDomGeometry: (...args: Parameters<typeof actual.applyLayerDomGeometry>) => {
      applyLayerDomGeometrySpy(...args);
      actual.applyLayerDomGeometry(...args);
    },
  };
});

describe('createFrameRectCache', () => {
  it('re-reads getBoundingClientRect when zoomRef changes mid-gesture', () => {
    const frame = document.createElement('div');
    const rects = [
      { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} },
      { left: 10, top: 20, width: 200, height: 200, right: 210, bottom: 220, x: 10, y: 20, toJSON() {} },
    ] as DOMRect[];
    let calls = 0;
    frame.getBoundingClientRect = () => rects[calls++]!;
    const zoomRef = { current: 1 };
    const cache = createFrameRectCache(frame, zoomRef);
    expect(cache.read()).toBe(rects[0]);
    expect(cache.read()).toBe(rects[0]);
    zoomRef.current = 2;
    expect(cache.read()).toBe(rects[1]);
  });
});

describe('Artboard drag gestures', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextId: number;

  beforeEach(() => {
    applyLayerDomGeometrySpy.mockClear();
    collectReferenceGapsSpy.mockClear();
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

  it('keeps the default zoom without forcing an auto-fit on mount', () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.getAttribute?.('data-testid') === 'canvas-viewport') {
        return {
          width: 848,
          height: 648,
          top: 0,
          left: 0,
          bottom: 648,
          right: 848,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalRect.call(this);
    };
    try {
      const onZoom = vi.fn();
      const onPan = vi.fn();
      const document = createEmptyDocument('Test');
      render(
        <Artboard
          document={document}
          selectedIds={[]}
          zoom={1}
          tool="select"
          pan={{ x: 0, y: 0 }}
          onPan={onPan}
          onZoom={onZoom}
          onSelect={() => {}}
          onSelectIds={() => {}}
          onChangeLayers={() => {}}
        />,
      );

      expect(onZoom).not.toHaveBeenCalled();
      expect(onPan).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });

  const setup = (layers: CanvasLayer[], selectedIds: string[]) => {
    const document = createEmptyDocument('Test');
    document.layers.push(...layers);
    const onChangeLayers = vi.fn();
    const utils = render(
      <Artboard
        document={document}
        selectedIds={selectedIds}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={onChangeLayers}
      />,
    );
    return { ...utils, onChangeLayers };
  };

  it('shows a size badge under the selection bbox', () => {
    const layer = createLayer('rect');
    setup([layer], [layer.id]);
    expect(screen.getByTestId('canvas-size-badge').textContent).toBe('50 × 40');
  });

  it('coalesces pointermove to one preview per frame and commits once on pointerup', () => {
    const layer = createLayer('rect');
    const { container, onChangeLayers } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    expect(node.style.transform).toBe('translate(76px, 378px)');

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 10 * (96 / 25.4), clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 20 * (96 / 25.4), clientY: 100 });

    expect(node.style.transform).toBe('translate(76px, 378px)');
    expect(onChangeLayers).not.toHaveBeenCalled();

    act(() => tick());
    expect(node.style.transform).toBe('translate(151px, 378px)');
    expect(node.style.willChange).toBe('transform');
    expect(onChangeLayers).not.toHaveBeenCalled();

    fireEvent.pointerMove(window, { clientX: 100 + 40 * (96 / 25.4), clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 100 + 40 * (96 / 25.4), clientY: 100 });

    expect(onChangeLayers).toHaveBeenCalledTimes(1);
    const committed = onChangeLayers.mock.calls[0][0] as CanvasLayer[];
    const moved = committed.find((l) => l.id === layer.id)!;
    expect(moved.cssVars['--translate-x']).toBe('60mm');
    expect(moved.cssVars['--translate-y']).toBe('100mm');
  });

  it('keeps the selection chrome in the same frame as the moved layer', () => {
    const layer = createLayer('rect');
    const { container } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const mm = 96 / 25.4;

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 20 * mm, clientY: 100 });
    tick();

    expect(node.style.transform).toBe('translate(151px, 378px)');
    expect(screen.getByTestId('canvas-selection-chrome').style.left).toBe('151px');

    act(() => {
      fireEvent.pointerUp(window, { clientX: 100 + 20 * mm, clientY: 100 });
    });
  });

  it('prepares equal-gap references only after a drag starts and only once', () => {
    const layer = createLayer('rect');
    const { container } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const mm = 96 / 25.4;

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
    expect(collectReferenceGapsSpy).not.toHaveBeenCalled();

    fireEvent.pointerMove(window, { clientX: 101, clientY: 100 });
    act(() => tick());
    expect(collectReferenceGapsSpy).not.toHaveBeenCalled();

    fireEvent.pointerMove(window, { clientX: 100 + 10 * mm, clientY: 100 });
    act(() => tick());
    expect(collectReferenceGapsSpy).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(window, { clientX: 100 + 12 * mm, clientY: 100 });
    act(() => tick());
    expect(collectReferenceGapsSpy).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(window, { clientX: 100 + 12 * mm, clientY: 100 });
  });

  it('does not reapply layer geometry for overlay-only updates during a move', () => {
    const layer = createLayer('rect');
    const { container } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const mm = 96 / 25.4;

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 10 * mm, clientY: 100 });
    act(() => tick());
    expect(applyLayerDomGeometrySpy).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(window, { clientX: 100 + 20 * mm, clientY: 100 });
    act(() => tick());
    expect(applyLayerDomGeometrySpy).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(window, { clientX: 100 + 20 * mm, clientY: 100 });
  });

  it('suelta el baseline del gesto y revierte el preview cuando se cancela el drag', () => {
    const layer = createLayer('rect');
    const document = createEmptyDocument('Test');
    document.layers.push(layer);
    const onPreviewLayers = vi.fn();
    const onCommitGesture = vi.fn();
    const onCancelGesture = vi.fn();
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[layer.id]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
        onPreviewLayers={onPreviewLayers}
        onCommitGesture={onCommitGesture}
        onCancelGesture={onCancelGesture}
      />,
    );
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const origin = node.style.transform;
    const mm = 96 / 25.4;

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 20 * mm, clientY: 100 });
    act(() => tick());
    expect(onPreviewLayers).toHaveBeenCalled();
    expect(node.style.transform).not.toBe(origin);

    act(() => {
      window.dispatchEvent(new PointerEvent('pointercancel'));
    });

    expect(onCancelGesture).toHaveBeenCalledTimes(1);
    expect(onCommitGesture).not.toHaveBeenCalled();
    expect(node.style.transform).toBe(origin);
  });

  it('moves every selected layer together in one commit', () => {
    const a = createLayer('rect');
    const b = createLayer('rect');
    const { container, onChangeLayers } = setup([a, b], [a.id, b.id]);
    const nodeA = container.querySelector<HTMLElement>(`[data-layer-id="${a.id}"]`)!;

    fireEvent.pointerDown(nodeA, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 20 * (96 / 25.4), clientY: 100 });
    act(() => tick());
    fireEvent.pointerUp(window, { clientX: 100 + 20 * (96 / 25.4), clientY: 100 });

    expect(onChangeLayers).toHaveBeenCalledTimes(1);
    const committed = onChangeLayers.mock.calls[0][0] as CanvasLayer[];
    expect(committed.find((l) => l.id === a.id)!.cssVars['--translate-x']).toBe('40mm');
    expect(committed.find((l) => l.id === b.id)!.cssVars['--translate-x']).toBe('40mm');
  });

  it('keeps object-guide alignment when grid snapping is also enabled', () => {
    const moving = createLayer('rect', {
      cssVars: {
        '--translate-x': '20mm',
        '--translate-y': '20mm',
        '--width': '10mm',
        '--height': '10mm',
      },
    });
    const fixed = createLayer('rect', {
      cssVars: {
        '--translate-x': '43mm',
        '--translate-y': '20mm',
        '--width': '10mm',
        '--height': '10mm',
      },
    });
    const document = createEmptyDocument('Snap priority');
    document.layers.push(moving, fixed);
    const onChangeLayers = vi.fn();
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[moving.id]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        snapToGrid
        gridSizeMm={5}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={onChangeLayers}
      />,
    );
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${moving.id}"]`)!;
    const mm = 96 / 25.4;

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 22.6 * mm, clientY: 100 });
    act(() => tick());
    expect(
      screen.queryAllByTestId('canvas-smart-guide').length + screen.queryAllByTestId('canvas-distance-label').length,
    ).toBeGreaterThan(0);
    fireEvent.pointerUp(window, { clientX: 100 + 22.6 * mm, clientY: 100 });

    const committed = onChangeLayers.mock.calls[0][0] as CanvasLayer[];
    expect(committed.find((layer) => layer.id === moving.id)!.cssVars['--translate-x']).toBe('43mm');
  });

  it('Alt+drag duplicates then moves the copy in one commit (Figma)', () => {
    const layer = createLayer('rect');
    const document = createEmptyDocument('Test');
    document.layers.push(layer);
    const onChangeLayers = vi.fn();
    const onSelectIds = vi.fn();
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[layer.id]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={onSelectIds}
        onChangeLayers={onChangeLayers}
      />,
    );
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const mm = 96 / 25.4;

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100, altKey: true });
    fireEvent.pointerMove(window, {
      clientX: 100 + 20 * mm,
      clientY: 100,
      altKey: true,
    });
    act(() => tick());
    fireEvent.pointerUp(window, {
      clientX: 100 + 20 * mm,
      clientY: 100,
      altKey: true,
    });

    expect(onSelectIds).toHaveBeenCalled();
    const newIds = onSelectIds.mock.calls[0]![0] as string[];
    expect(newIds).toHaveLength(1);
    expect(newIds[0]).not.toBe(layer.id);

    expect(onChangeLayers).toHaveBeenCalledTimes(1);
    const committed = onChangeLayers.mock.calls[0][0] as CanvasLayer[];
    const original = committed.find((l) => l.id === layer.id)!;
    const copy = committed.find((l) => l.id === newIds[0])!;
    expect(original).toBeTruthy();
    expect(copy).toBeTruthy();
    expect(original.cssVars['--translate-x']).toBe('20mm');
    expect(copy.cssVars['--translate-x']).toBe('40mm');
  });

  it('restores the original selection when Alt+drag is cancelled', () => {
    const layer = createLayer('rect');
    const document = createEmptyDocument('Test');
    document.layers.push(layer);
    const onChangeLayers = vi.fn();
    const onSelect = vi.fn();
    const onSelectIds = vi.fn();
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={onSelect}
        onSelectIds={onSelectIds}
        onChangeLayers={onChangeLayers}
      />,
    );
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const mm = 96 / 25.4;

    fireEvent.pointerDown(node, {
      button: 0,
      clientX: 100,
      clientY: 100,
      altKey: true,
    });
    fireEvent.pointerMove(window, {
      clientX: 100 + 20 * mm,
      clientY: 100,
      altKey: true,
    });
    act(() => tick());
    expect(onSelectIds).toHaveBeenCalledTimes(1);
    expect(onSelectIds.mock.calls[0]![0]).not.toEqual([layer.id]);

    window.dispatchEvent(new PointerEvent('pointercancel'));

    expect(onChangeLayers).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith(layer.id, false);
    expect(onSelectIds).toHaveBeenLastCalledWith([layer.id]);
  });

  it('aborts a selection drag when a second touch starts a pinch', () => {
    const layer = createLayer('rect');
    const document = createEmptyDocument('Test');
    document.layers.push(layer);
    const onChangeLayers = vi.fn();
    const onSelectIds = vi.fn();
    const onPan = vi.fn();
    const onZoom = vi.fn();
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[layer.id]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={onPan}
        onZoom={onZoom}
        onSelect={() => {}}
        onSelectIds={onSelectIds}
        onChangeLayers={onChangeLayers}
      />,
    );
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const mm = 96 / 25.4;

    fireEvent.pointerDown(node, {
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(node, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 100 + 20 * mm,
      clientY: 100,
    });
    act(() => tick());

    fireEvent.pointerDown(node, {
      pointerId: 2,
      pointerType: 'touch',
      button: 0,
      clientX: 250,
      clientY: 100,
    });
    fireEvent.pointerMove(node, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 80,
      clientY: 100,
    });
    fireEvent.pointerMove(node, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 270,
      clientY: 100,
    });
    act(() => tick());
    fireEvent.pointerUp(node, {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 80,
      clientY: 100,
    });
    fireEvent.pointerUp(node, {
      pointerId: 2,
      pointerType: 'touch',
      clientX: 270,
      clientY: 100,
    });

    expect(onChangeLayers).not.toHaveBeenCalled();
    expect(onPan).toHaveBeenCalled();
    expect(onZoom).toHaveBeenCalled();
  });

  it('Shift+drag moves with axis lock instead of aborting (Figma)', () => {
    const layer = createLayer('rect');
    const document = createEmptyDocument('Test');
    document.layers.push(layer);
    const onChangeLayers = vi.fn();
    const onSelectIds = vi.fn();
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[layer.id]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={onSelectIds}
        onChangeLayers={onChangeLayers}
      />,
    );
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const mm = 96 / 25.4;
    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100, shiftKey: true });
    fireEvent.pointerMove(window, {
      clientX: 100 + 30 * mm,
      clientY: 100 + 10 * mm,
      shiftKey: true,
    });
    act(() => tick());
    fireEvent.pointerUp(window, {
      clientX: 100 + 30 * mm,
      clientY: 100 + 10 * mm,
      shiftKey: true,
    });

    expect(onChangeLayers).toHaveBeenCalledTimes(1);
    const moved = (onChangeLayers.mock.calls[0][0] as CanvasLayer[]).find((l) => l.id === layer.id)!;
    expect(moved.cssVars['--translate-x']).toBe('50mm');
    expect(moved.cssVars['--translate-y']).toBe('100mm');
    expect(onSelectIds).not.toHaveBeenCalled();
  });

  it('applies Shift axis lock as soon as it is pressed mid-drag, without moving the pointer', () => {
    const layer = createLayer('rect');
    const { container, onChangeLayers } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const mm = 96 / 25.4;

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 30 * mm, clientY: 100 + 10 * mm });
    act(() => tick());
    expect(node.style.transform).not.toContain('378px');

    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true });
    act(() => tick());
    expect(node.style.transform).toContain('378px');

    fireEvent.keyUp(window, { key: 'Shift', shiftKey: false });
    act(() => tick());
    expect(node.style.transform).not.toContain('378px');

    fireEvent.keyDown(window, { key: 'Shift', shiftKey: true });
    fireEvent.pointerUp(window, { clientX: 100 + 30 * mm, clientY: 100 + 10 * mm });
    const moved = (onChangeLayers.mock.calls[0][0] as CanvasLayer[]).find((l) => l.id === layer.id)!;
    expect(moved.cssVars['--translate-y']).toBe('100mm');
  });

  it('treats a pointerdown + pointerup without travel as a click (no commit)', () => {
    const layer = createLayer('rect');
    const { container, onChangeLayers } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 });
    act(() => tick());

    expect(onChangeLayers).not.toHaveBeenCalled();
  });

  it('click without travel on a member of a multi-selection selects only that layer (Figma)', () => {
    const a = createLayer('rect');
    const b = createLayer('rect');
    const document = createEmptyDocument('Test');
    document.layers.push(a, b);
    const onSelect = vi.fn();
    const onChangeLayers = vi.fn();
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[a.id, b.id]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={onSelect}
        onSelectIds={() => {}}
        onChangeLayers={onChangeLayers}
      />,
    );
    const nodeA = container.querySelector<HTMLElement>(`[data-layer-id="${a.id}"]`)!;

    fireEvent.pointerDown(nodeA, { button: 0, clientX: 100, clientY: 100 });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 });

    expect(onSelect).toHaveBeenCalledWith(a.id, false);
    expect(onChangeLayers).not.toHaveBeenCalled();
  });

  it('pointercancel aborts move without committing (reverts DOM preview)', () => {
    const layer = createLayer('rect');
    const { container, onChangeLayers } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const origin = node.style.transform;
    const mm = 96 / 25.4;

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 30 * mm, clientY: 100 });
    act(() => tick());
    expect(node.style.transform).not.toBe(origin);

    act(() => {
      window.dispatchEvent(new PointerEvent('pointercancel'));
    });

    expect(onChangeLayers).not.toHaveBeenCalled();
    expect(node.style.transform).toBe(origin);
    expect(node.style.willChange).toBe('');
  });

  it('Escape aborts move without committing (Figma cancel)', () => {
    const layer = createLayer('rect');
    const { container, onChangeLayers } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const origin = node.style.transform;
    const mm = 96 / 25.4;

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 25 * mm, clientY: 100 });
    act(() => tick());
    expect(node.style.transform).not.toBe(origin);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onChangeLayers).not.toHaveBeenCalled();
    expect(node.style.transform).toBe(origin);

    act(() => {
      fireEvent.pointerUp(window, { clientX: 100 + 25 * mm, clientY: 100 });
    });
    expect(onChangeLayers).not.toHaveBeenCalled();
  });

  it('keeps shadow and filter while moving but defers them while resizing', () => {
    const layer = createLayer('rect', {
      cssVars: {
        ...createLayer('rect').cssVars,
        '--box-shadow': '0 10px 20px rgba(0,0,0,0.5)',
        '--filter-blur': '4px',
      },
    });
    const { container } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const mm = 96 / 25.4;
    expect(node.style.boxShadow).toContain('rgba');

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 20 * mm, clientY: 100 });
    act(() => tick());
    expect(node.style.boxShadow).toContain('rgba');
    expect(node.style.filter).toContain('blur');
    act(() => {
      fireEvent.pointerUp(window, { clientX: 100 + 20 * mm, clientY: 100 });
    });

    const se = screen.getByTestId('canvas-resize-handle-se');
    fireEvent.pointerDown(se, { button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(window, { clientX: 300 + 10 * mm, clientY: 300 + 10 * mm });
    act(() => tick());
    expect(node.style.boxShadow).toBe('');
    expect(node.style.filter).toBe('');
    act(() => {
      fireEvent.pointerUp(window, { clientX: 300 + 10 * mm, clientY: 300 + 10 * mm });
    });
  });

  it('passes stable gesture handlers to the selection chrome across re-renders', () => {
    const layer = createLayer('rect');
    const document = createEmptyDocument('Test');
    document.layers.push(layer);
    const selectedIds = [layer.id];
    const props = {
      document,
      selectedIds,
      zoom: 1,
      tool: 'select' as const,
      pan: { x: 0, y: 0 },
    };
    const { rerender } = render(
      <Artboard {...props} onPan={() => {}} onSelect={() => {}} onSelectIds={() => {}} onChangeLayers={() => {}} />,
    );
    const handle = () => screen.getByTestId('canvas-rotate-handle');
    const before = Object.keys(handle()).find((k) => k.startsWith('__reactProps'))!;
    const onRotateBefore = (handle() as unknown as Record<string, { onPointerDown: unknown }>)[before].onPointerDown;
    rerender(
      <Artboard {...props} onPan={() => {}} onSelect={() => {}} onSelectIds={() => {}} onChangeLayers={() => {}} />,
    );
    const onRotateAfter = (handle() as unknown as Record<string, { onPointerDown: unknown }>)[before].onPointerDown;
    expect(onRotateAfter).toBe(onRotateBefore);
  });

  it('Escape aborts resize without committing', () => {
    const layer = createLayer('rect');
    const { container, onChangeLayers } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const se = screen.getByTestId('canvas-resize-handle-se');
    const mm = 96 / 25.4;
    const baseW = parseFloat(node.style.width);

    fireEvent.pointerDown(se, { button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(window, { clientX: 300 + 20 * mm, clientY: 300 + 20 * mm });
    act(() => tick());
    expect(parseFloat(node.style.width)).toBeGreaterThan(baseW);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onChangeLayers).not.toHaveBeenCalled();
    expect(parseFloat(node.style.width)).toBeCloseTo(baseW, 0);
  });

  it('keeps selection ring on locked layers and hides resize handles', () => {
    const layer = createLayer('rect', { locked: true });
    const { container } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    expect(node.style.outline).toContain('var(--cv-accent)');
    expect(screen.queryByTestId('canvas-rotate-handle')).toBeNull();
    expect(screen.queryByTestId('canvas-selection-chrome')).toBeNull();
  });

  it('shows selection chrome + handles for editable selection', () => {
    const layer = createLayer('rect');
    setup([layer], [layer.id]);
    expect(screen.getByTestId('canvas-selection-chrome')).toBeTruthy();
    expect(screen.getByTestId('canvas-rotate-handle')).toBeTruthy();
  });

  it('shows four corner-radius handles on a single editable rect', () => {
    const layer = createLayer('rect');
    setup([layer], [layer.id]);
    expect(screen.getByTestId('canvas-radius-handle-tl')).toBeTruthy();
    expect(screen.getByTestId('canvas-radius-handle-tr')).toBeTruthy();
    expect(screen.getByTestId('canvas-radius-handle-br')).toBeTruthy();
    expect(screen.getByTestId('canvas-radius-handle-bl')).toBeTruthy();
  });

  it('hides radius handles on line layers', () => {
    const line = createLayer('line');
    setup([line], [line.id]);
    expect(screen.queryByTestId('canvas-radius-handle-tl')).toBeNull();
  });

  it('hides radius handles on clipped shapes', () => {
    const poly = createLayer('polygon');
    setup([poly], [poly.id]);
    expect(screen.queryByTestId('canvas-radius-handle-tl')).toBeNull();
  });

  it('hides radius handles for multi-select', () => {
    const a = createLayer('rect');
    const b = createLayer('rect');
    setup([a, b], [a.id, b.id]);
    expect(screen.queryByTestId('canvas-radius-handle-tl')).toBeNull();
  });

  it('drags a radius handle to update --border-radius uniformly', () => {
    const layer = createLayer('rect');
    const { onChangeLayers } = setup([layer], [layer.id]);
    const handle = screen.getByTestId('canvas-radius-handle-tl');

    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 140, clientY: 140 });
    act(() => tick());
    expect(screen.getByTestId('canvas-radius-badge').textContent).toMatch(/^Radius \d+$/);
    fireEvent.pointerUp(window, { clientX: 140, clientY: 140 });

    expect(onChangeLayers).toHaveBeenCalledTimes(1);
    const committed = onChangeLayers.mock.calls[0][0] as CanvasLayer[];
    const updated = committed.find((l) => l.id === layer.id)!;
    const r = parseFloat(updated.cssVars['--border-radius'] || '0');
    expect(r).toBeGreaterThan(0);
    expect(updated.cssVars['--radius-tl']).toBeUndefined();
  });

  it('corner resize still works when radius handles are visible', () => {
    const layer = createLayer('rect');
    const { onChangeLayers } = setup([layer], [layer.id]);
    expect(screen.getByTestId('canvas-radius-handle-tl')).toBeTruthy();
    const nw = screen.getByTestId('canvas-resize-handle-nw');

    fireEvent.pointerDown(nw, { button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(window, {
      clientX: 200 - 10 * (96 / 25.4),
      clientY: 200 - 10 * (96 / 25.4),
    });
    act(() => tick());
    fireEvent.pointerUp(window, {
      clientX: 200 - 10 * (96 / 25.4),
      clientY: 200 - 10 * (96 / 25.4),
    });

    expect(onChangeLayers).toHaveBeenCalledTimes(1);
    const committed = onChangeLayers.mock.calls[0][0] as CanvasLayer[];
    const resized = committed.find((l) => l.id === layer.id)!;
    expect(parseFloat(resized.cssVars['--width'])).toBeGreaterThan(50);
    expect(parseFloat(resized.cssVars['--height'])).toBeGreaterThan(40);
  });

  it('resizes from any point of a selection edge and from the enlarged corner hit area (Figma)', () => {
    const layer = createLayer('rect');
    const { onChangeLayers } = setup([layer], [layer.id]);
    const mm = 96 / 25.4;

    const east = screen.getByTestId('canvas-resize-edge-e');
    expect(east.style.cursor).toBe('ew-resize');
    fireEvent.pointerDown(east, { button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(window, { clientX: 300 + 10 * mm, clientY: 300 + 10 * mm });
    act(() => tick());
    act(() => {
      fireEvent.pointerUp(window, { clientX: 300 + 10 * mm, clientY: 300 + 10 * mm });
    });
    const widened = (onChangeLayers.mock.calls[0][0] as CanvasLayer[]).find((l) => l.id === layer.id)!;
    expect(widened.cssVars['--width']).toBe('60mm');
    expect(widened.cssVars['--height']).toBe(layer.cssVars['--height']);

    const corner = screen.getByTestId('canvas-resize-hit-se');
    fireEvent.pointerDown(corner, { button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(window, { clientX: 300 + 10 * mm, clientY: 300 + 10 * mm });
    act(() => tick());
    act(() => {
      fireEvent.pointerUp(window, { clientX: 300 + 10 * mm, clientY: 300 + 10 * mm });
    });
    const grown = (onChangeLayers.mock.calls[1][0] as CanvasLayer[]).find((l) => l.id === layer.id)!;
    expect(parseFloat(grown.cssVars['--height'])).toBeGreaterThan(parseFloat(layer.cssVars['--height']));
  });

  it('coalesces resize to DOM geometry mid-gesture and commits once on pointerup', () => {
    const layer = createLayer('rect');
    const { container, onChangeLayers } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const se = screen.getByTestId('canvas-resize-handle-se');
    const mm = 96 / 25.4;
    const baseW = parseFloat(node.style.width);
    const baseH = parseFloat(node.style.height);

    fireEvent.pointerDown(se, { button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(window, { clientX: 300 + 10 * mm, clientY: 300 + 10 * mm });
    fireEvent.pointerMove(window, { clientX: 300 + 20 * mm, clientY: 300 + 20 * mm });
    expect(onChangeLayers).not.toHaveBeenCalled();
    expect(parseFloat(node.style.width)).toBe(baseW);

    act(() => tick());
    expect(onChangeLayers).not.toHaveBeenCalled();
    expect(parseFloat(node.style.width)).toBeGreaterThan(baseW);
    expect(parseFloat(node.style.height)).toBeGreaterThan(baseH);
    expect(node.style.willChange).toBe('transform');

    fireEvent.pointerUp(window, { clientX: 300 + 20 * mm, clientY: 300 + 20 * mm });
    expect(onChangeLayers).toHaveBeenCalledTimes(1);
    const committed = onChangeLayers.mock.calls[0][0] as CanvasLayer[];
    const resized = committed.find((l) => l.id === layer.id)!;
    expect(parseFloat(resized.cssVars['--width'])).toBeGreaterThan(50);
    expect(parseFloat(resized.cssVars['--height'])).toBeGreaterThan(40);
  });

  it('coalesces rotate to DOM transform mid-gesture and commits once on pointerup', () => {
    const layer = createLayer('rect');
    const { container, onChangeLayers } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    const handle = screen.getByTestId('canvas-rotate-handle');

    fireEvent.pointerDown(handle, { button: 0, clientX: 400, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 450, clientY: 120 });
    fireEvent.pointerMove(window, { clientX: 500, clientY: 150 });
    expect(onChangeLayers).not.toHaveBeenCalled();

    act(() => tick());
    expect(onChangeLayers).not.toHaveBeenCalled();
    expect(node.style.transform).toMatch(/rotate\(/);
    expect(node.style.willChange).toBe('transform');

    fireEvent.pointerUp(window, { clientX: 500, clientY: 150 });
    expect(onChangeLayers).toHaveBeenCalledTimes(1);
    const committed = onChangeLayers.mock.calls[0][0] as CanvasLayer[];
    const rotated = committed.find((l) => l.id === layer.id)!;
    expect(rotated.cssVars['--rotate']).toBeTruthy();
    expect(rotated.cssVars['--rotate']).not.toBe('0deg');
  });

  it('pans with translate3d (not left/top layout)', () => {
    const layer = createLayer('rect');
    const document = createEmptyDocument('Test');
    document.layers.push(layer);
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[]}
        zoom={1}
        tool="select"
        pan={{ x: 40, y: -20 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
      />,
    );
    const panLayer = container.querySelector<HTMLElement>('[data-testid="canvas-pan-layer"]')!;
    expect(panLayer.style.transform).toContain('translate3d');
    expect(panLayer.style.transform).toContain('40px');
    expect(panLayer.style.transform).toContain('-20px');
    expect(panLayer.style.left).toBe('50%');
    expect(panLayer.style.top).toBe('50%');
  });

  it('preserves fractional pan coordinates for high-resolution trackpads', () => {
    const document = createEmptyDocument('Test');
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[]}
        zoom={1}
        tool="select"
        pan={{ x: 0.25, y: -0.75 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
      />,
    );
    const panLayer = container.querySelector<HTMLElement>('[data-testid="canvas-pan-layer"]')!;
    expect(panLayer.style.transform).toContain('0.25px');
    expect(panLayer.style.transform).toContain('-0.75px');
  });

  it('captures and releases the pointer used for hand-tool panning', () => {
    const document = createEmptyDocument('Test');
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[]}
        zoom={1}
        tool="hand"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
      />,
    );
    const viewport = container.querySelector<HTMLElement>('[data-testid="canvas-viewport"]')!;
    viewport.setPointerCapture = vi.fn();
    viewport.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(viewport, { pointerId: 7, button: 0, clientX: 100, clientY: 100 });
    expect(viewport.setPointerCapture).toHaveBeenCalledWith(7);

    fireEvent.pointerUp(window, { pointerId: 7, clientX: 120, clientY: 120 });
    expect(viewport.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('does not start inertia from stale velocity after the pointer pauses', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    try {
      const document = createEmptyDocument('Test');
      const onStartInertia = vi.fn();
      const { container } = render(
        <Artboard
          document={document}
          selectedIds={[]}
          zoom={1}
          tool="hand"
          pan={{ x: 0, y: 0 }}
          onPan={() => {}}
          onSelect={() => {}}
          onSelectIds={() => {}}
          onChangeLayers={() => {}}
          onStartInertia={onStartInertia}
        />,
      );
      const viewport = container.querySelector<HTMLElement>('[data-testid="canvas-viewport"]')!;

      fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
      now.mockReturnValue(16);
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 160, clientY: 100 });
      act(() => tick());
      now.mockReturnValue(1000);
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 160, clientY: 100 });

      expect(onStartInertia).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('renders a stationary zoomed artboard at native resolution', () => {
    const layer = createLayer('rect');
    const document = createEmptyDocument('Test');
    document.layers.push(layer);
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[]}
        zoom={5.97}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
      />,
    );
    const artboard = container.querySelector<HTMLElement>('[data-testid="canvas-artboard"]')!;
    expect(artboard.style.zoom).toBe('5.97');
    expect(artboard.style.position).toBe('absolute');
    expect(artboard.style.left).toBe('50%');
    expect(artboard.style.top).toBe('50%');
    expect(artboard.style.transform).toBe('translate(-50%, -50%)');
    expect(artboard.style.willChange).toBe('');
  });

  it('uses the compositor during camera motion and restores native zoom after settling', () => {
    vi.useFakeTimers();
    try {
      let notify!: (zoom: number, pan: { x: number; y: number }) => void;
      let currentZoom = 1;
      const onContextMenu = vi.fn();
      const onZoom = vi.fn();
      const camera = {
        subscribe: (listener: typeof notify) => { notify = listener; return () => {}; },
        getZoom: () => currentZoom,
        getPan: () => ({ x: 0, y: 0 }),
      };
      const { container } = render(
        <Artboard
          document={createEmptyDocument('Test')}
          selectedIds={[]}
          zoom={1}
          tool="select"
          pan={{ x: 0, y: 0 }}
          camera={camera}
          onPan={() => {}}
          onSelect={() => {}}
          onSelectIds={() => {}}
          onChangeLayers={() => {}}
          onContextMenu={onContextMenu}
          onZoom={onZoom}
        />,
      );
      const artboard = container.querySelector<HTMLElement>('[data-testid="canvas-artboard"]')!;

      act(() => { currentZoom = 5.97; notify(5.97, { x: 0, y: 0 }); });
      expect(artboard.style.zoom).toBe('1');
      expect(artboard.style.transform).toBe('scale(5.97)');
      expect(artboard.style.willChange).toBe('transform');

      act(() => vi.advanceTimersByTime(140));
      expect(artboard.style.zoom).toBe('5.97');
      expect(artboard.style.transform).toBe('translate(-50%, -50%)');
      expect(artboard.style.willChange).toBe('');

      const clientX = 20 * (96 / 25.4) * 5.97;
      fireEvent.contextMenu(screen.getByTestId('canvas-viewport'), { clientX, clientY: 0 });
      expect(onContextMenu).toHaveBeenCalledWith(null, clientX, 0, { x: 20, y: 0 });

      vi.useRealTimers();
      fireEvent.pointerDown(artboard, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 0, clientY: 0 });
      fireEvent.pointerDown(artboard, { pointerId: 2, pointerType: 'touch', button: 0, clientX: 100, clientY: 0 });
      fireEvent.pointerMove(artboard, { pointerId: 2, pointerType: 'touch', clientX: 50, clientY: 0 });
      act(() => tick());
      expect(onZoom).toHaveBeenCalledWith(2.985);
    } finally {
      vi.useRealTimers();
    }
  });

  it('point-click on artboard selects top-most layer under cursor', () => {
    const bottom = createLayer('rect', {
      id: 'bottom',
      cssVars: {
        '--translate-x': '10mm',
        '--translate-y': '10mm',
        '--width': '40mm',
        '--height': '40mm',
      },
    });
    const top = createLayer('rect', {
      id: 'top',
      cssVars: {
        '--translate-x': '15mm',
        '--translate-y': '15mm',
        '--width': '40mm',
        '--height': '40mm',
      },
    });
    const document = createEmptyDocument('Test');
    document.layers.push(bottom, top);
    const onSelect = vi.fn();
    const onSelectIds = vi.fn();
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={onSelect}
        onSelectIds={onSelectIds}
        onChangeLayers={() => {}}
      />,
    );
    const artboard = container.querySelector('[data-testid="canvas-artboard"]')!;
    const mmPx = 96 / 25.4;
    vi.spyOn(artboard, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 210 * mmPx,
      bottom: 297 * mmPx,
      width: 210 * mmPx,
      height: 297 * mmPx,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    });
    fireEvent.pointerDown(artboard, { button: 0, clientX: 20 * mmPx, clientY: 20 * mmPx });
    fireEvent.pointerUp(window, { button: 0, clientX: 20 * mmPx, clientY: 20 * mmPx });
    expect(onSelect).toHaveBeenCalledWith('top');
  });

  it('coalesces wheel pan/zoom to one camera update per animation frame', () => {
    const layer = createLayer('rect');
    const document = createEmptyDocument('Test');
    document.layers.push(layer);
    const onPan = vi.fn();
    const onZoom = vi.fn();
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[]}
        zoom={1}
        tool="hand"
        pan={{ x: 0, y: 0 }}
        onPan={onPan}
        onZoom={onZoom}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
      />,
    );
    const viewport = container.querySelector('[data-testid="canvas-viewport"]')!;
    fireEvent.wheel(viewport, { deltaY: 40, deltaX: 0 });
    fireEvent.wheel(viewport, { deltaY: 40, deltaX: 0 });
    fireEvent.wheel(viewport, { deltaY: 40, deltaX: 0 });
    expect(onPan).not.toHaveBeenCalled();
    act(() => tick());
    expect(onPan).toHaveBeenCalledTimes(1);
  });
});
