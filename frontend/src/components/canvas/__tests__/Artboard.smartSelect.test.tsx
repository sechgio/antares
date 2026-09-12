import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import Artboard from '../editor/Artboard';
import { createEmptyDocument, parseMm, type CanvasLayer } from '../types';

function rectAt(id: string, xMm: number, yMm: number, w = 10, h = 10): CanvasLayer {
  return createLayer('rect', {
    id,
    cssVars: {
      ...createLayer('rect').cssVars,
      '--translate-x': `${xMm}mm`,
      '--translate-y': `${yMm}mm`,
      '--width': `${w}mm`,
      '--height': `${h}mm`,
    },
  });
}

describe('Artboard smart-selection handles', () => {
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

  it('renders a gap handle per gap for a selected row', () => {
    const a = rectAt('a', 10, 10);
    const b = rectAt('b', 30, 10);
    const c = rectAt('c', 50, 10);
    setup([a, b, c], ['a', 'b', 'c']);
    expect(screen.getByTestId('canvas-gap-handle-0')).toBeTruthy();
    expect(screen.getByTestId('canvas-gap-handle-1')).toBeTruthy();
  });

  it('hides handles for scattered selections', () => {
    const a = rectAt('a', 10, 10);
    const b = rectAt('b', 50, 60);
    setup([a, b], ['a', 'b']);
    expect(screen.queryByTestId('canvas-gap-handle-0')).toBeNull();
  });

  it('shows the tidy handle only when gaps are uneven', () => {
    const a = rectAt('a', 10, 10);
    const b = rectAt('b', 25, 10);
    const c = rectAt('c', 60, 10);
    setup([a, b, c], ['a', 'b', 'c']);
    expect(screen.getByTestId('canvas-tidy-handle')).toBeTruthy();
  });

  it('hides the tidy handle for a uniform row', () => {
    const a = rectAt('a', 10, 10);
    const b = rectAt('b', 30, 10);
    const c = rectAt('c', 50, 10);
    setup([a, b, c], ['a', 'b', 'c']);
    expect(screen.queryByTestId('canvas-tidy-handle')).toBeNull();
  });

  it('dragging a gap handle moves only the following layers, committed once', () => {
    const a = rectAt('a', 10, 10);
    const b = rectAt('b', 30, 10);
    const c = rectAt('c', 50, 10);
    const { onChangeLayers } = setup([a, b, c], ['a', 'b', 'c']);
    const handle = screen.getByTestId('canvas-gap-handle-0');
    const mm = 96 / 25.4;

    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100 + 5 * mm, clientY: 100 });
    act(() => tick());
    fireEvent.pointerUp(window, { clientX: 100 + 5 * mm, clientY: 100 });

    expect(onChangeLayers).toHaveBeenCalledTimes(1);
    const committed = onChangeLayers.mock.calls[0][0] as CanvasLayer[];
    const x = (l: CanvasLayer) => parseMm(l.cssVars['--translate-x']);
    expect(x(committed.find((l) => l.id === 'a')!)).toBe(10);
    expect(x(committed.find((l) => l.id === 'b')!)).toBe(35);
    expect(x(committed.find((l) => l.id === 'c')!)).toBe(55);
  });

  it('clicking the tidy handle equalizes gaps in one commit', () => {
    const a = rectAt('a', 10, 10);
    const b = rectAt('b', 25, 10);
    const c = rectAt('c', 60, 10);
    const { onChangeLayers } = setup([a, b, c], ['a', 'b', 'c']);

    fireEvent.pointerDown(screen.getByTestId('canvas-tidy-handle'), { button: 0 });
    fireEvent.pointerUp(window, { button: 0 });

    expect(onChangeLayers).toHaveBeenCalledTimes(1);
    const committed = onChangeLayers.mock.calls[0][0] as CanvasLayer[];
    const x = (l: CanvasLayer) => parseMm(l.cssVars['--translate-x']);
    expect(x(committed.find((l) => l.id === 'a')!)).toBe(10);
    expect(x(committed.find((l) => l.id === 'b')!)).toBe(35);
    expect(x(committed.find((l) => l.id === 'c')!)).toBe(60);
  });
});
