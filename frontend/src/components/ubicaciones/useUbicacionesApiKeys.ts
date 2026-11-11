import { useEffect, useRef, useState } from 'react';

import { api } from '../../api';
import { clearPlaintextApiKeys, LS_API_KEYS, LS_GOOGLE_MAPS_KEY } from './ubicacionesTypes';

// frontend-app-010: la migración de una sola pasada es el único lector de las
// claves en claro; el backend pasa a ser la fuente y el storage local se
// purga en finally, con o sin éxito de la subida.
function readLegacyPlaintextApiKeys(): Record<string, string> {
  try {
    const saved = localStorage.getItem(LS_API_KEYS);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string' && v.trim()) out[k] = v;
        }
        return out;
      }
    }
    const oldGoogleKey = localStorage.getItem(LS_GOOGLE_MAPS_KEY);
    if (oldGoogleKey) return { google: oldGoogleKey };
  } catch {
  }
  return {};
}

export async function migratePlaintextApiKeys(): Promise<void> {
  const migrated = readLegacyPlaintextApiKeys();
  if (Object.keys(migrated).length === 0) return;
  try {
    await api.ubicacionesKeysSet(migrated);
  } catch (err) {
    console.error('Failed to migrate ubicaciones API keys', err);
  } finally {
    clearPlaintextApiKeys();
  }
}

export function useUbicacionesApiKeys() {
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [keysConfigured, setKeysConfigured] = useState<Record<string, boolean>>({});
  const [storageConfidential, setStorageConfidential] = useState(true);
  const apiKeysHydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await migratePlaintextApiKeys();

        const { keys: secureKeys, configured, storage_confidential } = await api.ubicacionesKeysGet();
        if (cancelled) return;
        setStorageConfidential(storage_confidential !== false);

        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(secureKeys || {})) {
          if (configured?.[k]) next[k] = '';
          else if (typeof v === 'string' && v && !v.startsWith('••••')) next[k] = v;
        }
        setApiKeys(next);
        setKeysConfigured(configured || {});
      } catch (err) {
        console.error('Failed to load ubicaciones API keys', err);
        clearPlaintextApiKeys();
      } finally {
        if (!cancelled) apiKeysHydratedRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!apiKeysHydratedRef.current) return;
    const dirty: Record<string, string> = {};
    for (const [k, v] of Object.entries(apiKeys)) {
      const s = String(v || '').trim();
      if (s && !s.startsWith('••••')) dirty[k] = s;
    }
    if (Object.keys(dirty).length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.ubicacionesKeysSet(dirty).then((resp) => {
        if (cancelled) return;
        if (resp?.configured) setKeysConfigured(resp.configured);
        setApiKeys((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(dirty)) next[k] = '';
          return next;
        });
      }).catch((err) => {
        console.error('Failed to persist ubicaciones API keys', err);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [apiKeys]);

  return { apiKeys, setApiKeys, keysConfigured, storageConfidential };
}
