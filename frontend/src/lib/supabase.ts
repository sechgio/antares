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

type SessionBlob = Record<string, string>;

interface ElectronBridge {
  invoke: (method: string, params?: Record<string, unknown> | object) => Promise<unknown>;
}

function electronBridge(): ElectronBridge | null {
  const bridge = (globalThis as unknown as { window?: { electronAPI?: ElectronBridge } }).window?.electronAPI;
  return bridge && typeof bridge.invoke === 'function' ? bridge : null;
}

function migrateLegacyLocalStorageKeys(blob: SessionBlob, persist: () => void): void {
  try {
    const legacyKeys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith('sb-')) legacyKeys.push(key);
    }
    let migrated = false;
    for (const key of legacyKeys) {
      if (!Object.prototype.hasOwnProperty.call(blob, key)) {
        const value = window.localStorage.getItem(key);
        if (value !== null) {
          blob[key] = value;
          migrated = true;
        }
      }
      window.localStorage.removeItem(key);
    }
    if (migrated) persist();
  } catch {
    // Sin acceso a localStorage no hay nada que migrar; el storage seguro sigue activo.
  }
}

async function loadSeedBlob(bridge: ElectronBridge): Promise<SessionBlob> {
  try {
    const result = (await bridge.invoke('supabase_session_get')) as { blob?: unknown } | null;
    const seed = result && typeof result === 'object' ? result.blob : null;
    return seed && typeof seed === 'object' && !Array.isArray(seed) ? { ...(seed as SessionBlob) } : {};
  } catch {
    return {};
  }
}

export function createSecureSupabaseStorage(): {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
} | null {
  const bridge = electronBridge();
  if (!bridge) return null;
  let blob: SessionBlob = {};
  const persist = () => {
    void bridge.invoke('supabase_session_put', { blob: { ...blob } }).catch(() => {});
  };
  const ready: Promise<void> = (async () => {
    blob = await loadSeedBlob(bridge);
    migrateLegacyLocalStorageKeys(blob, persist);
  })();
  return {
    getItem: async (key) => {
      await ready;
      return Object.prototype.hasOwnProperty.call(blob, key) ? blob[key] : null;
    },
    setItem: async (key, value) => {
      await ready;
      blob[key] = value;
      persist();
    },
    removeItem: async (key) => {
      await ready;
      delete blob[key];
      persist();
    },
  };
}

const secureStorage = createSecureSupabaseStorage();

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          ...(secureStorage ? { storage: secureStorage } : {}),
        },
      })
    : null;
