import type { SupabaseClient } from '@supabase/supabase-js';

let cached: Promise<SupabaseClient | null> | null = null;

// Mantiene @supabase/supabase-js fuera del grafo estático del chunk de canvas.
export function getSupabaseClient(): Promise<SupabaseClient | null> {
  cached ??= import('./supabase').then((m) => m.supabase);
  return cached;
}
