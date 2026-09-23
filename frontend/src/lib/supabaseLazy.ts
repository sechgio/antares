import type { SupabaseClient } from '@supabase/supabase-js';

let cached: Promise<SupabaseClient | null> | null = null;

// Mantiene @supabase/supabase-js fuera del grafo estático del chunk de canvas.
export function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (!cached) {
    const pending = import('./supabase').then((m) => m.supabase);
    cached = pending;
    void pending.catch(() => {
      if (cached === pending) cached = null;
    });
  }
  return cached;
}
