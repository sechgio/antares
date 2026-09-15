import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, type BoardColumn, type Tarea } from '../types';
import { priorityMeta, priorityRank } from '../components/views/taskPriority';
import { countActiveFilters, filterTareas } from '../utils/filters';
import { isTareaPriority, PRIORITY_OPTIONS, tareaPriority } from '../utils/priority';

const task = (patch: Partial<Tarea> = {}): Tarea => ({
  id: 'task-1', proyecto_id: 'project-1', title: 'Informe', description: null,
  status: 'in_progress', assignee_id: 'user-1', start_date: null, due_date: null,
  sort_order: 0, created_by: 'user-1', created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', ...patch,
});

const approved: BoardColumn = {
  id: 'column-1', proyecto_id: 'project-1', key: 'approved', name: 'Aprobada',
  color: '#000000', sort_order: 0, is_done: true, is_system: false,
  created_at: '', updated_at: '',
};

describe('independent task priority', () => {
  it.each(PRIORITY_OPTIONS)('supports $value without changing the status', ({ value, label }) => {
    const tarea = task({ priority: value });
    expect(tareaPriority(tarea)).toBe(value);
    expect(priorityMeta(tarea).label).toBe(label);
    expect(tarea.status).toBe('in_progress');
  });

  it('keeps explicit priority even in the legacy urgent column', () => {
    expect(tareaPriority(task({ status: 'urgent', priority: 'low' }))).toBe('low');
  });

  it('reads old snapshots without rewriting their status', () => {
    expect(tareaPriority(task({ status: 'urgent' }))).toBe('urgent');
    expect(tareaPriority(task({ status: 'review' }))).toBe('normal');
  });

  it('does not turn an overdue normal task into a high priority task', () => {
    expect(priorityMeta(task({ priority: 'normal', due_date: '2000-01-01' })).label).toBe('Normal');
  });

  it('retains priority in customized completed states', () => {
    const tarea = task({ status: 'approved', priority: 'urgent' });
    expect(priorityMeta(tarea, [approved]).label).toBe('Urgente');
    expect(priorityRank(tarea, [approved])).toBe(3);
  });

  it('sorts priorities independently of dates', () => {
    expect(PRIORITY_OPTIONS.map(({ value }) => priorityRank(task({ priority: value })))).toEqual([0, 1, 2, 3]);
  });

  it.each(['all', 'highest', '', null, undefined, 1])('rejects invalid priority %s', (value) => {
    expect(isTareaPriority(value)).toBe(false);
  });
});

describe('priority filtering', () => {
  it('combines priority, status, assignee and search', () => {
    const tasks = [
      task({ id: 'match', priority: 'urgent' }),
      task({ id: 'other-priority', priority: 'high' }),
      task({ id: 'other-state', status: 'todo', priority: 'urgent' }),
      task({ id: 'other-person', assignee_id: 'user-2', priority: 'urgent' }),
      task({ id: 'other-title', title: 'Fotos', priority: 'urgent' }),
    ];
    expect(filterTareas(tasks, {
      ...DEFAULT_FILTERS, priority: 'urgent', status: 'in_progress',
      assigneeId: 'user-1', search: 'informe',
    }).map((t) => t.id)).toEqual(['match']);
  });

  it('respects custom completed columns and showClosed', () => {
    const tarea = task({ status: 'approved', priority: 'urgent' });
    const filters = { ...DEFAULT_FILTERS, priority: 'urgent' as const };
    expect(filterTareas([tarea], filters, [approved])).toEqual([]);
    expect(filterTareas([tarea], { ...filters, showClosed: true }, [approved])).toEqual([tarea]);
  });

  it('counts and resets the priority filter', () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, priority: 'high' })).toBe(1);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, priority: undefined })).toBe(0);
    expect(filterTareas([task({ priority: 'urgent' })], DEFAULT_FILTERS)).toHaveLength(1);
  });
});
