import { describe, expect, it } from 'vitest';
import type { Tarea } from '../types';
import {
  buildBoardItems,
  computeInsertSortOrder,
  findContainer,
} from '../utils/boardLayout';
import { columnDropId } from '../utils/statusConfig';

function makeTarea(partial: Partial<Tarea> & Pick<Tarea, 'id' | 'status' | 'sort_order'>): Tarea {
  return {
    proyecto_id: 'p1',
    title: partial.id,
    description: null,
    assignee_id: null,
    start_date: null,
    due_date: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('buildBoardItems', () => {
  it('groups tasks by status and preserves sort_order', () => {
    const tareas = [
      makeTarea({ id: 'b', status: 'todo', sort_order: 2 }),
      makeTarea({ id: 'a', status: 'todo', sort_order: 1 }),
      makeTarea({ id: 'c', status: 'in_progress', sort_order: 1 }),
      makeTarea({ id: 'orphan', status: 'unknown', sort_order: 1 }),
    ];
    const items = buildBoardItems(tareas, ['todo', 'in_progress', 'done']);
    expect(items.todo).toEqual(['a', 'b']);
    expect(items.in_progress).toEqual(['c']);
    expect(items.done).toEqual([]);
    expect(items).not.toHaveProperty('unknown');
  });
});

describe('findContainer', () => {
  const items = {
    todo: ['t1', 't2'],
    in_progress: ['t3'],
  };

  it('resolves column drop ids and task ids', () => {
    expect(findContainer(items, columnDropId('todo'))).toBe('todo');
    expect(findContainer(items, 't3')).toBe('in_progress');
    expect(findContainer(items, 'missing')).toBeNull();
  });
});

describe('computeInsertSortOrder', () => {
  it('appends after last task when dropping on empty over target', () => {
    const tareas = [
      makeTarea({ id: 'a', status: 'todo', sort_order: 10 }),
      makeTarea({ id: 'b', status: 'todo', sort_order: 20 }),
    ];
    const map = new Map(tareas.map((t) => [t.id, t]));
    const items = buildBoardItems(tareas, ['todo', 'in_progress']);
    const order = computeInsertSortOrder(items, map, 'todo', 'x', null);
    expect(order).toBe(21);
  });

  it('inserts between neighbors when dropping over a task', () => {
    const tareas = [
      makeTarea({ id: 'a', status: 'todo', sort_order: 10 }),
      makeTarea({ id: 'b', status: 'todo', sort_order: 30 }),
      makeTarea({ id: 'moving', status: 'in_progress', sort_order: 1 }),
    ];
    const map = new Map(tareas.map((t) => [t.id, t]));
    const items = {
      todo: ['a', 'b'],
      in_progress: ['moving'],
    };
    const order = computeInsertSortOrder(items, map, 'todo', 'moving', 'b');
    expect(order).toBe(20);
  });
});
