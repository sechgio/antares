import { act, fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import Artboard from '../editor/Artboard';
import { createEmptyDocument } from '../types';

const { layerNodeRenders } = vi.hoisted(() => ({ layerNodeRenders: vi.fn() }));

vi.mock('../editor/LayerNode', async (importOriginal) => {
  const { createElement } = await import('react');
  const actual = await importOriginal<typeof import('../editor/LayerNode')>();
  const Actual = actual.default;
  const CountedLayerNode = (props: ComponentProps<typeof Actual>) => {
    layerNodeRenders();
    return createElement(Actual, props);
  };
  return { ...actual, default: CountedLayerNode };
});

describe('Artboard layer list during a move gesture', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextId: number;

  beforeEach(() => {
    frames = new Map();
    nextId = 1;
    layerNodeRenders.mockClear();
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

  it('does not re-render the layer nodes on gesture overlay frames', () => {
    const document = createEmptyDocument('Layer list');
    const moving = createLayer('rect', {
      cssVars: { '--translate-x': '20mm', '--translate-y': '20mm', '--width': '10mm', '--height': '10mm' },
    });
    document.layers.push(moving);
    for (let i = 0; i < 30; i++) {
      document.layers.push(
        createLayer('rect', {
          cssVars: {
            '--translate-x': `${(i % 10) * 12}mm`,
            '--translate-y': `${150 + Math.floor(i / 10) * 12}mm`,
            '--width': '8mm',
            '--height': '8mm',
          },
        }),
      );
    }
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[moving.id]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
      />,
    );
    const node = container.querySelector<HTMLElement>(`[data-layer-id="${moving.id}"]`)!;
    const mm = 96 / 25.4;

    fireEvent.pointerDown(node, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 2 * mm, clientY: 100 });
    act(() => tick());
    layerNodeRenders.mockClear();

    for (let frame = 2; frame <= 6; frame++) {
      fireEvent.pointerMove(window, { clientX: 100 + frame * 2 * mm, clientY: 100 });
      act(() => tick());
    }
    expect(layerNodeRenders).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { clientX: 100 + 12 * mm, clientY: 100 });
  });

  it('uses the latest context menu callback without re-rendering the layer list', () => {
    const document = createEmptyDocument('Callbacks');
    const layer = createLayer('rect');
    document.layers.push(layer);
    const props = {
      document,
      selectedIds: [],
      zoom: 1,
      tool: 'select' as const,
      pan: { x: 0, y: 0 },
      onPan: vi.fn(),
      onSelect: vi.fn(),
      onSelectIds: vi.fn(),
      onChangeLayers: vi.fn(),
    };
    const first = vi.fn();
    const latest = vi.fn();
    const { container, rerender } = render(<Artboard {...props} onContextMenu={first} />);
    layerNodeRenders.mockClear();
    rerender(<Artboard {...props} onContextMenu={latest} />);
    fireEvent.contextMenu(container.querySelector(`[data-layer-id="${layer.id}"]`)!, {
      clientX: 100,
      clientY: 100,
    });
    expect(latest).toHaveBeenCalledWith(layer.id, 100, 100, expect.any(Object));
    expect(first).not.toHaveBeenCalled();
    expect(layerNodeRenders).not.toHaveBeenCalled();
  });

  it('Alt+drag moves the duplicated copy through the DOM after its first frame', () => {
    const document = createEmptyDocument('Alt copy');
    const original = createLayer('rect', {
      cssVars: { '--translate-x': '20mm', '--translate-y': '20mm', '--width': '10mm', '--height': '10mm' },
    });
    document.layers.push(original);
    const { container } = render(
      <Artboard
        document={document}
        selectedIds={[original.id]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
      />,
    );
    const originalNode = container.querySelector<HTMLElement>(`[data-layer-id="${original.id}"]`)!;
    const mm = 96 / 25.4;

    fireEvent.pointerDown(originalNode, { button: 0, clientX: 100, clientY: 100, altKey: true });
    fireEvent.pointerMove(window, { clientX: 100 + 2 * mm, clientY: 100 });
    act(() => tick());
    const copyNode = [...container.querySelectorAll<HTMLElement>('[data-layer-id]')].find(
      (el) => el.dataset.layerId !== original.id,
    )!;
    const originalAfterCreate = originalNode.style.transform;

    fireEvent.pointerMove(window, { clientX: 100 + 10 * mm, clientY: 100 });
    act(() => tick());
    const copyAfterFirstMove = copyNode.style.transform;
    fireEvent.pointerMove(window, { clientX: 100 + 20 * mm, clientY: 100 });
    act(() => tick());

    expect(copyNode.style.transform).not.toBe(copyAfterFirstMove);
    expect(originalNode.style.transform).toBe(originalAfterCreate);
    fireEvent.pointerUp(window, { clientX: 100 + 20 * mm, clientY: 100 });
  });
});
