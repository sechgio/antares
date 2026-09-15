import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TaskForm from '../components/TaskForm';
import type { Tarea } from '../types';
import { fallbackBoardColumns } from '../utils/statusConfig';

// Exercise the real shell, focus trap and portalled pickers (no primitive mocks).
afterEach(cleanup);

const task: Tarea = {
  id: 'task-1', proyecto_id: 'project-1', title: 'Informe', description: 'Revisar evidencias',
  status: 'in_progress', priority: 'high', assignee_id: 'user-1',
  start_date: '2026-09-15', due_date: '2026-09-18', sort_order: 1,
  created_by: 'user-1', created_at: '', updated_at: '',
};

function props() {
  return {
    open: true, members: [{ user_id: 'user-1', display_name: 'Ana' }],
    columns: fallbackBoardColumns('project-1'), initial: task,
    onClose: vi.fn(), onSubmit: vi.fn().mockResolvedValue(undefined),
  };
}

function closeButton() {
  return screen.getAllByRole('button', { name: 'Cerrar' })[0];
}

describe('task detail panel', () => {
  it('uses a right drawer for an existing task with the complete editable data', () => {
    render(<TaskForm {...props()} />);
    const panel = screen.getByRole('dialog', { name: 'Detalle de tarea' });
    expect(panel).toHaveAttribute('data-placement', 'right');
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Título')).toHaveValue('Informe');
    expect(screen.getByLabelText('Descripción')).toHaveValue('Revisar evidencias');
    expect(screen.getByLabelText('Descripción')).toHaveAttribute('rows', '6');
    expect(screen.getByLabelText('Persona asignada')).toHaveValue('user-1');
    expect(screen.getByLabelText('Prioridad de la tarea')).toHaveTextContent('Alta');
    expect(panel.querySelector('form')?.parentElement).toHaveClass('overflow-y-auto', 'min-h-0');
  });

  it('keeps quick creation centered and preserves calendar defaults', async () => {
    const p = props();
    render(<TaskForm {...p} initial={null} defaultStatus="in_progress" defaultStartDate="2026-09-21" defaultDueDate="2026-09-23" />);
    expect(screen.getByRole('dialog', { name: 'Nueva tarea' })).toHaveAttribute('data-placement', 'center');
    expect(screen.getByLabelText('Descripción')).toHaveAttribute('rows', '3');
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Nueva' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
    await waitFor(() => expect(p.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Nueva', status: 'in_progress', priority: 'normal',
      start_date: '2026-09-21', due_date: '2026-09-23',
    })));
  });

  it('saves through the existing callback without dropping other fields', async () => {
    const p = props();
    render(<TaskForm {...p} />);
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Informe revisado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(p.onClose).toHaveBeenCalledTimes(1));
    expect(p.onSubmit).toHaveBeenCalledWith({
      title: 'Informe revisado', description: task.description, status: task.status,
      priority: task.priority, assignee_id: task.assignee_id,
      start_date: task.start_date, due_date: task.due_date,
    });
  });

  it('retains the draft and shows a recoverable error when saving fails', async () => {
    const p = props();
    p.onSubmit.mockRejectedValue(new Error('Sin conexión'));
    render(<TaskForm {...p} />);
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'Mi borrador' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión');
    expect(screen.getByLabelText('Descripción')).toHaveValue('Mi borrador');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it.each(['button', 'escape', 'backdrop'])('asks before discarding changes via %s', (route) => {
    const p = props();
    render(<TaskForm {...p} />);
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Borrador' } });
    if (route === 'button') fireEvent.click(closeButton());
    if (route === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    if (route === 'backdrop') fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(p.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Tienes cambios sin guardar');
    expect(screen.getByRole('button', { name: 'Seguir editando' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }));
    expect(screen.getByLabelText('Título')).toHaveValue('Borrador');
    expect(screen.getByLabelText('Título')).toBeEnabled();
    fireEvent.click(closeButton());
    fireEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onSubmit).not.toHaveBeenCalled();
  });

  it('closes an unchanged task with Escape', () => {
    const p = props();
    render(<TaskForm {...p} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('blocks all close routes and duplicate submissions while saving', async () => {
    const p = props();
    let finish!: () => void;
    p.onSubmit.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<TaskForm {...p} />);
    const form = screen.getByRole('dialog').querySelector('form')!;
    fireEvent.submit(form);
    expect(closeButton()).toBeDisabled();
    fireEvent.click(closeButton());
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    fireEvent.submit(form);
    expect(p.onSubmit).toHaveBeenCalledTimes(1);
    expect(p.onClose).not.toHaveBeenCalled();
    await act(async () => { finish(); });
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close a different task when an older save finishes', async () => {
    const p = props();
    let finish!: () => void;
    p.onSubmit.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { rerender } = render(<TaskForm {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    rerender(<TaskForm {...p} initial={{ ...task, id: 'task-2', title: 'Otra tarea' }} />);
    await act(async () => { finish(); });
    expect(p.onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Título')).toHaveValue('Otra tarea');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
  });

  it('preserves a draft on same-task rerenders and resets it for a different task', () => {
    const p = props();
    const { rerender } = render(<TaskForm {...p} />);
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Borrador' } });
    rerender(<TaskForm {...p} initial={{ ...task, title: 'Snapshot nuevo' }} />);
    expect(screen.getByLabelText('Título')).toHaveValue('Borrador');
    rerender(<TaskForm {...p} initial={{ ...task, id: 'task-2', title: 'Otra tarea' }} />);
    expect(screen.getByLabelText('Título')).toHaveValue('Otra tarea');
    expect(screen.queryByText('Cambios sin guardar')).not.toBeInTheDocument();
  });

  it('starts a fresh session after closing and reopening', () => {
    const p = props();
    const { rerender } = render(<TaskForm {...p} />);
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Descartado' } });
    rerender(<TaskForm {...p} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<TaskForm {...p} />);
    expect(screen.getByLabelText('Título')).toHaveValue('Informe');
  });

  it('retains date validation in the panel', () => {
    const p = props();
    render(<TaskForm {...p} initial={{ ...task, start_date: '2026-09-20', due_date: '2026-09-18' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(screen.getByRole('alert')).toHaveTextContent('La fecha de inicio no puede ser posterior al vencimiento');
    expect(p.onSubmit).not.toHaveBeenCalled();
  });

  it('closes a real portalled priority picker before closing the panel', () => {
    const p = props();
    render(<TaskForm {...p} />);
    fireEvent.click(screen.getByLabelText('Prioridad de la tarea'));
    expect(screen.getByRole('listbox', { name: 'Prioridad de la tarea' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Prioridad de la tarea', { selector: 'button' }), { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Prioridad de la tarea' })).not.toBeInTheDocument();
    expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the editor, traps Tab and restores focus without scrolling the opener', () => {
    const p = props();
    const view = (open: boolean) => <><button>Origen</button><TaskForm {...p} open={open} /></>;
    const { rerender } = render(view(false));
    const opener = screen.getByRole('button', { name: 'Origen' });
    opener.focus();
    rerender(view(true));
    expect(screen.getByLabelText('Título')).toHaveFocus();
    const panel = screen.getByRole('dialog');
    const buttons = within(panel).getAllByRole('button');
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    rerender(view(false));
    expect(opener).toHaveFocus();
  });
});
