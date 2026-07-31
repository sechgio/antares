import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
  it('keeps the Archivos select mounted while docsSyncing', () => {
    const { rerender } = render(<LeftSidebar {...baseProps} />);
    expect(screen.getByLabelText('Archivo abierto')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sincronizando archivos')).not.toBeInTheDocument();

    rerender(<LeftSidebar {...baseProps} docsSyncing />);

    expect(screen.getByLabelText('Archivo abierto')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sincronizando archivos')).not.toBeInTheDocument();
  });
});
