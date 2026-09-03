import { describe, expect, it } from 'vitest';
import type { BoardColumn, Tarea } from '../types';
import {
  applyGanttDragDelta,
  buildDays,
  buildGanttBars,
  buildWeekGroups,
  computeVisibleRange,
  isTaskOverdue,
  packLanes,
  resolveGanttColW,
  resolveGanttMinSpan,
  resolveTaskRange,
} from '../utils/ganttLayout';

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

describe('resolveTaskRange', () => {
  it('uses start and due when both set', () => {
    const t = makeTarea({
      id: '1',
      title: 'A',
      start_date: '2026-07-05',
      due_date: '2026-07-08',
    });
    expect(resolveTaskRange(t)).toEqual({ start: '2026-07-05', end: '2026-07-08' });
  });

  it('falls back to due_date for both ends', () => {
    const t = makeTarea({ id: '1', title: 'A', due_date: '2026-07-10' });
    expect(resolveTaskRange(t)).toEqual({ start: '2026-07-10', end: '2026-07-10' });
  });

  it('swaps inverted ranges', () => {
    const t = makeTarea({
      id: '1',
      title: 'A',
      start_date: '2026-07-10',
      due_date: '2026-07-05',
    });
    expect(resolveTaskRange(t)).toEqual({ start: '2026-07-10', end: '2026-07-10' });
  });
});

describe('isTaskOverdue', () => {
  const today = '2026-07-08';
  const customDoneColumn: BoardColumn = {
    id: 'c1',
    proyecto_id: 'p1',
    key: 'completada',
    name: 'Completada',
    color: '#0F9D58',
    sort_order: 0,
    is_done: true,
    is_system: false,
    created_at: '',
    updated_at: '',
  };

  it('marks open past-due tasks as overdue', () => {
    const t = makeTarea({ id: '1', title: 'A', due_date: '2026-07-01', status: 'todo' });
    expect(isTaskOverdue(t, today)).toBe(true);
  });

  it('does not mark builtin done/closed as overdue', () => {
    expect(
      isTaskOverdue(makeTarea({ id: '1', title: 'A', due_date: '2026-07-01', status: 'done' }), today),
    ).toBe(false);
    expect(
      isTaskOverdue(makeTarea({ id: '2', title: 'B', due_date: '2026-07-01', status: 'closed' }), today),
    ).toBe(false);
  });

  it('respects custom is_done columns', () => {
    const t = makeTarea({ id: '1', title: 'A', due_date: '2026-07-01', status: 'completada' });
    expect(isTaskOverdue(t, today, [customDoneColumn])).toBe(false);
    expect(isTaskOverdue(t, today, [])).toBe(true);
  });
});

describe('packLanes', () => {
  it('places non-overlapping tasks on the same lane', () => {
    const lanes = packLanes([
      { id: 'a', start: '2026-07-01', end: '2026-07-02' },
      { id: 'b', start: '2026-07-04', end: '2026-07-05' },
    ]);
    expect(lanes.get('a')).toBe(0);
    expect(lanes.get('b')).toBe(0);
  });

  it('stacks overlapping tasks on different lanes', () => {
    const lanes = packLanes([
      { id: 'a', start: '2026-07-01', end: '2026-07-05' },
      { id: 'b', start: '2026-07-03', end: '2026-07-06' },
      { id: 'c', start: '2026-07-04', end: '2026-07-04' },
    ]);
    expect(lanes.get('a')).toBe(0);
    expect(lanes.get('b')).toBe(1);
    expect(lanes.get('c')).toBe(2);
  });

  it('allows tasks that touch at the boundary to share a lane', () => {
    const lanes = packLanes([
      { id: 'a', start: '2026-07-01', end: '2026-07-02' },
      { id: 'b', start: '2026-07-03', end: '2026-07-04' },
    ]);
    expect(lanes.get('a')).toBe(0);
    expect(lanes.get('b')).toBe(0);
  });

  it('keeps same-day tasks on separate lanes', () => {
    const lanes = packLanes([
      { id: 'a', start: '2026-07-05', end: '2026-07-05' },
      { id: 'b', start: '2026-07-05', end: '2026-07-05' },
    ]);
    expect(lanes.get('a')).toBe(0);
    expect(lanes.get('b')).toBe(1);
  });
});

describe('buildGanttBars', () => {
  it('assigns lanes so concurrent bars never share a row', () => {
    const bars = buildGanttBars(
      [
        makeTarea({ id: '1', title: 'A', start_date: '2026-07-05', due_date: '2026-07-08' }),
        makeTarea({ id: '2', title: 'B', start_date: '2026-07-06', due_date: '2026-07-07' }),
      ],
      '2026-07-08',
    );
    expect(bars).toHaveLength(2);
    expect(new Set(bars.map((b) => b.lane)).size).toBe(2);
  });
});

describe('buildDays / buildWeekGroups', () => {
  it('marks weekends and today', () => {
    const days = buildDays('2026-07-04', '2026-07-08', '2026-07-08');
    expect(days).toHaveLength(5);
    expect(days[0].isWeekend).toBe(true);
    expect(days[1].isWeekend).toBe(true);
    expect(days[4].isToday).toBe(true);
  });

  it('groups days into weeks', () => {
    const days = buildDays('2026-07-05', '2026-07-12', '2026-07-08');
    const weeks = buildWeekGroups(days);
    expect(weeks.length).toBeGreaterThanOrEqual(1);
    expect(weeks.reduce((n, w) => n + w.span, 0)).toBe(days.length);
  });
});

describe('computeVisibleRange', () => {
  it('includes today and pads around tasks', () => {
    const bars = buildGanttBars(
      [makeTarea({ id: '1', title: 'A', start_date: '2026-07-10', due_date: '2026-07-12' })],
      '2026-07-08',
    );
    const range = computeVisibleRange(bars, '2026-07-08', 7, 21);
    expect(range.start <= '2026-07-08').toBe(true);
    expect(range.end >= '2026-07-12').toBe(true);
  });
});

describe('Gantt zoom presets (Día / Semana / Mes)', () => {
  it('keeps column widths distinct and expands min span for week/month', () => {
    expect(resolveGanttColW('day', null)).toBe(72);
    expect(resolveGanttColW('week', null)).toBe(44);
    expect(resolveGanttColW('month', null)).toBe(26);
    expect(resolveGanttColW('day', 90)).toBe(90);

    expect(resolveGanttColW('day', null)).not.toBe(resolveGanttColW('week', null));
    expect(resolveGanttColW('week', null)).not.toBe(resolveGanttColW('month', null));

    const wide = 2000;
    const daySpan = resolveGanttMinSpan('day', 72, wide);
    const weekSpan = resolveGanttMinSpan('week', 44, wide);
    const monthSpan = resolveGanttMinSpan('month', 26, wide);

    expect(daySpan.minSpanDays).toBeGreaterThanOrEqual(21);
    expect(weekSpan.minSpanDays).toBeGreaterThan(daySpan.minSpanDays);
    expect(monthSpan.minSpanDays).toBeGreaterThan(weekSpan.minSpanDays);
    expect(monthSpan.minSpanDays).toBeGreaterThanOrEqual(Math.ceil(wide / 26) + 2);
  });
});

describe('applyGanttDragDelta', () => {
  it('moves both ends together', () => {
    expect(applyGanttDragDelta('move', '2026-07-05', '2026-07-06', 2)).toEqual({
      start: '2026-07-07',
      end: '2026-07-08',
    });
  });

  it('extends end when resizing the right handle', () => {
    expect(applyGanttDragDelta('resize-end', '2026-07-05', '2026-07-05', 3)).toEqual({
      start: '2026-07-05',
      end: '2026-07-08',
    });
  });

  it('shortens start when resizing the left handle', () => {
    expect(applyGanttDragDelta('resize-start', '2026-07-05', '2026-07-08', 1)).toEqual({
      start: '2026-07-06',
      end: '2026-07-08',
    });
  });

  it('never collapses below one day on resize-end', () => {
    expect(applyGanttDragDelta('resize-end', '2026-07-05', '2026-07-08', -10)).toEqual({
      start: '2026-07-05',
      end: '2026-07-05',
    });
  });

  it('never collapses below one day on resize-start', () => {
    expect(applyGanttDragDelta('resize-start', '2026-07-05', '2026-07-08', 10)).toEqual({
      start: '2026-07-08',
      end: '2026-07-08',
    });
  });
});
