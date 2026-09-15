import { describe, expect, it } from 'vitest';
import type { MyTask } from '../types';
import { filterMyTasks, groupMyTasks } from '../utils/myTasks';

const task = (patch: Partial<MyTask>): MyTask => ({
  id: 'task', proyecto_id: 'project-1', title: 'Revisar informe', description: null,
  status: 'todo', status_name: 'Pendiente', status_is_done: false, priority: 'normal',
  assignee_id: 'user-1', start_date: null, due_date: null, sort_order: 0,
  created_by: 'user-1', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z',
  proyecto_name: 'Sedapal Norte', espacio_id: 'space-1', espacio_name: 'Informes',
  ...patch,
});

describe('groupMyTasks', () => {
  it('groups overdue, today, this week, later and undated using local ISO days', () => {
    const rows = [
      task({ id: 'overdue', due_date: '2026-09-13' }),
      task({ id: 'today', due_date: '2026-09-14' }),
      task({ id: 'week', due_date: '2026-09-20' }),
      task({ id: 'later', due_date: '2026-09-21' }),
      task({ id: 'none', due_date: null }),
    ];
    const groups = groupMyTasks(rows, '2026-09-14');
    expect(groups.map((group) => [group.key, group.tasks.map((row) => row.id)])).toEqual([
      ['overdue', ['overdue']], ['today', ['today']], ['week', ['week']],
      ['later', ['later']], ['undated', ['none']],
    ]);
  });

  it('does not classify a completed past task as overdue', () => {
    expect(groupMyTasks([task({ due_date: '2026-09-01', status_is_done: true })], '2026-09-14')[0].tasks).toEqual([]);
  });

  it('keeps explicitly requested completed work in its own group', () => {
    const groups = groupMyTasks([task({ id: 'done', due_date: '2026-09-01', status_is_done: true })], '2026-09-14');
    expect(groups.find((group) => group.key === 'completed')?.tasks.map((row) => row.id)).toEqual(['done']);
  });
});

describe('filterMyTasks', () => {
  it('combines search, priority, completion, space and project filters', () => {
    const match = task({ id: 'match', priority: 'high' });
    const rows = [match, task({ id: 'wrong-space', espacio_id: 'space-2' }), task({ id: 'done', status_is_done: true })];
    expect(filterMyTasks(rows, {
      search: 'informe', priority: 'high', completion: 'open', espacioId: 'space-1', proyectoId: 'project-1',
    })).toEqual([match]);
  });

  it('excludes completed tasks by default', () => {
    expect(filterMyTasks([task({ id: 'open' }), task({ id: 'done', status_is_done: true })])).toHaveLength(1);
  });
});
