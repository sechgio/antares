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
});
