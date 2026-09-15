import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TaskForm from '../components/TaskForm';
import type { Tarea } from '../types';

// These unit tests isolate form state from the shared popover and modal primitives.
vi.mock('../components/ModalShell', () => ({
  default: ({ open, children, footer }: { open: boolean; children: ReactNode; footer: ReactNode }) =>
    open ? <div role="dialog">{children}{footer}</div> : null,
}));
vi.mock('../components/StatusPicker', () => ({
  default: ({ value, onChange, disabled }: {
    value: string; onChange: (value: string) => void; disabled?: boolean;
  }) => <select aria-label="Estado" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
    {['todo', 'in_progress', 'urgent', 'review'].map((value) => <option key={value} value={value}>{value}</option>)}
  </select>,
}));
vi.mock('../../ui/ThemedSelect', () => ({
  default: ({ value, onChange, options, disabled, 'aria-label': label }: {
    value: string; onChange: (value: string) => void;
    options: { value: string; label: string }[]; disabled?: boolean; 'aria-label'?: string;
  }) => <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
}));
vi.mock('../../ui/DatePicker', () => ({
  default: ({ value, onChange, disabled, 'aria-label': label }: {
    value: string; onChange: (value: string) => void; disabled?: boolean; 'aria-label'?: string;
  }) => <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />,
}));

afterEach(cleanup);

const task: Tarea = {
  id: 'task-1', proyecto_id: 'project-1', title: 'Informe', description: null,
  status: 'urgent', assignee_id: null, start_date: null, due_date: null,
  sort_order: 1, created_by: 'user-1', created_at: '', updated_at: '',
};

describe('task form priority', () => {
  it('submits an in-progress task with urgent priority', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<TaskForm open members={[]} defaultStatus="in_progress" onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('¿Qué hay que hacer?'), { target: { value: 'Informe' } });
    fireEvent.change(screen.getByLabelText('Prioridad de la tarea'), { target: { value: 'urgent' } });
    expect(screen.getByLabelText('Estado')).toHaveValue('in_progress');
    fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Informe', status: 'in_progress', priority: 'urgent',
    })));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('edits a legacy task without silently moving its state', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TaskForm open members={[]} initial={task} onSubmit={onSubmit} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Prioridad de la tarea')).toHaveValue('urgent');
    expect(screen.getByText(/El estado «Urgente» se conserva por compatibilidad/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Prioridad de la tarea'), { target: { value: 'low' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 'urgent', priority: 'low' })));
  });

  it('does not change explicit priority when status changes', () => {
    render(<TaskForm open members={[]} initial={{ ...task, priority: 'high' }} onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'review' } });
    expect(screen.getByLabelText('Prioridad de la tarea')).toHaveValue('high');
  });

  it('resets priority when switching from editing to a new task', () => {
    const props = { members: [], onSubmit: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(<TaskForm {...props} open initial={{ ...task, priority: 'high' }} />);
    rerender(<TaskForm {...props} open initial={null} />);
    expect(screen.getByLabelText('Prioridad de la tarea')).toHaveValue('normal');
  });

  it('retains the selected priority and the form when saving fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Sin conexión'));
    const onClose = vi.fn();
    render(<TaskForm open members={[]} initial={{ ...task, priority: 'high' }} onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Sin conexión');
    expect(screen.getByLabelText('Prioridad de la tarea')).toHaveValue('high');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).not.toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
