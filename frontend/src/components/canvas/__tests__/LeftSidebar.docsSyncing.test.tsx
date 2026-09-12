import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import LeftSidebar from '../editor/LeftSidebar';
import { LAYER_ROW_H, LAYER_VIRTUALIZE_AT } from '../ops/layerListWindow';

const baseProps = {
  documentName: 'PANEL 2',
  docs: [
    { id: 'doc-1', name: 'PANEL 2', updatedAt: '2026-07-31T10:00:00.000Z' },
    { id: 'doc-2', name: 'Sin título', updatedAt: '2026-07-31T09:00:00.000Z' },
  ],
  documentId: 'doc-1',
  layers: [],
  selectedIds: [] as string[],
  pageIndex: 0,
  pageCount: 1,
  pages: [{ id: 'p1', name: 'Página 1' }],
  onSelect: vi.fn(),
  onOpenDoc: vi.fn(),
  onNew: vi.fn(),
  onDeleteDoc: vi.fn(),
  onPageChange: vi.fn(),
  onAddPage: vi.fn(),
  onRemovePage: vi.fn(),
  onDuplicatePage: vi.fn(),
  onRenamePage: vi.fn(),
  onMoveLayer: vi.fn(),
  onGroupSelected: vi.fn(),
  onUngroupSelected: vi.fn(),
  onToggleVisible: vi.fn(),
  onToggleLocked: vi.fn(),
  onRenameLayer: vi.fn(),
};

describe('LeftSidebar Archivos picker during sync', () => {
  it('marks the sidebar as a compact overlay surface', () => {
    render(<LeftSidebar {...baseProps} />);

    expect(screen.getByTestId('canvas-left-panel')).toHaveClass('canvas-panel-chrome--left');
  });

  it('keeps the Archivos select mounted while docsSyncing', () => {
    const { rerender } = render(<LeftSidebar {...baseProps} />);
    expect(screen.getByLabelText('Archivo abierto')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sincronizando archivos')).not.toBeInTheDocument();

    rerender(<LeftSidebar {...baseProps} docsSyncing />);

    expect(screen.getByLabelText('Archivo abierto')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sincronizando archivos')).not.toBeInTheDocument();
  });

  it('shows page and visible layer counts', () => {
    const layer = createLayer('text', { id: 'layer-title', name: 'Título' });
    render(
      <LeftSidebar
        {...baseProps}
        layers={[layer]}
        pageCount={2}
        pages={[{ id: 'p1', name: 'Página 1' }, { id: 'p2', name: 'Página 2' }]}
      />,
    );

    expect(screen.getByTestId('canvas-pages-count')).toHaveTextContent('2');
    expect(screen.getByTestId('canvas-layers-count')).toHaveTextContent('1');
  });

  it('explains when a layer search has no matches', () => {
    const layer = createLayer('text', { id: 'layer-title', name: 'Título' });
    render(<LeftSidebar {...baseProps} layers={[layer]} />);

    fireEvent.change(screen.getByLabelText('Buscar capas'), { target: { value: 'inexistente' } });

    expect(screen.getByText('No se encontraron capas')).toBeInTheDocument();
    expect(screen.getByText('Prueba otro nombre o tipo.')).toBeInTheDocument();
  });

  it('identifies the current page and preserves page navigation', () => {
    const onPageChange = vi.fn();
    const props = {
      ...baseProps,
      pageCount: 2,
      pages: [{ id: 'p1', name: 'Portada' }, { id: 'p2', name: 'Detalle' }],
      onPageChange,
    };
    const { rerender } = render(<LeftSidebar {...props} />);
    expect(screen.getByRole('button', { name: 'Portada A4' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Detalle A4' }));
    expect(onPageChange).toHaveBeenCalledWith(1);

    rerender(<LeftSidebar {...props} pageIndex={1} />);
    expect(screen.getByRole('button', { name: 'Portada A4' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Detalle A4' })).toHaveAttribute('aria-current', 'page');
  });

  it('navigates visible layer rows with arrow keys', () => {
    const a = createLayer('text', { id: 'a', name: 'Alpha' });
    const b = createLayer('text', { id: 'b', name: 'Beta' });
    const onSelect = vi.fn();
    render(<LeftSidebar {...baseProps} layers={[a, b]} selectedIds={['b']} onSelect={onSelect} />);

    fireEvent.keyDown(screen.getByTestId('canvas-layer-list'), { key: 'ArrowDown' });

    expect(onSelect).toHaveBeenCalledWith('a', false);
  });

  it('exposes a left panel resizer that reports width changes', () => {
    const onWidthChange = vi.fn();
    render(<LeftSidebar {...baseProps} width={248} onWidthChange={onWidthChange} />);
    const resizer = screen.getByTestId('canvas-left-resizer');
    resizer.setPointerCapture = vi.fn();
    resizer.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(resizer, { clientX: 248, pointerId: 1 });
    expect(screen.getByTestId('canvas-left-panel')).toHaveAttribute('data-resizing', 'true');
    fireEvent.pointerMove(resizer, { clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(resizer, { pointerId: 1 });
    expect(onWidthChange).toHaveBeenCalled();
    const next = onWidthChange.mock.calls.at(-1)?.[0] as number;
    expect(next).toBeGreaterThan(248);
    expect(screen.getByTestId('canvas-left-panel')).not.toHaveAttribute('data-resizing');
  });

  it('cleans up resize listeners when pointer capture is already gone', () => {
    const onWidthChange = vi.fn();
    render(<LeftSidebar {...baseProps} width={248} onWidthChange={onWidthChange} />);
    const resizer = screen.getByTestId('canvas-left-resizer');
    resizer.setPointerCapture = vi.fn();
    resizer.releasePointerCapture = vi.fn(() => {
      throw new Error('pointer capture already released');
    });

    fireEvent.pointerDown(resizer, { clientX: 248, pointerId: 1 });
    fireEvent.pointerMove(resizer, { clientX: 300, pointerId: 1 });
    fireEvent.pointerCancel(resizer, { pointerId: 1 });

    const callsAfterCancel = onWidthChange.mock.calls.length;
    expect(screen.getByTestId('canvas-left-panel')).not.toHaveAttribute('data-resizing');
    fireEvent.pointerMove(resizer, { clientX: 320, pointerId: 1 });
    expect(onWidthChange).toHaveBeenCalledTimes(callsAfterCancel);
  });

  it('prevents default on layer list arrows so the canvas does not nudge', () => {
    const a = createLayer('text', { id: 'a', name: 'Alpha' });
    const b = createLayer('text', { id: 'b', name: 'Beta' });
    render(<LeftSidebar {...baseProps} layers={[a, b]} selectedIds={['b']} />);
    const list = screen.getByTestId('canvas-layer-list');
    expect(fireEvent.keyDown(list, { key: 'ArrowDown', cancelable: true })).toBe(false);
    expect(fireEvent.keyDown(list, { key: 'ArrowLeft', cancelable: true })).toBe(false);
  });

  it('keeps layer selection connected to the existing callback', () => {
    const onSelect = vi.fn();
    const layer = createLayer('text', { id: 'layer-title', name: 'Título' });
    render(<LeftSidebar {...baseProps} layers={[layer]} onSelect={onSelect} />);

    fireEvent.click(
      screen
        .getByTestId('canvas-left-panel')
        .querySelector('[data-layer-id="layer-title"] [role="button"]')!,
    );

    expect(onSelect).toHaveBeenCalledWith('layer-title', false);
  });

  it('exposes selected, hidden and locked layer states without dimming the actions', () => {
    const layer = createLayer('text', { id: 'locked-title', name: 'Título', locked: true, visible: false });
    const onToggleVisible = vi.fn();
    const onToggleLocked = vi.fn();
    render(<LeftSidebar {...baseProps} layers={[layer]} selectedIds={[layer.id]}
      onToggleVisible={onToggleVisible} onToggleLocked={onToggleLocked} />);
    expect(screen.getByRole('button', { name: 'Título' })).toHaveAttribute('aria-pressed', 'true');
    const visible = screen.getByRole('button', { name: 'Visibilidad' });
    expect(visible).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(visible);
    expect(onToggleVisible).toHaveBeenCalledWith(layer.id, true);
    const locked = screen.getByRole('button', { name: 'Desbloquear' });
    expect(locked).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(locked);
    expect(onToggleLocked).toHaveBeenCalledWith(layer.id, false);
  });

  it('keeps a user-collapsed group closed across non-structural layer edits', () => {
    const group = createLayer('group', { id: 'g1', name: 'Grupo' });
    const child = createLayer('text', { id: 'child', name: 'Hijo', parentId: 'g1' });
    const { rerender } = render(<LeftSidebar {...baseProps} layers={[group, child]} />);

    expect(screen.getByText('Hijo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Colapsar' }));
    expect(screen.queryByText('Hijo')).not.toBeInTheDocument();

    rerender(
      <LeftSidebar
        {...baseProps}
        layers={[{ ...group, name: 'Grupo renombrado' }, child]}
      />,
    );

    expect(screen.getByText('Grupo renombrado')).toBeInTheDocument();
    expect(screen.queryByText('Hijo')).not.toBeInTheDocument();
  });

  it('expands a newly created group without reopening a collapsed sibling', () => {
    const g1 = createLayer('group', { id: 'g1', name: 'Uno' });
    const c1 = createLayer('text', { id: 'c1', name: 'Hijo uno', parentId: 'g1' });
    const { rerender } = render(<LeftSidebar {...baseProps} layers={[g1, c1]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Colapsar' }));

    const g2 = createLayer('group', { id: 'g2', name: 'Dos' });
    const c2 = createLayer('text', { id: 'c2', name: 'Hijo dos', parentId: 'g2' });
    rerender(<LeftSidebar {...baseProps} layers={[g1, c1, g2, c2]} />);

    expect(screen.queryByText('Hijo uno')).not.toBeInTheDocument();
    expect(screen.getByText('Hijo dos')).toBeInTheDocument();
  });

  it('resets expansion when the open document changes', () => {
    const g1 = createLayer('group', { id: 'g1', name: 'Grupo A' });
    const c1 = createLayer('text', { id: 'c1', name: 'Hijo A', parentId: 'g1' });
    const { rerender } = render(
      <LeftSidebar {...baseProps} documentId="doc-1" layers={[g1, c1]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Colapsar' }));
    expect(screen.queryByText('Hijo A')).not.toBeInTheDocument();

    const g2 = createLayer('group', { id: 'g2', name: 'Grupo B' });
    const c2 = createLayer('text', { id: 'c2', name: 'Hijo B', parentId: 'g2' });
    rerender(
      <LeftSidebar {...baseProps} documentId="doc-2" documentName="Otro" layers={[g2, c2]} />,
    );

    expect(screen.getByText('Hijo B')).toBeInTheDocument();
  });

  it('keeps search hits visible after the virtual window was scrolled past the new range', () => {
    const layers = Array.from({ length: LAYER_VIRTUALIZE_AT + 20 }, (_, i) =>
      createLayer('text', { id: `l${i}`, name: i === 0 ? 'Cabecera unica' : `Capa ${i}` }),
    );
    render(<LeftSidebar {...baseProps} layers={layers} />);

    const list = screen.getByTestId('canvas-layer-list');
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 80 * LAYER_ROW_H });
    fireEvent.scroll(list);

    fireEvent.change(screen.getByLabelText('Buscar capas'), { target: { value: 'Cabecera unica' } });

    expect(screen.getByText('Cabecera unica')).toBeInTheDocument();
    expect(screen.queryByText('No se encontraron capas')).not.toBeInTheDocument();
  });

  it('scrolls a virtualized selection into the rendered window by index', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.getAttribute?.('data-testid') === 'canvas-layer-list') {
        return {
          width: 240,
          height: 224,
          top: 0,
          left: 0,
          bottom: 224,
          right: 240,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalRect.call(this);
    };
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        if ((this as HTMLElement).getAttribute?.('data-testid') === 'canvas-layer-list') return 224;
        return clientHeight?.get?.call(this) ?? 0;
      },
    });

    try {
      const layers = Array.from({ length: 180 }, (_, i) =>
        createLayer('text', { id: `l${i}`, name: `Fila-${i}` }),
      );
      const { rerender } = render(<LeftSidebar {...baseProps} layers={layers} selectedIds={['l0']} />);
      const list = screen.getByTestId('canvas-layer-list');
      expect(list.querySelector('[data-layer-id="l170"]')).toBeNull();

      rerender(<LeftSidebar {...baseProps} layers={layers} selectedIds={['l170']} />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(list.querySelector('[data-layer-id="l170"]')).toBeTruthy();
      expect(Number(list.getAttribute('data-window-start'))).toBeGreaterThan(0);
      expect(list.scrollTop).toBeGreaterThan(0);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
    }
  });

  it('re-reveals a selected layer when its row moves without changing selection', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.getAttribute?.('data-testid') === 'canvas-layer-list') {
        return {
          width: 240,
          height: 224,
          top: 0,
          left: 0,
          bottom: 224,
          right: 240,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalRect.call(this);
    };
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        if ((this as HTMLElement).getAttribute?.('data-testid') === 'canvas-layer-list') return 224;
        return clientHeight?.get?.call(this) ?? 0;
      },
    });

    try {
      const layers = Array.from({ length: 180 }, (_, i) =>
        createLayer('text', { id: `l${i}`, name: `Fila-${i}` }),
      );
      const { rerender } = render(<LeftSidebar {...baseProps} layers={layers} selectedIds={['l170']} />);
      const list = screen.getByTestId('canvas-layer-list');
      await act(async () => {
        await Promise.resolve();
      });
      expect(list.scrollTop).toBeGreaterThan(0);

      const reordered = [...layers.filter((layer) => layer.id !== 'l170'), layers[170]!];
      rerender(<LeftSidebar {...baseProps} layers={reordered} selectedIds={['l170']} />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(list.scrollTop).toBe(0);
      expect(Number(list.getAttribute('data-window-start'))).toBe(0);
      expect(list.querySelector('[data-layer-id="l170"]')).toBeTruthy();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
    }
  });
});
