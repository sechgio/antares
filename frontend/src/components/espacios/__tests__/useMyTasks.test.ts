import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyTask } from '../types';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), fetchOrigins: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), realtime: undefined as undefined | (() => void),
}));
vi.mock('../api/espaciosApi', () => ({
  MY_TASKS_PAGE_SIZE: 2,
  fetchMyTasks: (...args: unknown[]) => mocks.fetch(...args),
  fetchMyTaskOrigins: () => mocks.fetchOrigins(),
}));
vi.mock('../api/realtime', () => ({
  subscribeMyTasks: (_userId: string, handler: () => void) => {
    mocks.realtime = handler;
    return mocks.subscribe();
  },
  unsubscribeEspaciosSync: (...args: unknown[]) => mocks.unsubscribe(...args),
}));

import { useMyTasks } from '../hooks/useMyTasks';

const row = { id: 'task-1', title: 'Informe' } as MyTask;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.realtime = undefined;
  mocks.fetch.mockResolvedValue([row]);
  mocks.fetchOrigins.mockResolvedValue([{
    proyecto_id: 'project-1', proyecto_name: 'Proyecto', espacio_id: 'space-1', espacio_name: 'Espacio',
  }]);
  mocks.subscribe.mockReturnValue({ id: 'channel' });
});

describe('useMyTasks', () => {
  it('loads one global query and exposes assigned tasks', async () => {
    const { result } = renderHook(() => useMyTasks('user-1', { completion: 'open' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tasks).toEqual([row]);
    expect(mocks.fetch).toHaveBeenCalledWith(expect.objectContaining({ completion: 'open' }), 0, 2);
    expect(result.current.hasAssignments).toBe(true);
  });

  it('surfaces an error and supports retry', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('No disponible'));
    const { result } = renderHook(() => useMyTasks('user-1', {}));
    await waitFor(() => expect(result.current.error).toBe('No disponible'));
    await act(async () => { await result.current.reload(); });
    expect(result.current.tasks).toEqual([row]);
    expect(result.current.error).toBeNull();
  });

  it('debounces realtime invalidations and replaces rows without duplicates', async () => {
    const { result } = renderHook(() => useMyTasks('user-1', {}));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { mocks.realtime?.(); mocks.realtime?.(); mocks.realtime?.(); });
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(result.current.tasks).toEqual([row]);
  });

  it('removes a task after realtime invalidation when it is reassigned away', async () => {
    const { result } = renderHook(() => useMyTasks('user-1', {}));
    await waitFor(() => expect(result.current.tasks).toEqual([row]));
    mocks.fetch.mockResolvedValueOnce([]);

    act(() => { mocks.realtime?.(); });

    await waitFor(() => expect(result.current.tasks).toEqual([]));
  });

  it('distinguishes no assignments from a filtered empty result', async () => {
    mocks.fetch.mockResolvedValue([]);
    mocks.fetchOrigins.mockResolvedValue([]);
    const { result } = renderHook(() => useMyTasks('user-1', {}));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasAssignments).toBe(false);
  });

  it('keeps loaded pages visible when realtime refreshes the current filters', async () => {
    const second = { ...row, id: 'task-2' };
    const third = { ...row, id: 'task-3' };
    mocks.fetch.mockResolvedValueOnce([row, second]).mockResolvedValueOnce([third]);
    const { result } = renderHook(() => useMyTasks('user-1', {}));
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.tasks).toHaveLength(3);

    mocks.fetch.mockResolvedValueOnce([row, second, { ...third, title: 'Actualizada' }]);
    act(() => { mocks.realtime?.(); });

    await waitFor(() => expect(result.current.tasks[2]?.title).toBe('Actualizada'));
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.anything(), 0, 3);
  });

  it('does not expose rows from the previous user while the next session loads', async () => {
    const { result, rerender } = renderHook(({ userId }) => useMyTasks(userId, {}), {
      initialProps: { userId: 'user-1' },
    });
    await waitFor(() => expect(result.current.tasks).toEqual([row]));
    mocks.fetch.mockReturnValueOnce(new Promise(() => {}));

    rerender({ userId: 'user-2' });

    expect(result.current.loading).toBe(true);
    expect(result.current.tasks).toEqual([]);
    expect(result.current.origins).toEqual([]);
  });
});
