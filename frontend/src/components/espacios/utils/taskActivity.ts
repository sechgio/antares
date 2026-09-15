import type { BoardColumn, TaskActivity, TaskActivityFieldName, TaskComment, TeamMember } from '../types';
import { formatDisplayDate } from './dates';
import { PRIORITY_OPTIONS } from './priority';
import { columnLabel } from './statusConfig';

export type TaskTimelineItem =
  | { kind: 'comment'; id: string; createdAt: string; comment: TaskComment }
  | { kind: 'activity'; id: string; createdAt: string; activity: TaskActivity };

const FIELD_LABELS: Record<TaskActivityFieldName, string> = {
  title: 'Cambió el título',
  description: 'Cambió la descripción',
  status: 'Cambió el estado',
  priority: 'Cambió la prioridad',
  assignee_id: 'Cambió el responsable',
  start_date: 'Cambió la fecha de inicio',
  due_date: 'Cambió el vencimiento',
};

function scalar(value: unknown): string | null {
  return typeof value === 'string' ? value : value == null ? null : String(value);
}

function memberName(value: unknown, members: TeamMember[]): string {
  const id = scalar(value);
  if (!id) return 'Sin asignar';
  return members.find((member) => member.user_id === id)?.display_name ?? 'Usuario eliminado';
}

function activityValue(field: TaskActivityFieldName | null, value: unknown, members: TeamMember[], columns: BoardColumn[]): string {
  const text = scalar(value);
  if (field === 'assignee_id') return memberName(value, members);
  if (field === 'status') return text ? columnLabel(columns, text) : 'Sin estado';
  if (field === 'priority') return PRIORITY_OPTIONS.find((option) => option.value === text)?.label ?? text ?? 'Sin valor';
  if (field === 'start_date' || field === 'due_date') return formatDisplayDate(text);
  return text?.trim() || 'Sin valor';
}

export function activityDescription(
  activity: TaskActivity,
  members: TeamMember[],
  columns: BoardColumn[],
): { label: string; oldValue?: string; newValue?: string } {
  if (activity.event_type === 'task_created') return { label: 'Creó la tarea' };
  if (activity.event_type === 'comment_created') return { label: 'Añadió un comentario' };
  return {
    label: activity.field_name ? FIELD_LABELS[activity.field_name] : 'Actualizó la tarea',
    oldValue: activityValue(activity.field_name, activity.old_value, members, columns),
    newValue: activityValue(activity.field_name, activity.new_value, members, columns),
  };
}

export function mergeTaskTimeline(comments: TaskComment[], activity: TaskActivity[]): TaskTimelineItem[] {
  const commentIds = new Set(comments.map((comment) => comment.id));
  const items: TaskTimelineItem[] = [
    ...comments.map((comment): TaskTimelineItem => ({ kind: 'comment', id: comment.id, createdAt: comment.created_at, comment })),
    ...activity
      .filter((entry) => {
        if (entry.event_type !== 'comment_created') return true;
        const value = entry.new_value;
        const commentId = value && typeof value === 'object' && 'comment_id' in value
          ? (value as { comment_id?: unknown }).comment_id
          : null;
        return typeof commentId !== 'string' || !commentIds.has(commentId);
      })
      .map((entry): TaskTimelineItem => ({ kind: 'activity', id: entry.id, createdAt: entry.created_at, activity: entry })),
  ];
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
