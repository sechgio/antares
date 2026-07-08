import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';

export type RealtimeHandler = (payload: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}) => void;

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
): RealtimeChannel | null {
  if (!supabase) return null;

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
  }

  return channel.subscribe();
}

export function unsubscribeEspaciosSync(channel: RealtimeChannel | null): void {
  if (!supabase || !channel) return;
  void supabase.removeChannel(channel);
}