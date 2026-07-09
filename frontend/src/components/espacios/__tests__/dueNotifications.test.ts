import { describe, expect, it } from 'vitest';
import {
  collectDueNotifications,
  isDoneLikeStatus,
  urgencyFromDays,
} from '../utils/dueNotifications';

describe('isDoneLikeStatus', () => {
  it('treats done and closed as finished', () => {
    expect(isDoneLikeStatus('done')).toBe(true);
    expect(isDoneLikeStatus('closed')).toBe(true);
    expect(isDoneLikeStatus('todo')).toBe(false);
    expect(isDoneLikeStatus('urgent')).toBe(false);
  });

  it('treats custom status as finished when marked is_done', () => {
    expect(isDoneLikeStatus('completada', { doneKeys: new Set(['completada', 'done', 'closed']) })).toBe(
      true,
    );
    expect(isDoneLikeStatus('completada')).toBe(false);
  });
});

describe('urgencyFromDays', () => {
  it('maps day deltas to urgency buckets', () => {
    expect(urgencyFromDays(-2)).toBe('overdue');
    expect(urgencyFromDays(0)).toBe('today');
    expect(urgencyFromDays(2)).toBe('soon');
  });
});

describe('collectDueNotifications', () => {
  const today = '2026-07-08';

  it('includes overdue, today and within soon window', () => {
    const items = collectDueNotifications(
      [
        { id: '1', title: 'Atrasada', due_date: '2026-07-05', status: 'todo', proyecto_id: 'p1', proyecto_name: 'Alpha' },
        { id: '2', title: 'Hoy', due_date: '2026-07-08', status: 'in_progress', proyecto_id: 'p1', proyecto_name: 'Alpha' },
        { id: '3', title: 'En 2 días', due_date: '2026-07-10', status: 'todo', proyecto_id: 'p2', proyecto_name: 'Beta' },
        { id: '4', title: 'Lejos', due_date: '2026-07-20', status: 'todo', proyecto_id: 'p2', proyecto_name: 'Beta' },
        { id: '5', title: 'Hecha', due_date: '2026-07-05', status: 'done', proyecto_id: 'p1', proyecto_name: 'Alpha' },
        { id: '6', title: 'Sin fecha', due_date: null, status: 'todo', proyecto_id: 'p1' },
      ],
      { today, soonDays: 3 },
    );

    expect(items.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(items[0].urgency).toBe('overdue');
    expect(items[0].daysUntil).toBe(-3);
    expect(items[1].urgency).toBe('today');
    expect(items[2].urgency).toBe('soon');
    expect(items[2].daysUntil).toBe(2);
  });

  it('sorts by soonest due date first', () => {
    const items = collectDueNotifications(
      [
        { id: 'b', title: 'B', due_date: '2026-07-09', status: 'todo', proyecto_id: 'p' },
        { id: 'a', title: 'A', due_date: '2026-07-07', status: 'todo', proyecto_id: 'p' },
      ],
      { today, soonDays: 3 },
    );
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('excludes custom is_done statuses when doneKeys provided', () => {
    const items = collectDueNotifications(
      [
        {
          id: '1',
          title: 'Custom done',
          due_date: '2026-07-05',
          status: 'completada',
          proyecto_id: 'p1',
        },
        {
          id: '2',
          title: 'Open',
          due_date: '2026-07-05',
          status: 'todo',
          proyecto_id: 'p1',
        },
      ],
      { today, soonDays: 3, doneKeys: new Set(['completada', 'done', 'closed']) },
    );
    expect(items.map((i) => i.id)).toEqual(['2']);
  });
});
