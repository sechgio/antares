import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Artboard from '../editor/Artboard';
import { MM_TO_PX } from '../ops/drawHelpers';
import { createGuide } from '../ops/guides';
import { A4_HEIGHT_PX, A4_WIDTH_PX, createEmptyDocument, DEFAULT_PAGE_MARGIN_MM, type CanvasDocument } from '../types';
import { createLayer } from '../constants';

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

  const setup = (onNudgeGuide?: (id: string, deltaMm: number) => void) => {
    const document = createEmptyDocument('Test');
    const guide = createGuide('x', 50, 0);
    document.guides = [guide];
    document.layers.push(
      createLayer('rect', {
        pageIndex: 0,
        cssVars: {
          '--translate-x': '80mm',
          '--translate-y': '40mm',
          '--width': '20mm',
          '--height': '10mm',
        },
      }),
    );
    const onMoveGuide = vi.fn();
    const onRemoveGuide = vi.fn();
    const onCommitGuideCreate = vi.fn();
    const onSelectIds = vi.fn();
    render(
      <Artboard
        document={document}
        selectedIds={[]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={onSelectIds}
        onChangeLayers={() => {}}
        onCommitGuideCreate={onCommitGuideCreate}
        onMoveGuide={onMoveGuide}
        onNudgeGuide={onNudgeGuide}
        onRemoveGuide={onRemoveGuide}
      />,
    );
    return { guide, onCommitGuideCreate, onMoveGuide, onRemoveGuide, onSelectIds };
  };

  it('drags a guide with live preview and commits once on release', () => {
    const { guide, onMoveGuide, onRemoveGuide } = setup();
    fireEvent.pointerDown(screen.getByTestId('canvas-manual-guide'), { button: 0, clientX: 189, clientY: 300 });

    act(() => {
      fireEvent.pointerMove(window, { clientX: 265, clientY: 300 });
      tick();
    });
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
    expect(atHalf.style.width).toBe('20px');
  });

  it('snaps a dragged guide to object edges and centers', () => {
    const { onMoveGuide } = setup();
    fireEvent.pointerDown(screen.getByTestId('canvas-manual-guide'), {
      button: 0,
      clientX: 50 * MM_TO_PX,
      clientY: 300,
    });

    act(() => {
      fireEvent.pointerMove(window, { clientX: 79.4 * MM_TO_PX, clientY: 300 });
      tick();
      fireEvent.pointerUp(window, { clientX: 79.4 * MM_TO_PX, clientY: 300 });
    });

    expect(onMoveGuide).toHaveBeenCalledWith(expect.any(String), 80);
  });

  it('temporarily disables guide snapping while Control is held', () => {
    const { onMoveGuide } = setup();
    fireEvent.pointerDown(screen.getByTestId('canvas-manual-guide'), {
      button: 0,
      clientX: 50 * MM_TO_PX,
      clientY: 300,
    });

    act(() => {
      fireEvent.pointerMove(window, {
        clientX: 79.4 * MM_TO_PX,
        clientY: 300,
        ctrlKey: true,
      });
      tick();
      fireEvent.pointerUp(window, {
        clientX: 79.4 * MM_TO_PX,
        clientY: 300,
        ctrlKey: true,
      });
    });

    expect(onMoveGuide.mock.calls[0][1]).toBeCloseTo(79.4, 1);
  });

  it('duplicates a guide with Alt-drag and leaves the source in place', () => {
    const { guide, onCommitGuideCreate, onMoveGuide } = setup();
    fireEvent.pointerDown(screen.getByTestId('canvas-manual-guide'), {
      button: 0,
      clientX: 50 * MM_TO_PX,
      clientY: 300,
      altKey: true,
    });

    act(() => {
      fireEvent.pointerMove(window, { clientX: 110 * MM_TO_PX, clientY: 300, altKey: true });
      tick();
    });
    const guides = screen.getAllByTestId('canvas-manual-guide');
    expect(guides).toHaveLength(2);
    expect(guides[1]).toHaveAttribute('data-selected', 'true');
    expect(screen.queryAllByTestId('canvas-distance-label').length).toBeGreaterThan(0);

    act(() => {
      fireEvent.pointerUp(window, { clientX: 110 * MM_TO_PX, clientY: 300, altKey: true });
    });
    expect(onMoveGuide).not.toHaveBeenCalled();
    expect(onCommitGuideCreate).toHaveBeenCalledTimes(1);
    expect(onCommitGuideCreate.mock.calls[0][0]).toMatchObject({ axis: 'x', posMm: 110, pageIndex: 0 });
    expect(onCommitGuideCreate.mock.calls[0][0].id).not.toBe(guide.id);
  });

  it('selects a guide and removes it with Delete', () => {
    const { guide, onRemoveGuide, onSelectIds } = setup();
    const manualGuide = screen.getByTestId('canvas-manual-guide');
    fireEvent.pointerDown(manualGuide, { button: 0, clientX: 50 * MM_TO_PX, clientY: 300 });
    fireEvent.pointerUp(window, { clientX: 50 * MM_TO_PX, clientY: 300 });

    expect(manualGuide).toHaveAttribute('data-selected', 'true');
    expect(onSelectIds).toHaveBeenCalledWith([]);
    fireEvent.keyDown(manualGuide, { key: 'Delete' });
    expect(onRemoveGuide).toHaveBeenCalledWith(guide.id);
  });

  it('nudges a selected guide on its axis with precision modifiers', () => {
    const { guide, onMoveGuide } = setup();
    const manualGuide = screen.getByTestId('canvas-manual-guide');

    fireEvent.keyDown(manualGuide, { key: 'ArrowRight', shiftKey: true });
    expect(onMoveGuide).toHaveBeenLastCalledWith(guide.id, 60);

    fireEvent.keyDown(manualGuide, { key: 'ArrowLeft', altKey: true });
    expect(onMoveGuide).toHaveBeenLastCalledWith(guide.id, 49.9);

    onMoveGuide.mockClear();
    fireEvent.keyDown(manualGuide, { key: 'ArrowDown' });
    expect(onMoveGuide).not.toHaveBeenCalled();
  });

  it('delegates repeated keyboard nudges as deltas for history coalescing', () => {
    const onNudgeGuide = vi.fn();
    const { guide, onMoveGuide } = setup(onNudgeGuide);
    const manualGuide = screen.getByTestId('canvas-manual-guide');

    fireEvent.keyDown(manualGuide, { key: 'ArrowRight' });
    fireEvent.keyDown(manualGuide, { key: 'ArrowRight', shiftKey: true });

    expect(onNudgeGuide).toHaveBeenNthCalledWith(1, guide.id, 1);
    expect(onNudgeGuide).toHaveBeenNthCalledWith(2, guide.id, 10);
    expect(onMoveGuide).not.toHaveBeenCalled();
  });

  it('offers guide removal from its context menu', () => {
    const { guide, onRemoveGuide } = setup();
    fireEvent.contextMenu(screen.getByTestId('canvas-manual-guide'), { clientX: 320, clientY: 240 });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Eliminar guía' }));
    expect(onRemoveGuide).toHaveBeenCalledWith(guide.id);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not render rulers by default', () => {
    setup();
    expect(screen.queryByTestId('canvas-ruler-top')).toBeNull();
    expect(screen.queryByTestId('canvas-ruler-left')).toBeNull();
  });

  it('renders rulers when showRulers is true', () => {
    const document = createEmptyDocument('Rulers test');
    render(
      <Artboard
        document={document}
        selectedIds={[]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        showRulers={true}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
      />,
    );
    expect(screen.getByTestId('canvas-ruler-top')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-ruler-left')).toBeInTheDocument();
  });
});

describe('Artboard page label', () => {
  it('follows the zoomed page without scaling the label text', () => {
    const document = createEmptyDocument('Label');
    const { rerender } = render(
      <Artboard
        document={document}
        selectedIds={[]}
        zoom={8}
        tool="select"
        pan={{ x: 0, y: 0 }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
      />,
    );
    const label = screen.getByText(/Página A4 — 210 × 297 mm/);
    expect(label.parentElement).toBe(screen.getByTestId('canvas-pan-layer'));
    expect(label.style.fontSize).toBe('11px');
    expect(label.style.left).toBe(`${(A4_WIDTH_PX * (1 - 8)) / 2}px`);
    expect(label.style.top).toBe(`${(A4_HEIGHT_PX * (1 - 8)) / 2 - 22}px`);

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
    expect(label.style.left).toBe(`${(A4_WIDTH_PX * (1 - 0.5)) / 2}px`);
    expect(label.style.top).toBe(`${(A4_HEIGHT_PX * (1 - 0.5)) / 2 - 22}px`);
  });

  it('tracks camera animation frames before React receives the final zoom', () => {
    let emitZoom: ((zoom: number, pan: { x: number; y: number }) => void) | undefined;
    render(
      <Artboard
        document={createEmptyDocument('Label')}
        selectedIds={[]}
        zoom={1}
        tool="select"
        pan={{ x: 0, y: 0 }}
        camera={{
          subscribe: (listener) => { emitZoom = listener; return () => {}; },
          getZoom: () => 1,
          getPan: () => ({ x: 0, y: 0 }),
        }}
        onPan={() => {}}
        onSelect={() => {}}
        onSelectIds={() => {}}
        onChangeLayers={() => {}}
      />,
    );
    const label = screen.getByText(/Página A4 — 210 × 297 mm/);
    act(() => emitZoom?.(8, { x: 0, y: 0 }));
    expect(label.style.left).toBe(`${(A4_WIDTH_PX * (1 - 8)) / 2}px`);
    expect(label.style.top).toBe(`${(A4_HEIGHT_PX * (1 - 8)) / 2 - 22}px`);
  });
});

describe('Artboard page margin overlay', () => {
  const renderWithSettings = (settings?: CanvasDocument['settings']) => {
    const document = createEmptyDocument('Margen de página');
    if (settings) document.settings = settings;
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
      />,
    );
  };

  it('insets the margin guide by the configured millimetres', () => {
    renderWithSettings({ pageMarginMm: 15 });
    const overlay = screen.getByTestId('canvas-page-margin') as HTMLElement;
    expect(overlay.style.left).toBe('15mm');
    expect(overlay.style.top).toBe('15mm');
    expect(overlay.style.right).toBe('15mm');
    expect(overlay.style.bottom).toBe('15mm');
  });

  it('falls back to the default margin when the document has none', () => {
    renderWithSettings();
    expect((screen.getByTestId('canvas-page-margin') as HTMLElement).style.left).toBe(
      `${DEFAULT_PAGE_MARGIN_MM}mm`,
    );
  });

  it('stays hidden when margins are off', () => {
    renderWithSettings({ pageMarginMm: 0 });
    expect(screen.queryByTestId('canvas-page-margin')).toBeNull();
  });
});

