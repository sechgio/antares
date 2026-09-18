import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { reportFrontendError } from '../utils/observability';

export type { AppUser } from '../auth/types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  const msg =
    '[supabase] Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en el entorno. ' +
    'En local: copia frontend/.env.example a frontend/.env.local y rellena los valores. ' +
    'En CI: configura los secrets VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en GitHub.';
  console.warn(msg);
  reportFrontendError({
    kind: 'app_error',
    view: 'supabase',
    name: 'ConfigError',
    message: 'Supabase env vars missing (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)',
  });
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
