import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import Artboard, { createFrameRectCache } from '../editor/Artboard';
import { createEmptyDocument, type CanvasLayer } from '../types';

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
    expect(cache.read()).toBe(rects[0]); // cached
    zoomRef.current = 2;
    expect(cache.read()).toBe(rects[1]);
  });
});

/**
 * Drag gestures are coalesced to one state update per animation frame
 * (Figma-style): pointermove alone must not render, and the final
 * document is committed exactly once on pointerup.
 */
describe('Artboard drag gestures', () => {
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
    const layer = createLayer('rect'); // 50mm × 40mm
    setup([layer], [layer.id]);
    expect(screen.getByTestId('canvas-size-badge').textContent).toBe('50 × 40');
  });

  it('coalesces pointermove to one preview per frame and commits once on pointerup', () => {
    const layer = createLayer('rect'); // x=20mm, y=100mm → translate(76px, 378px) at zoom 1
    const { container, onChangeLayers } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;
    expect(node.style.transform).toBe('translate(76px, 378px)');

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
    // Two moves within the same frame — only the latest may apply.
    fireEvent.pointerMove(window, { clientX: 100 + 10 * (96 / 25.4), clientY: 100 }); // +10mm
    fireEvent.pointerMove(window, { clientX: 100 + 20 * (96 / 25.4), clientY: 100 }); // +20mm

    // Nothing rendered yet: updates wait for the animation frame.
    expect(node.style.transform).toBe('translate(76px, 378px)');
    expect(onChangeLayers).not.toHaveBeenCalled();

    act(() => tick());
    expect(node.style.transform).toBe('translate(151px, 378px)'); // 40mm
    expect(node.style.willChange).toBe('transform');
    expect(onChangeLayers).not.toHaveBeenCalled();

    // One more move, released before the next frame: flush applies it.
    fireEvent.pointerMove(window, { clientX: 100 + 40 * (96 / 25.4), clientY: 100 }); // +40mm
    fireEvent.pointerUp(window, { clientX: 100 + 40 * (96 / 25.4), clientY: 100 });

    expect(onChangeLayers).toHaveBeenCalledTimes(1);
    const committed = onChangeLayers.mock.calls[0][0] as CanvasLayer[];
    const moved = committed.find((l) => l.id === layer.id)!;
    expect(moved.cssVars['--translate-x']).toBe('60mm');
    expect(moved.cssVars['--translate-y']).toBe('100mm');
  });

  it('moves every selected layer together in one commit', () => {
    const a = createLayer('rect');
    const b = createLayer('rect');
    const { container, onChangeLayers } = setup([a, b], [a.id, b.id]);
    const nodeA = container.querySelector<HTMLElement>(`[data-layer-id="${a.id}"]`)!;

    fireEvent.pointerDown(nodeA, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 20 * (96 / 25.4), clientY: 100 }); // +20mm
    act(() => tick());
    fireEvent.pointerUp(window, { clientX: 100 + 20 * (96 / 25.4), clientY: 100 });

    expect(onChangeLayers).toHaveBeenCalledTimes(1);
    const committed = onChangeLayers.mock.calls[0][0] as CanvasLayer[];
    expect(committed.find((l) => l.id === a.id)!.cssVars['--translate-x']).toBe('40mm');
    expect(committed.find((l) => l.id === b.id)!.cssVars['--translate-x']).toBe('40mm');
  });

  it('Alt+drag duplicates then moves the copy in one commit (Figma)', () => {
    const layer = createLayer('rect'); // 20mm, 100mm
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
    // Original stays put; the duplicate receives the drag delta.
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
    const layer = createLayer('rect'); // 20mm, 100mm
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
    // Shift held: previously aborted the move (treated as multi-select only).
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
    expect(moved.cssVars['--translate-x']).toBe('50mm'); // 20 + 30 (dominant axis)
    expect(moved.cssVars['--translate-y']).toBe('100mm'); // locked
    expect(onSelectIds).not.toHaveBeenCalled();
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

  it('pointercancel aborts move without committing (reverts DOM preview)', () => {
    const layer = createLayer('rect'); // 20mm, 100mm → translate(76px, 378px)
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

  it('Escape aborts resize without committing', () => {
    const layer = createLayer('rect'); // 50×40 mm
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
    // Toward center (+x, +y) increases TL radius.
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
    const layer = createLayer('rect'); // 50×40 mm
    const { onChangeLayers } = setup([layer], [layer.id]);
    expect(screen.getByTestId('canvas-radius-handle-tl')).toBeTruthy();
    const nw = screen.getByTestId('canvas-resize-handle-nw');

    fireEvent.pointerDown(nw, { button: 0, clientX: 200, clientY: 200 });
    // Drag NW outward (−x, −y) → larger box.
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
    // Width/height grow; radius must not be the only change.
    expect(parseFloat(resized.cssVars['--width'])).toBeGreaterThan(50);
    expect(parseFloat(resized.cssVars['--height'])).toBeGreaterThan(40);
  });

  it('coalesces resize to DOM geometry mid-gesture and commits once on pointerup', () => {
    const layer = createLayer('rect'); // 50×40 mm
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

  it('zooms with a compositor transform, not CSS zoom (pinch/zoom jank)', () => {
    const layer = createLayer('rect');
    const document = createEmptyDocument('Test');
    document.layers.push(layer);
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[]}
        zoom={1.5}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
      />,
    );
    const artboard = container.querySelector<HTMLElement>('[data-testid="canvas-artboard"]')!;
    // CSS `zoom` re-rasterizes the whole artboard on every zoom frame (measured
    // pinch jank that scales with painted layers). The camera must stay on the
    // compositor: scale + will-change, never the `zoom` property.
    expect(artboard.style.zoom).toBe('');
    expect(artboard.style.transform).toContain('scale(1.5)');
    expect(artboard.style.transformOrigin).toBe('top left');
    expect(artboard.style.willChange).toBe('transform');
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
    // Mock frame rect so clientToMm maps 1:1 with mm→px at zoom 1.
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
    // Click at 20mm,20mm — inside both; top should win.
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
