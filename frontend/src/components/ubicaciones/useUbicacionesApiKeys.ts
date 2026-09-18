import { useEffect, useRef, useState } from 'react';

import { api } from '../../api';
import { clearPlaintextApiKeys, readPlaintextApiKeys } from './ubicacionesTypes';

export function useUbicacionesApiKeys() {
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [keysConfigured, setKeysConfigured] = useState<Record<string, boolean>>({});
  const apiKeysHydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const migrated = readPlaintextApiKeys();
        if (Object.keys(migrated).length > 0) {
          try {
            await api.ubicacionesKeysSet(migrated);
          } catch (err) {
            console.error('Failed to migrate ubicaciones API keys', err);
          }
          clearPlaintextApiKeys();
        }

        const { keys: secureKeys, configured } = await api.ubicacionesKeysGet();
        if (cancelled) return;

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

  return { apiKeys, setApiKeys, keysConfigured };
}
