import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BulkActionBar from '../components/BulkActionBar';
import type { BoardColumn } from '../types';

const columns: BoardColumn[] = [
  {
    id: 'c1',
    proyecto_id: 'p1',
    key: 'todo',
    name: 'Pendiente',
    color: '#888',
    sort_order: 0,
    is_done: false,
    is_system: true,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'c2',
    proyecto_id: 'p1',
    key: 'done',
    name: 'Completados',
    color: '#0f0',
    sort_order: 1,
    is_done: true,
    is_system: true,
    created_at: '',
    updated_at: '',
  },
];

describe('BulkActionBar', () => {
  it('renders nothing when count is 0', () => {
    const { container } = render(
      <BulkActionBar
        count={0}
        columns={columns}
        onClear={vi.fn()}
        onBulkStatus={vi.fn()}
        onBulkDelete={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('fires bulk status and delete actions', () => {
    const onBulkStatus = vi.fn();
    const onBulkDelete = vi.fn();
    const onClear = vi.fn();
    render(
      <BulkActionBar
        count={3}
        columns={columns}
        onClear={onClear}
        onBulkStatus={onBulkStatus}
        onBulkDelete={onBulkDelete}
      />,
    );

    expect(screen.getByText(/3 seleccionadas/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Cambiar estado de seleccionadas/i), {
      target: { value: 'done' },
    });
    expect(onBulkStatus).toHaveBeenCalledWith('done');

    fireEvent.click(screen.getByRole('button', { name: /Eliminar/i }));
    expect(onBulkDelete).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Limpiar selección/i }));
    expect(onClear).toHaveBeenCalled();
  });
});
