import type { SupabaseClient } from '@supabase/supabase-js';

let cached: Promise<SupabaseClient | null> | null = null;

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
