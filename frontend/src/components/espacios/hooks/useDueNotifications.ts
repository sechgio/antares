import { useCallback, useEffect, useState } from 'react';
import { fetchDueSoonTareas } from '../api/espaciosApi';
import { supabase } from '../../../lib/supabase';
import { addDaysToIsoDate, localTodayString } from '../utils/dates';
import {
  collectDueNotifications,
  DUE_SOON_DAYS,
  type DueNotification,
} from '../utils/dueNotifications';

const POLL_MS = 5 * 60 * 1000;

export function useDueNotifications(enabled = true) {
  const [items, setItems] = useState<DueNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !supabase) {
      setItems([]);
      setError(null);
      return;
    }

    setLoading(true);
    try {
      const today = localTodayString();
      const horizon = addDaysToIsoDate(today, DUE_SOON_DAYS);
      const rows = await fetchDueSoonTareas(horizon);
      setItems(collectDueNotifications(rows, { today, soonDays: DUE_SOON_DAYS }));
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudieron cargar las notificaciones';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      return;
    }

    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, refresh]);

  return { items, count: items.length, loading, error, refresh };
}
