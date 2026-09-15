import { describe, expect, it } from 'vitest';
import type { BoardColumn, TaskActivity, TaskComment, TeamMember } from '../types';
import { activityDescription, mergeTaskTimeline } from '../utils/taskActivity';

const members: TeamMember[] = [
  { user_id: 'u1', display_name: 'Enzo' },
  { user_id: 'u2', display_name: 'María' },
];
const columns: BoardColumn[] = [
  { id: 'c1', proyecto_id: 'p1', key: 'todo', name: 'Pendiente', color: '#777', sort_order: 0, is_done: false, is_system: true, created_at: '', updated_at: '' },
  { id: 'c2', proyecto_id: 'p1', key: 'review', name: 'En revisión', color: '#555', sort_order: 1, is_done: false, is_system: false, created_at: '', updated_at: '' },
];

const activity = (patch: Partial<TaskActivity>): TaskActivity => ({
  id: 'a1', tarea_id: 't1', actor_id: 'u2', actor_name: 'María', event_type: 'field_changed', field_name: 'status',
  old_value: 'todo', new_value: 'review', created_at: '2026-09-15T10:00:00Z', ...patch,
});

describe('task activity formatting', () => {
  it('uses project column names for status changes', () => {
    expect(activityDescription(activity({}), members, columns)).toEqual({
      label: 'Cambió el estado', oldValue: 'Pendiente', newValue: 'En revisión',
    });
  });

  it('uses readable priority, assignee and date values', () => {
    expect(activityDescription(activity({ field_name: 'priority', old_value: 'normal', new_value: 'urgent' }), members, columns).newValue).toBe('Urgente');
    expect(activityDescription(activity({ field_name: 'assignee_id', old_value: 'u1', new_value: 'u2' }), members, columns)).toMatchObject({ oldValue: 'Enzo', newValue: 'María' });
    expect(activityDescription(activity({ field_name: 'due_date', old_value: null, new_value: '2026-09-20' }), members, columns).newValue).toMatch(/20/);
  });

  it('labels missing users without exposing UUIDs', () => {
    expect(activityDescription(activity({ field_name: 'assignee_id', new_value: 'deleted-user' }), members, columns).newValue).toBe('Usuario eliminado');
  });
});

describe('mergeTaskTimeline', () => {
  it('orders comments and activity chronologically and suppresses duplicate comment-created activity', () => {
    const comment: TaskComment = {
      id: 'comment-1', tarea_id: 't1', author_id: 'u1', author_name: 'Enzo', body: 'Falta revisar las fotografías.',
      created_at: '2026-09-15T10:05:00Z', updated_at: '2026-09-15T10:05:00Z',
    };
    const items = mergeTaskTimeline([comment], [
      activity({ id: 'change', created_at: '2026-09-15T10:00:00Z' }),
      activity({ id: 'comment-event', event_type: 'comment_created', field_name: null, old_value: null, new_value: { comment_id: 'comment-1' }, created_at: '2026-09-15T10:05:00Z' }),
    ]);
    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual(['activity:change', 'comment:comment-1']);
  });
});
