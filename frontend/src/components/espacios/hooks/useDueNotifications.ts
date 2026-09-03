import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDueSoonTareas } from '../api/espaciosApi';
import { subscribeDueNotifications, unsubscribeEspaciosSync } from '../api/realtime';
import { supabase } from '../../../lib/supabase';
import { addDaysToIsoDate, localTodayString } from '../utils/dates';
import {
  collectDueNotifications,
  DUE_SOON_DAYS,
  type DueNotification,
} from '../utils/dueNotifications';
import { onDueNotificationsInvalidate } from '../utils/dueNotificationsBus';

const POLL_MS = 5 * 60 * 1000;
const REALTIME_DEBOUNCE_MS = 350;

export function useDueNotifications(enabled = true) {
  const [items, setItems] = useState<DueNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !supabase) {
      setItems([]);
      setError(null);
      return;
    }

    const requestId = ++inFlightRef.current;
    setLoading(true);
    try {
      const today = localTodayString();
      const horizon = addDaysToIsoDate(today, DUE_SOON_DAYS);
      const rows = await fetchDueSoonTareas(horizon);
      if (requestId !== inFlightRef.current) return;
      setItems(collectDueNotifications(rows, { today, soonDays: DUE_SOON_DAYS }));
      setError(null);
    } catch (err) {
      if (requestId !== inFlightRef.current) return;
      const message = err instanceof Error ? err.message : 'No se pudieron cargar las notificaciones';
      setError(message);
    } finally {
      if (requestId === inFlightRef.current) setLoading(false);
    }
  }, [enabled]);

  const scheduleRefresh = useCallback(() => {
    if (debounceTimerRef.current != null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void refresh();
    }, REALTIME_DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      return;
    }

    void refresh();

    const channel = subscribeDueNotifications(scheduleRefresh);
    const unsubLocal = onDueNotificationsInvalidate(scheduleRefresh);

    const interval = window.setInterval(() => void refresh(), POLL_MS);

    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (debounceTimerRef.current != null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      unsubLocal();
      unsubscribeEspaciosSync(channel);
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, refresh, scheduleRefresh]);

  return { items, count: items.length, loading, error, refresh };
}
