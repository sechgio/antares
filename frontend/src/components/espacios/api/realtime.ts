import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';

export type RealtimeHandler = (payload: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}) => void;

/** Connection health for UI badge. */
export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'error' | 'offline';

function onTable(table: string, onChange: RealtimeHandler) {
  return (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
    onChange({
      eventType: payload.eventType,
      table,
      new: payload.new,
      old: payload.old,
    });
  };
}

export function subscribeEspaciosSync(
  espacioId: string | null,
  proyectoId: string | null,
  onChange: RealtimeHandler,
  onStatus?: (status: RealtimeStatus) => void,
): RealtimeChannel | null {
  if (!supabase) {
    onStatus?.('offline');
    return null;
  }

  let channel = supabase.channel(`espacios-sync:${espacioId ?? 'none'}:${proyectoId ?? 'none'}`);

  channel = channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'espacios' },
    onTable('espacios', onChange),
  );

  if (espacioId) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'proyectos', filter: `espacio_id=eq.${espacioId}` },
      onTable('proyectos', onChange),
    );
  }

  if (proyectoId) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tareas', filter: `proyecto_id=eq.${proyectoId}` },
      onTable('tareas', onChange),
    );
    channel = channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'board_columns',
        filter: `proyecto_id=eq.${proyectoId}`,
      },
      onTable('board_columns', onChange),
    );
  }

  onStatus?.('connecting');
  return channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') onStatus?.('live');
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus?.('error');
    else if (status === 'CLOSED') onStatus?.('offline');
  });
}

export function unsubscribeEspaciosSync(channel: RealtimeChannel | null): void {
  if (!supabase || !channel) return;
  void supabase.removeChannel(channel);
}
