import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';

export type RealtimeHandler = (payload: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}) => void;

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

  return subscribeChannel(channel, onStatus);
}

export function subscribeDueNotifications(
  onChange: RealtimeHandler,
  onStatus?: (status: RealtimeStatus) => void,
): RealtimeChannel | null {
  if (!supabase) {
    onStatus?.('offline');
    return null;
  }

  let channel = supabase.channel('due-notifications');

  channel = channel
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tareas' },
      onTable('tareas', onChange),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'board_columns' },
      onTable('board_columns', onChange),
    );

  return subscribeChannel(channel, onStatus);
}

function subscribeChannel(channel: RealtimeChannel, onStatus?: (status: RealtimeStatus) => void): RealtimeChannel {
  onStatus?.('connecting');
  return channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') onStatus?.('live');
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onStatus?.('error');
    else if (status === 'CLOSED') onStatus?.('offline');
  });
}

export function subscribeTaskActivity(
  tareaId: string,
  onChange: RealtimeHandler,
  onStatus?: (status: RealtimeStatus) => void,
): RealtimeChannel | null {
  if (!supabase) {
    onStatus?.('offline');
    return null;
  }

  let channel = supabase.channel(`task-activity:${tareaId}`);
  channel = channel
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tarea_comments', filter: `tarea_id=eq.${tareaId}` },
      onTable('tarea_comments', onChange),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tarea_activity', filter: `tarea_id=eq.${tareaId}` },
      onTable('tarea_activity', onChange),
    );

  return subscribeChannel(channel, onStatus);
}

export function subscribeMyTasks(
  userId: string,
  onChange: RealtimeHandler,
  onStatus?: (status: RealtimeStatus) => void,
): RealtimeChannel | null {
  if (!supabase) {
    onStatus?.('offline');
    return null;
  }

  // UPDATE filters only see the new row, so assignee_id=eq.userId would miss
  // a task reassigned away from this user. One invalidation channel covers the
  // four source tables and lets RLS keep inaccessible rows out of the stream.
  let channel = supabase.channel(`my-tasks:${userId}`);
  for (const table of ['tareas', 'proyectos', 'espacios', 'board_columns']) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      onTable(table, onChange),
    );
  }

  return subscribeChannel(channel, onStatus);
}

export function unsubscribeEspaciosSync(channel: RealtimeChannel | null): void {
  if (!supabase || !channel) return;
  void supabase.removeChannel(channel);
}
