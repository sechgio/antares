import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import Artboard from '../editor/Artboard';
import { createEmptyDocument, type CanvasLayer } from '../types';

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

  it('treats a pointerdown + pointerup without travel as a click (no commit)', () => {
    const layer = createLayer('rect');
    const { container, onChangeLayers } = setup([layer], [layer.id]);
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${layer.id}"]`)!;

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 });
    act(() => tick());

    expect(onChangeLayers).not.toHaveBeenCalled();
  });
});
