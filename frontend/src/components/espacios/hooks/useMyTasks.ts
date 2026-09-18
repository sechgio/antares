import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMyTaskOrigins, fetchMyTasks, MY_TASKS_PAGE_SIZE } from '../api/espaciosApi';
import { subscribeMyTasks, unsubscribeEspaciosSync } from '../api/realtime';
import { DEFAULT_MY_TASKS_FILTERS, type MyTask, type MyTaskOrigin, type MyTasksFilters } from '../types';
import { errorMessage } from '../../../utils/errors';
import { nextRequest } from '../../../utils/async';

const MY_TASKS_ERROR_FALLBACK = 'No se pudieron cargar tus tareas';

function mergeKnown(current: MyTask[], incoming: MyTask[]): MyTask[] {
  const rows = new Map(current.map((task) => [task.id, task]));
  for (const task of incoming) rows.set(task.id, task);
  return [...rows.values()];
}

export function useMyTasks(userId: string | undefined, filters: Partial<MyTasksFilters>) {
  const resolved = useMemo<MyTasksFilters>(() => ({ ...DEFAULT_MY_TASKS_FILTERS, ...filters }), [
    filters.search, filters.priority, filters.completion, filters.espacioId, filters.proyectoId,
  ]);
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [origins, setOrigins] = useState<MyTaskOrigin[]>([]);
  const [loading, setLoading] = useState(Boolean(userId));
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [hasAssignments, setHasAssignments] = useState(false);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const tasksRef = useRef<MyTask[]>([]);
  const loadedFilterKeyRef = useRef<string | null>(null);
  const reloadRef = useRef<() => Promise<void>>(async () => {});
  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  tasksRef.current = tasks;
  const filterKey = JSON.stringify(resolved);

  const reload = useCallback(async () => {
    if (!userId) return;
    const guard = nextRequest(requestRef);
    setLoading(true);
    setError(null);
    try {
      const limit = loadedFilterKeyRef.current === filterKey
        ? Math.max(tasksRef.current.length, MY_TASKS_PAGE_SIZE)
        : MY_TASKS_PAGE_SIZE;
      const [rows, nextOrigins] = await Promise.all([
        fetchMyTasks(resolved, 0, limit),
        fetchMyTaskOrigins(),
      ]);
      if (!guard.isCurrent()) return;
      setTasks(rows);
      setOrigins(nextOrigins);
      setHasMore(rows.length === limit);
      setHasAssignments(nextOrigins.length > 0);
      loadedFilterKeyRef.current = filterKey;
    } catch (loadError) {
      if (guard.isCurrent()) setError(errorMessage(loadError, MY_TASKS_ERROR_FALLBACK));
    } finally {
      if (guard.isCurrent()) {
        setLoading(false);
        setLoadedUserId(userId);
      }
    }
  }, [filterKey, resolved, userId]);
  reloadRef.current = reload;

  useEffect(() => {
    if (!userId) {
      requestRef.current += 1;
      setTasks([]);
      setOrigins([]);
      setLoading(false);
      setLoadingMore(false);
      setHasMore(false);
      setHasAssignments(false);
      setLoadedUserId(null);
      loadedFilterKeyRef.current = null;
      setError(null);
      return;
    }
    const timer = setTimeout(() => void reload(), resolved.search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [reload, resolved.search, userId]);

  useEffect(() => {
    if (!userId) return;
    const channel = subscribeMyTasks(userId, () => {
      if (invalidateTimerRef.current) clearTimeout(invalidateTimerRef.current);
      invalidateTimerRef.current = setTimeout(() => void reloadRef.current(), 120);
    });
    return () => {
      if (invalidateTimerRef.current) clearTimeout(invalidateTimerRef.current);
      invalidateTimerRef.current = null;
      unsubscribeEspaciosSync(channel);
    };
  }, [userId]);

  const loadMore = useCallback(async () => {
    if (!userId || loadingMore || !hasMore) return;
    const request = requestRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const rows = await fetchMyTasks(resolved, tasks.length);
      if (request !== requestRef.current) return;
      setTasks((current) => mergeKnown(current, rows));
      setHasMore(rows.length === MY_TASKS_PAGE_SIZE);
    } catch (loadError) {
      if (request === requestRef.current) setError(errorMessage(loadError, MY_TASKS_ERROR_FALLBACK));
    } finally {
      if (request === requestRef.current) setLoadingMore(false);
    }
  }, [hasMore, loadingMore, resolved, tasks.length, userId]);

  const initialLoading = Boolean(userId) && (loading || loadedUserId !== userId);
  const sameUser = Boolean(userId) && loadedUserId === userId;
  return {
    tasks: sameUser ? tasks : [],
    origins: sameUser ? origins : [],
    loading: initialLoading,
    loadingMore,
    error,
    hasMore: sameUser && hasMore,
    hasAssignments: sameUser && hasAssignments,
    reload,
    loadMore,
  };
}
