import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type { AppUser } from '../auth/types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  const msg =
    '[supabase] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en el entorno. ' +
    'En local: copia frontend/.env.example a frontend/.env.local y rellena los valores. ' +
    'En CI: configura los secrets VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en GitHub.';
  console.warn(msg);
}

export const supabase: SupabaseClient | null = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
