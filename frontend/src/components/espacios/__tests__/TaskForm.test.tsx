import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TaskForm from '../components/TaskForm';
import type { Tarea } from '../types';

vi.mock('../../ui/DatePicker', () => ({
  default: function MockDatePicker({
    value,
    onChange,
    'aria-label': ariaLabel,
  }: {
    value: string;
    onChange: (v: string) => void;
    'aria-label'?: string;
  }) {
    return (
      <input
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  },
}));

const baseTarea: Tarea = {
  id: 't1',
  proyecto_id: 'p1',
  title: 'Existente',
  description: 'Detalle',
  status: 'todo',
  assignee_id: null,
  start_date: '2026-07-01',
  due_date: '2026-07-10',
  sort_order: 0,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('TaskForm', () => {
  it('submits start_date and due_date on create', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskForm
        open
        members={[]}
        defaultStartDate="2026-07-05"
        defaultDueDate="2026-07-08"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('¿Qué hay que hacer?'), {
      target: { value: 'Nueva tarea' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Nueva tarea',
          start_date: '2026-07-05',
          due_date: '2026-07-08',
        }),
      );
    });
  });

  it('loads start_date when editing', () => {
    render(
      <TaskForm open members={[]} initial={baseTarea} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(screen.getByLabelText('Fecha de inicio')).toHaveValue('2026-07-01');
    expect(screen.getByLabelText('Fecha de vencimiento')).toHaveValue('2026-07-10');
  });

  it('rejects start after due', async () => {
    const onSubmit = vi.fn();
    render(<TaskForm open members={[]} onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('¿Qué hay que hacer?'), {
      target: { value: 'Rango inválido' },
    });
    fireEvent.change(screen.getByLabelText('Fecha de inicio'), {
      target: { value: '2026-07-20' },
    });
    fireEvent.change(screen.getByLabelText('Fecha de vencimiento'), {
      target: { value: '2026-07-10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));

    expect(
      await screen.findByText(/inicio no puede ser posterior al vencimiento/i),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
