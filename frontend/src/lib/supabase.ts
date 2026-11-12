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

// sb-011: auth.storage síncrono de supabase-js. El preload siembra el blob
// de sesión (leído descifrado del proceso principal mediante sendSync) en
// window.supabaseSessionSeed ANTES de que este módulo se evalúe; escrituras
// van a memoria y persisten cifradas vía supabase_session_put. Así el
// refresh token no reposa en texto claro en localStorage. En navegador
// (dev web) no hay semilla ni bridge y se conserva el localStorage clásico.
type SessionBlob = Record<string, string>;

interface ElectronBridge {
  invoke: (method: string, params?: Record<string, unknown> | object) => Promise<unknown>;
}

function electronBridge(): ElectronBridge | null {
  const bridge = (globalThis as unknown as { window?: { electronAPI?: ElectronBridge } }).window
    ?.electronAPI;
  return bridge && typeof bridge.invoke === 'function' ? bridge : null;
}

function seedBlob(): SessionBlob | null {
  const seed = (
    globalThis as unknown as { window?: { supabaseSessionSeed?: unknown } }
  ).window?.supabaseSessionSeed;
  return seed && typeof seed === 'object' && !Array.isArray(seed) ? (seed as SessionBlob) : null;
}

export function createSecureSupabaseStorage(): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
} | null {
  const seeded = seedBlob();
  const bridge = electronBridge();
  if (!seeded || !bridge) return null;
  const blob: SessionBlob = { ...seeded };
  const persist = () => {
    void bridge.invoke('supabase_session_put', { blob: { ...blob } }).catch(() => {
      // Si main no puede cifrar, la sesión queda en memoria: no se degrada a
      // texto claro en disco; el usuario vuelve a iniciar sesión al reiniciar.
    });
  };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(blob, key) ? blob[key] : null),
    setItem: (key, value) => {
      blob[key] = value;
      persist();
    },
    removeItem: (key) => {
      delete blob[key];
      persist();
    },
  };
}

const secureStorage = createSecureSupabaseStorage();

export const supabase: SupabaseClient | null = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        ...(secureStorage ? { storage: secureStorage } : {}),
      },
    })
  : null;
