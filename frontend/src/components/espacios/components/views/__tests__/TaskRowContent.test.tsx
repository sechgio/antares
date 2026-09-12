import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ListTaskRowContent from '../ListTaskRowContent';
import TableTaskRowContent from '../TableTaskRowContent';
import ListView from '../ListView';
import TableView from '../TableView';
import type { Tarea, TeamMember } from '../../../types';

const mockMembers: TeamMember[] = [{ user_id: 'user-1', display_name: 'Alice' }];

const tarea: Tarea = {
  id: 'tarea-1',
  espacio_id: 'espacio-1',
  title: 'Tarea Uno',
  description: 'Descripción Uno',
  status: 'todo',
  assignee_id: 'user-1',
  due_date: '2026-08-01',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

function createMockTareas(count: number): Tarea[] {
  return Array.from({ length: count }, (_, i) => ({ ...tarea, id: `tarea-${i + 1}`, title: `Tarea ${i + 1}` }));
}

function listHandlers() {
  return {
    onToggleSelect: vi.fn(),
    onStatusChange: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };
}

function renderListRow(variant: 'grid' | 'table', handlers = listHandlers()) {
  const row = (
    <ListTaskRowContent
      variant={variant}
      tarea={tarea}
      members={mockMembers}
      columns={[]}
      selectedIds={new Set(['tarea-1'])}
      selectable
      {...handlers}
    />
  );
  const utils =
    variant === 'table' ? (
      render(
        <table>
          <tbody>
            <tr>{row}</tr>
          </tbody>
        </table>,
      )
    ) : (
      render(<div>{row}</div>)
    );
  return { ...utils, handlers };
}

describe('ListTaskRowContent parity (grid vs table)', () => {
  it('renders the same task content and aria-labels in both variants', () => {
    const grid = within(renderListRow('grid').container);
    const table = within(renderListRow('table').container);

    for (const label of [
      'Seleccionar Tarea Uno',
      'Editar Tarea Uno',
      'Eliminar Tarea Uno',
      'Cambiar estado de Tarea Uno',
    ]) {
      expect(grid.getByLabelText(label)).toBeInTheDocument();
      expect(table.getByLabelText(label)).toBeInTheDocument();
    }

    expect(grid.getByText('Tarea Uno')).toBeInTheDocument();
    expect(table.getByText('Tarea Uno')).toBeInTheDocument();
    expect(grid.getByText('Descripción Uno')).toBeInTheDocument();
    expect(table.getByText('Descripción Uno')).toBeInTheDocument();
    expect(grid.getByLabelText('Seleccionar Tarea Uno')).toBeChecked();
    expect(table.getByLabelText('Seleccionar Tarea Uno')).toBeChecked();
  });

  it('fires identical callbacks with identical arguments', () => {
    for (const variant of ['grid', 'table'] as const) {
      const { container, handlers, unmount } = renderListRow(variant);
      const { getByLabelText, getByText } = within(container);

      fireEvent.click(getByLabelText('Seleccionar Tarea Uno'));
      expect(handlers.onToggleSelect).toHaveBeenCalledWith('tarea-1');

      fireEvent.click(getByText('Tarea Uno'));
      expect(handlers.onEdit).toHaveBeenCalledWith(tarea);

      fireEvent.click(getByLabelText('Editar Tarea Uno'));
      fireEvent.click(getByLabelText('Eliminar Tarea Uno'));
      expect(handlers.onEdit).toHaveBeenCalledTimes(2);
      expect(handlers.onDelete).toHaveBeenCalledWith('tarea-1');
      unmount();
    }
  });

  it('keeps double-click edit only in the table variant', () => {
    const grid = renderListRow('grid');
    const gridTitle = within(grid.container).getByText('Tarea Uno').closest('button')!;
    expect(gridTitle.ondblclick).toBeNull();
    grid.unmount();

    const table = renderListRow('table');
    fireEvent.doubleClick(within(table.container).getByText('Tarea Uno'));
    expect(table.handlers.onEdit).toHaveBeenCalledWith(tarea);
  });
});

function tableHandlers() {
  return {
    onToggleSelect: vi.fn(),
    onStatusChange: vi.fn(),
    onComplete: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };
}

function renderTableRow(variant: 'grid' | 'table', handlers = tableHandlers()) {
  const row = (
    <TableTaskRowContent
      variant={variant}
      tarea={tarea}
      index={0}
      members={mockMembers}
      columns={[]}
      selectedIds={new Set(['tarea-1'])}
      selectable
      {...handlers}
    />
  );
  const utils =
    variant === 'table' ? (
      render(
        <table>
          <tbody>
            <tr>{row}</tr>
          </tbody>
        </table>,
      )
    ) : (
      render(<div>{row}</div>)
    );
  return { ...utils, handlers };
}

describe('TableTaskRowContent parity (grid vs table)', () => {
  it('renders the same cells and aria-labels in both variants', () => {
    const grid = within(renderTableRow('grid').container);
    const table = within(renderTableRow('table').container);

    for (const label of [
      'Seleccionar Tarea Uno',
      'Completar «Tarea Uno»',
      'Editar Tarea Uno',
      'Eliminar Tarea Uno',
      'Estado de Tarea Uno',
    ]) {
      expect(grid.getByLabelText(label)).toBeInTheDocument();
      expect(table.getByLabelText(label)).toBeInTheDocument();
    }

    for (const root of [grid, table]) {
      expect(root.getByText('Tarea Uno')).toBeInTheDocument();
      expect(root.getByText('1')).toBeInTheDocument();
      expect(root.getByText('Alice')).toBeInTheDocument();
    }
  });

  it('fires identical callbacks with identical arguments', () => {
    for (const variant of ['grid', 'table'] as const) {
      const { container, handlers, unmount } = renderTableRow(variant);
      const { getByLabelText, getByText } = within(container);

      fireEvent.click(getByLabelText('Seleccionar Tarea Uno'));
      expect(handlers.onToggleSelect).toHaveBeenCalledWith('tarea-1');

      fireEvent.click(getByLabelText('Completar «Tarea Uno»'));
      expect(handlers.onComplete).toHaveBeenCalledWith(tarea);

      fireEvent.click(getByText('Tarea Uno'));
      expect(handlers.onEdit).toHaveBeenCalledWith(tarea);

      fireEvent.click(getByLabelText('Eliminar Tarea Uno'));
      expect(handlers.onDelete).toHaveBeenCalledWith('tarea-1');
      unmount();
    }
  });

  it('shows description only in the table variant (preserved difference)', () => {
    const grid = renderTableRow('grid');
    expect(within(grid.container).queryByText('Descripción Uno')).not.toBeInTheDocument();
    grid.unmount();

    const table = renderTableRow('table');
    expect(within(table.container).getByText('Descripción Uno')).toBeInTheDocument();
  });
});

describe('view-level virtual row parity', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ListView virtual rows expose the same callbacks', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 600, width: 800, top: 0, left: 0, bottom: 600, right: 800, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const onDelete = vi.fn();
    const onEdit = vi.fn();
    const { container } = render(
      <ListView
        tareas={createMockTareas(60)}
        members={mockMembers}
        onStatusChange={vi.fn()}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );

    const rows = container.querySelectorAll('[data-virtual-row]');
    expect(rows.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText('Eliminar Tarea 1'));
    expect(onDelete).toHaveBeenCalledWith('tarea-1');

    fireEvent.click(screen.getByText('Tarea 1'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'tarea-1' }));
  });

  it('TableView virtual rows expose the same callbacks', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 600, width: 800, top: 0, left: 0, bottom: 600, right: 800, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const onDelete = vi.fn();
    const onComplete = vi.fn();
    const { container } = render(
      <TableView
        tareas={createMockTareas(60)}
        members={mockMembers}
        onStatusChange={vi.fn()}
        onComplete={onComplete}
        onDelete={onDelete}
      />,
    );

    const rows = container.querySelectorAll('[data-virtual-row]');
    expect(rows.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText('Completar «Tarea 1»'));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 'tarea-1' }));

    fireEvent.click(screen.getByLabelText('Eliminar Tarea 1'));
    expect(onDelete).toHaveBeenCalledWith('tarea-1');
  });
});
