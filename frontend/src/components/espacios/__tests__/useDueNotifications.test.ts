import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchDueSoonTareas = vi.fn();
const subscribeDueNotifications = vi.fn();
const unsubscribeEspaciosSync = vi.fn();

vi.mock('../api/espaciosApi', () => ({
  fetchDueSoonTareas: (...args: unknown[]) => fetchDueSoonTareas(...args),
}));

vi.mock('../api/realtime', () => ({
  subscribeDueNotifications: (...args: unknown[]) => subscribeDueNotifications(...args),
  unsubscribeEspaciosSync: (...args: unknown[]) => unsubscribeEspaciosSync(...args),
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {},
}));

import { useDueNotifications } from '../hooks/useDueNotifications';
import { emitDueNotificationsInvalidate } from '../utils/dueNotificationsBus';

describe('useDueNotifications', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    fetchDueSoonTareas.mockResolvedValue([
      {
        id: 't1',
        title: 'Urgente',
        due_date: '2026-07-09',
        status: 'todo',
        proyecto_id: 'p1',
        proyecto_name: 'Obra',
        espacio_id: 'e1',
        espacio_name: 'Espacio',
      },
    ]);
    subscribeDueNotifications.mockReturnValue({ id: 'ch-due' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads on mount and subscribes to realtime', async () => {
    const { result } = renderHook(() => useDueNotifications(true));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchDueSoonTareas).toHaveBeenCalled();
    expect(subscribeDueNotifications).toHaveBeenCalledTimes(1);
    expect(result.current.count).toBe(1);
    expect(result.current.items[0]?.title).toBe('Urgente');
  });

  it('debounces realtime-driven refresh', async () => {
    let onChange: (() => void) | undefined;
    subscribeDueNotifications.mockImplementation((cb: () => void) => {
      onChange = cb;
      return { id: 'ch-due' };
    });

    renderHook(() => useDueNotifications(true));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const callsAfterMount = fetchDueSoonTareas.mock.calls.length;

    act(() => {
      onChange?.();
      onChange?.();
      onChange?.();
    });

    expect(fetchDueSoonTareas.mock.calls.length).toBe(callsAfterMount);

    await act(async () => {
      vi.advanceTimersByTime(350);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchDueSoonTareas.mock.calls.length).toBe(callsAfterMount + 1);
  });

  it('refetches on local invalidate (same-window Espacios mutations)', async () => {
    renderHook(() => useDueNotifications(true));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const callsAfterMount = fetchDueSoonTareas.mock.calls.length;

    act(() => {
      emitDueNotificationsInvalidate();
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchDueSoonTareas.mock.calls.length).toBe(callsAfterMount + 1);
  });

  it('descarta el fetch en vuelo y limpia cuando se deshabilita', async () => {
    let resolveRows: ((rows: unknown[]) => void) | null = null;
    fetchDueSoonTareas.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRows = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useDueNotifications(enabled),
      { initialProps: { enabled: true } },
    );

    await act(async () => {
      await Promise.resolve();
    });

    rerender({ enabled: false });

    await act(async () => {
      resolveRows?.([
        {
          id: 't1',
          title: 'De la cuenta anterior',
          due_date: '2026-07-09',
          status: 'todo',
          proyecto_id: 'p1',
          proyecto_name: 'Obra',
          espacio_id: 'e1',
          espacio_name: 'Espacio',
        },
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('unsubscribes on unmount', async () => {
    const channel = { id: 'ch-due' };
    subscribeDueNotifications.mockReturnValue(channel);

    const { unmount } = renderHook(() => useDueNotifications(true));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    unmount();
    expect(unsubscribeEspaciosSync).toHaveBeenCalledWith(channel);
  });

  it('filters personal notifications and discards a response from the previous scope', async () => {
    let resolveTeam: ((rows: unknown[]) => void) | undefined;
    fetchDueSoonTareas.mockImplementationOnce(() => new Promise((resolve) => { resolveTeam = resolve; }));
    const { result, rerender } = renderHook(
      ({ assigneeId }: { assigneeId: string | undefined }) => useDueNotifications(true, assigneeId, 'u1'),
      { initialProps: { assigneeId: undefined as string | undefined } },
    );
    rerender({ assigneeId: 'u1' });
    await act(async () => { await Promise.resolve(); });
    expect(fetchDueSoonTareas).toHaveBeenLastCalledWith(expect.any(String), 'u1');
    await act(async () => {
      resolveTeam?.([{ id: 'team', title: 'Otra persona', due_date: '2026-07-09', status: 'todo', proyecto_id: 'p1' }]);
      await Promise.resolve();
    });
    expect(result.current.items.map((item) => item.id)).toEqual(['t1']);
  });

  it('clears the previous account items while a replacement session loads', async () => {
    const { result, rerender } = renderHook(
      ({ userId }) => useDueNotifications(true, undefined, userId),
      { initialProps: { userId: 'u1' } },
    );
    await act(async () => { await Promise.resolve(); });
    expect(result.current.count).toBe(1);
    let resolvePrevious: ((rows: unknown[]) => void) | undefined;
    fetchDueSoonTareas.mockImplementationOnce(() => new Promise((resolve) => { resolvePrevious = resolve; }));
    act(() => { void result.current.refresh(); });
    fetchDueSoonTareas.mockImplementationOnce(() => new Promise(() => {}));
    rerender({ userId: 'u2' });
    expect(result.current.items).toEqual([]);
    expect(result.current.loading).toBe(true);
    await act(async () => {
      resolvePrevious?.([{ id: 'old', title: 'Cuenta anterior', due_date: '2026-07-09', status: 'todo', proyecto_id: 'p1' }]);
      await Promise.resolve();
    });
    expect(result.current.items).toEqual([]);
  });
});
