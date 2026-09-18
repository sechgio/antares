import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createTaskComment, fetchTaskActivity, fetchTaskComments } from '../api/espaciosApi';
import { subscribeTaskActivity, unsubscribeEspaciosSync } from '../api/realtime';
import type { TaskActivity, TaskComment } from '../types';
import { mergeTaskTimeline } from '../utils/taskActivity';
import { errorMessage } from '../../../utils/errors';

const message = errorMessage;

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const rows = new Map(current.map((row) => [row.id, row]));
  for (const row of incoming) rows.set(row.id, row);
  return [...rows.values()].sort((a, b) => {
    const left = 'created_at' in a ? String(a.created_at) : '';
    const right = 'created_at' in b ? String(b.created_at) : '';
    return left.localeCompare(right) || a.id.localeCompare(b.id);
  });
}

function isComment(value: unknown): value is TaskComment {
  return Boolean(value && typeof value === 'object' && typeof (value as TaskComment).id === 'string'
    && typeof (value as TaskComment).tarea_id === 'string' && typeof (value as TaskComment).body === 'string');
}

function isActivity(value: unknown): value is TaskActivity {
  return Boolean(value && typeof value === 'object' && typeof (value as TaskActivity).id === 'string'
    && typeof (value as TaskActivity).tarea_id === 'string' && typeof (value as TaskActivity).event_type === 'string');
}

export function useTaskActivity(tareaId: string, userId: string) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const [nextComments, nextActivity] = await Promise.all([
        fetchTaskComments(tareaId),
        fetchTaskActivity(tareaId),
      ]);
      if (request !== requestRef.current) return;
      setComments((current) => mergeById(nextComments, current));
      setActivity((current) => mergeById(nextActivity, current));
    } catch (loadError) {
      if (request === requestRef.current) setError(message(loadError, 'No se pudo cargar la actividad'));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [tareaId]);

  useEffect(() => {
    requestRef.current += 1;
    setComments([]);
    setActivity([]);
    setError(null);
    void load();
    const channel = subscribeTaskActivity(tareaId, ({ eventType, table, new: row, old }) => {
      const id = eventType === 'DELETE' ? old?.id : row?.id;
      if (typeof id !== 'string') return;
      if (table === 'tarea_comments') {
        if (eventType === 'DELETE') setComments((current) => current.filter((item) => item.id !== id));
        else if (isComment(row)) setComments((current) => mergeById(current, [row]));
      }
      if (table === 'tarea_activity' && eventType !== 'DELETE' && isActivity(row)) {
        setActivity((current) => mergeById(current, [row]));
      }
    });
    return () => {
      requestRef.current += 1;
      unsubscribeEspaciosSync(channel);
    };
  }, [load, tareaId]);

  const sendComment = useCallback(async (body: string) => {
    setSending(true);
    setSendError(null);
    try {
      const created = await createTaskComment(tareaId, body, userId);
      setComments((current) => mergeById(current, [created]));
    } catch (createError) {
      const text = message(createError, 'No se pudo enviar el comentario');
      setSendError(text);
      throw createError;
    } finally {
      setSending(false);
    }
  }, [tareaId, userId]);

  const timeline = useMemo(() => mergeTaskTimeline(comments, activity), [comments, activity]);
  return { comments, activity, timeline, loading, error, sending, sendError, sendComment, retry: load };
}
