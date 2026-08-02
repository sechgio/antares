import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GanttView from '../components/views/GanttView';
import type { Tarea } from '../types';

function makeTarea(partial: Partial<Tarea> & Pick<Tarea, 'id' | 'title'>): Tarea {
  return {
    proyecto_id: 'p1',
    description: null,
    status: 'todo',
    assignee_id: null,
    start_date: null,
    due_date: null,
    sort_order: 0,
    created_by: null,
    created_at: '2026-07-01T12:00:00.000Z',
    updated_at: '2026-07-01T12:00:00.000Z',
    ...partial,
  };
}

describe('GanttView', () => {
  it('shows empty state with create action', () => {
    const onAddTask = vi.fn();
    render(<GanttView tareas={[]} onDatesChange={vi.fn()} onAddTask={onAddTask} />);
    expect(screen.getByText('Gantt vacío')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nueva tarea' }));
    expect(onAddTask).toHaveBeenCalled();
  });

  it('renders non-overlapping task bars and creates from day header', () => {
    const onAddTaskOnDate = vi.fn();
    const onEditTask = vi.fn();
    const tareas = [
      makeTarea({
        id: 't1',
        title: 'Tarea 1',
        start_date: '2026-07-05',
        due_date: '2026-07-05',
        status: 'in_progress',
      }),
      makeTarea({
        id: 't2',
        title: 'Tarea 2',
        start_date: '2026-07-05',
        due_date: '2026-07-06',
        status: 'todo',
      }),
    ];

    render(
      <GanttView
        tareas={tareas}
        onDatesChange={vi.fn()}
        onAddTaskOnDate={onAddTaskOnDate}
        onEditTask={onEditTask}
      />,
    );

    expect(screen.getByText('Tarea 1')).toBeInTheDocument();
    expect(screen.getByText('Tarea 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Crear tarea el 2026-07-08/i }));
    expect(onAddTaskOnDate).toHaveBeenCalledWith('2026-07-08');

    // click without drag opens edit via pointerup
    // Narrow bars put the title outside; locate by aria-label on the end handle's sibling bar
    const bar = screen.getByLabelText(/Redimensionar fin de Tarea 1/i).closest('[data-gantt-bar]')!;
    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(bar, { clientX: 100, pointerId: 1 });
    expect(onEditTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  it('resizes duration by dragging the end handle', () => {
    const onDatesChange = vi.fn();
    // Without a real layout viewport, colW uses day preset (72)
    const colW = 72;
    const tareas = [
      makeTarea({
        id: 't1',
        title: 'Tarea resize',
        start_date: '2026-07-05',
        due_date: '2026-07-05',
        status: 'todo',
      }),
    ];

    render(<GanttView tareas={tareas} onDatesChange={onDatesChange} />);

    const endHandle = screen.getByLabelText(/Redimensionar fin de Tarea resize/i);
    fireEvent.pointerDown(endHandle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerMove(endHandle, { clientX: 200 + colW * 3, pointerId: 1 });
    fireEvent.pointerUp(endHandle, { clientX: 200 + colW * 3, pointerId: 1 });

    expect(onDatesChange).toHaveBeenCalledWith('t1', '2026-07-05', '2026-07-08');
  });

  it('resizes start date by dragging the start handle', () => {
    const onDatesChange = vi.fn();
    const colW = 72;
    const tareas = [
      makeTarea({
        id: 't1',
        title: 'Tarea start',
        start_date: '2026-07-05',
        due_date: '2026-07-08',
        status: 'todo',
      }),
    ];

    render(<GanttView tareas={tareas} onDatesChange={onDatesChange} />);

    const startHandle = screen.getByLabelText(/Redimensionar inicio de Tarea start/i);
    fireEvent.pointerDown(startHandle, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(startHandle, { clientX: 300 + colW, pointerId: 1 });
    fireEvent.pointerUp(startHandle, { clientX: 300 + colW, pointerId: 1 });

    expect(onDatesChange).toHaveBeenCalledWith('t1', '2026-07-06', '2026-07-08');
  });

  it('shows title outside the bar for single-day and multi-day tasks', () => {
    const tareas = [
      makeTarea({
        id: 't1',
        title: 'VOLANTEO 22-07-26',
        start_date: '2026-07-05',
        due_date: '2026-07-05',
        status: 'in_progress',
      }),
      makeTarea({
        id: 't2',
        title: 'Tarea multi dia larga',
        start_date: '2026-07-06',
        due_date: '2026-07-12',
        status: 'todo',
      }),
    ];

    render(<GanttView tareas={tareas} onDatesChange={vi.fn()} />);

    for (const name of ['VOLANTEO 22-07-26', 'Tarea multi dia larga']) {
      const title = screen.getByText(name);
      expect(title.closest('[data-gantt-bar]')).toBeNull();
    }
    expect(screen.getByLabelText(/Redimensionar fin de VOLANTEO/i).closest('[data-gantt-bar]')).toBeTruthy();
  });

  it('zooms with Ctrl + wheel over the chart', () => {
    const tareas = [
      makeTarea({
        id: 't1',
        title: 'Tarea zoom',
        start_date: '2026-07-05',
        due_date: '2026-07-05',
      }),
    ];

    const { container } = render(<GanttView tareas={tareas} onDatesChange={vi.fn()} />);
    const scroll = container.querySelector('.gantt-scroll')!;
    expect(scroll).toBeTruthy();

    // Zoom out (positive deltaY with ctrl)
    fireEvent.wheel(scroll, { deltaY: 120, ctrlKey: true });
    // Zoom in
    fireEvent.wheel(scroll, { deltaY: -120, ctrlKey: true });

    // Still renders after free zoom
    expect(screen.getByText('Tarea zoom')).toBeInTheDocument();
  });

  it('switches Día / Semana / Mes presets to distinct column widths and spans', () => {
    const tareas = [
      makeTarea({
        id: 't1',
        title: 'Tarea escala',
        start_date: '2026-07-05',
        due_date: '2026-07-08',
      }),
    ];

    const { container } = render(<GanttView tareas={tareas} onDatesChange={vi.fn()} />);

    const dayHeadWidth = () => {
      const head = container.querySelector('.gantt-day-head') as HTMLElement | null;
      expect(head).toBeTruthy();
      return head!.style.width;
    };
    const dayCount = () => container.querySelectorAll('.gantt-day-head').length;

    // Default: Día
    expect(screen.getByRole('button', { name: 'Día' })).toHaveAttribute('aria-pressed', 'true');
    expect(dayHeadWidth()).toBe('72px');
    const daySpan = dayCount();
    expect(daySpan).toBeGreaterThanOrEqual(21);

    fireEvent.click(screen.getByRole('button', { name: 'Semana' }));
    expect(screen.getByRole('button', { name: 'Semana' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Día' })).toHaveAttribute('aria-pressed', 'false');
    expect(dayHeadWidth()).toBe('44px');
    const weekSpan = dayCount();
    expect(weekSpan).toBeGreaterThanOrEqual(56);
    expect(weekSpan).toBeGreaterThan(daySpan);

    fireEvent.click(screen.getByRole('button', { name: 'Mes' }));
    expect(screen.getByRole('button', { name: 'Mes' })).toHaveAttribute('aria-pressed', 'true');
    expect(dayHeadWidth()).toBe('26px');
    const monthSpan = dayCount();
    expect(monthSpan).toBeGreaterThanOrEqual(120);
    expect(monthSpan).toBeGreaterThan(weekSpan);

    // Back to Día restores the wide preset
    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    expect(dayHeadWidth()).toBe('72px');
    expect(dayCount()).toBe(daySpan);
  }, 20_000);
});
