import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import LeftSidebar from '../editor/LeftSidebar';

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
});
