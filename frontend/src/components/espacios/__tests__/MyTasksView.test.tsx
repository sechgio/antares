import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MyTasksView from '../components/MyTasksView';
import { DEFAULT_MY_TASKS_FILTERS, type MyTask } from '../types';

const task = (patch: Partial<MyTask> = {}): MyTask => ({
  id: 'task-1', proyecto_id: 'project-1', title: 'Revisar informe', description: null,
  status: 'review', status_name: 'En revisión', status_is_done: false, priority: 'high',
  assignee_id: 'user-1', start_date: null, due_date: '2026-09-15', sort_order: 0,
  created_by: 'user-1', created_at: '', updated_at: '', proyecto_name: 'Sedapal Norte',
  espacio_id: 'space-1', espacio_name: 'Informes', ...patch,
});

const baseProps = {
  tasks: [task()], origins: [task()], filters: DEFAULT_MY_TASKS_FILTERS,
  loading: false, loadingMore: false, error: null, hasMore: false, hasAssignments: true,
  today: '2026-09-15', onFiltersChange: vi.fn(), onRetry: vi.fn(), onLoadMore: vi.fn(), onOpenTask: vi.fn(),
};

describe('MyTasksView', () => {
  it('shows grouped task origin, status, priority and due date', () => {
    render(<MyTasksView {...baseProps} />);
    expect(screen.getByRole('heading', { name: 'Hoy' })).toBeInTheDocument();
    expect(screen.getByText('Revisar informe')).toBeInTheDocument();
    expect(screen.getByText(/En revisión · Alta · Hoy/)).toBeInTheDocument();
    expect(screen.getByText('Proyecto: Sedapal Norte')).toBeInTheDocument();
    expect(screen.getByText('Espacio: Informes')).toBeInTheDocument();
  });

  it('opens the selected task through the shared callback', () => {
    const onOpenTask = vi.fn();
    render(<MyTasksView {...baseProps} onOpenTask={onOpenTask} />);
    fireEvent.click(screen.getByRole('button', { name: /Abrir Revisar informe/ }));
    expect(onOpenTask).toHaveBeenCalledWith(baseProps.tasks[0]);
  });

  it('distinguishes no assignments from no filter matches', () => {
    const { rerender } = render(<MyTasksView {...baseProps} tasks={[]} origins={[]} hasAssignments={false} />);
    expect(screen.getByText('No tienes tareas asignadas')).toBeInTheDocument();
    rerender(<MyTasksView {...baseProps} tasks={[]} hasAssignments />);
    expect(screen.getByText('Ninguna tarea coincide con los filtros')).toBeInTheDocument();
  });

  it('renders an error with retry independently of the project view', () => {
    const onRetry = vi.fn();
    render(<MyTasksView {...baseProps} tasks={[]} error="Sin conexión" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
