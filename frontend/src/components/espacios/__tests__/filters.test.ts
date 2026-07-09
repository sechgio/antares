import { describe, it, expect } from 'vitest';
import {
  computeTaskStats,
  countActiveFilters,
  countOverdue,
  countUnscheduled,
  filterTareas,
} from '../utils/filters';
import type { BoardColumn, Tarea } from '../types';
import { DEFAULT_FILTERS } from '../types';

const baseTarea: Tarea = {
  id: '1',
  proyecto_id: 'p1',
  title: 'Test',
  description: null,
  status: 'todo',
  assignee_id: null,
  start_date: null,
  due_date: null,
  sort_order: 0,
  created_by: null,
  created_at: '',
  updated_at: '',
};

const customDoneColumns: BoardColumn[] = [
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
    key: 'entregado',
    name: 'Entregado',
    color: '#0f0',
    sort_order: 1,
    is_done: true,
    is_system: false,
    created_at: '',
    updated_at: '',
  },
];

describe('filterTareas', () => {
  it('excludes closed tasks by default', () => {
    const tareas = [
      { ...baseTarea, id: '1', status: 'todo' as const },
      { ...baseTarea, id: '2', status: 'closed' as const },
    ];
    expect(filterTareas(tareas, DEFAULT_FILTERS)).toHaveLength(1);
  });

  it('excludes custom is_done statuses when showClosed is false', () => {
    const tareas = [
      { ...baseTarea, id: '1', status: 'todo' },
      { ...baseTarea, id: '2', status: 'entregado' },
      { ...baseTarea, id: '3', status: 'done' },
    ];
    expect(filterTareas(tareas, DEFAULT_FILTERS, customDoneColumns)).toHaveLength(1);
    expect(
      filterTareas(tareas, { ...DEFAULT_FILTERS, showClosed: true }, customDoneColumns),
    ).toHaveLength(3);
  });

  it('filters by search query', () => {
    const tareas = [
      { ...baseTarea, id: '1', title: 'Alpha' },
      { ...baseTarea, id: '2', title: 'Beta' },
    ];
    expect(filterTareas(tareas, { ...DEFAULT_FILTERS, search: 'alp' })).toHaveLength(1);
  });
});

describe('counts', () => {
  it('counts unscheduled open tasks', () => {
    const tareas = [
      { ...baseTarea, due_date: null },
      { ...baseTarea, id: '2', due_date: '2026-12-01' },
      { ...baseTarea, id: '3', status: 'closed' as const },
    ];
    expect(countUnscheduled(tareas)).toBe(1);
  });

  it('counts overdue tasks', () => {
    const tareas = [
      { ...baseTarea, due_date: '2020-01-01', status: 'todo' as const },
      { ...baseTarea, id: '2', due_date: '2030-01-01', status: 'todo' as const },
      { ...baseTarea, id: '3', due_date: '2020-01-01', status: 'done' as const },
    ];
    expect(countOverdue(tareas)).toBe(1);
  });
});

describe('filter helpers', () => {
  it('detects active filters', () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, search: 'x' })).toBe(1);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, status: 'done', showClosed: true })).toBe(2);
  });

  it('computes task stats', () => {
    const tareas = [
      { ...baseTarea, id: '1', status: 'todo' as const },
      { ...baseTarea, id: '2', status: 'done' as const },
      { ...baseTarea, id: '3', status: 'closed' as const, due_date: '2020-01-01' },
    ];
    const stats = computeTaskStats(tareas);
    expect(stats.total).toBe(3);
    expect(stats.completed).toBe(2);
    expect(stats.open).toBe(1);
    expect(stats.progress).toBe(67);
  });
});
