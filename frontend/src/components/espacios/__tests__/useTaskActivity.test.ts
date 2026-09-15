import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskComment } from '../types';

const mocks = vi.hoisted(() => ({
  fetchComments: vi.fn(), fetchActivity: vi.fn(), createComment: vi.fn(),
  subscribe: vi.fn(), unsubscribe: vi.fn(), handlers: new Map<string, (payload: unknown) => void>(),
}));

vi.mock('../api/espaciosApi', () => ({
  fetchTaskComments: (...args: unknown[]) => mocks.fetchComments(...args),
  fetchTaskActivity: (...args: unknown[]) => mocks.fetchActivity(...args),
  createTaskComment: (...args: unknown[]) => mocks.createComment(...args),
}));
vi.mock('../api/realtime', () => ({
  subscribeTaskActivity: (id: string, handler: (payload: unknown) => void) => {
    mocks.handlers.set(id, handler);
    return mocks.subscribe(id);
  },
  unsubscribeEspaciosSync: (...args: unknown[]) => mocks.unsubscribe(...args),
}));

import { useTaskActivity } from '../hooks/useTaskActivity';

const comment = (id: string, tareaId = 'task-1'): TaskComment => ({
  id, tarea_id: tareaId, author_id: 'user-1', author_name: 'Enzo', body: id,
  created_at: '2026-09-15T10:00:00Z', updated_at: '2026-09-15T10:00:00Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.fetchComments.mockImplementation(async (id: string) => [comment(`comment-${id}`, id)]);
  mocks.fetchActivity.mockResolvedValue([]);
  mocks.subscribe.mockImplementation((id: string) => ({ id }));
});

describe('useTaskActivity', () => {
  it('adds a realtime comment once even when the insert is echoed twice', async () => {
    const { result } = renderHook(() => useTaskActivity('task-1', 'user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const incoming = comment('realtime');
    act(() => {
      const handler = mocks.handlers.get('task-1')!;
      handler({ eventType: 'INSERT', table: 'tarea_comments', new: incoming, old: null });
      handler({ eventType: 'INSERT', table: 'tarea_comments', new: incoming, old: null });
    });
    expect(result.current.comments.filter((item) => item.id === 'realtime')).toHaveLength(1);
  });

  it('unsubscribes and clears the previous task when selection changes', async () => {
    const { result, rerender } = renderHook(({ id }) => useTaskActivity(id, 'user-1'), {
      initialProps: { id: 'task-1' },
    });
    await waitFor(() => expect(result.current.comments[0]?.tarea_id).toBe('task-1'));
    rerender({ id: 'task-2' });
    expect(result.current.comments).toEqual([]);
    await waitFor(() => expect(result.current.comments[0]?.tarea_id).toBe('task-2'));
    expect(mocks.unsubscribe).toHaveBeenCalledWith({ id: 'task-1' });
  });

  it('surfaces load errors and retries without blocking the task editor', async () => {
    mocks.fetchComments.mockRejectedValueOnce(new Error('Sin conexión'));
    const { result } = renderHook(() => useTaskActivity('task-1', 'user-1'));
    await waitFor(() => expect(result.current.error).toBe('Sin conexión'));
    await act(async () => { await result.current.retry(); });
    expect(result.current.error).toBeNull();
    expect(result.current.comments).toHaveLength(1);
  });
});
