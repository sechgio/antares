import { useState, useEffect, useCallback } from 'react';
import { api, onNotify } from '../api';
import { ProcessStatus } from '../types';
import type { ProcessBody } from '../api';

export function useProcessRunner() {
  const [status, setStatus] = useState<ProcessStatus | null>(null);
  const [running, setRunning] = useState(false);

  const pollStatus = useCallback(async () => {
    try {
      const s = await api.getStatus();
      setStatus(s);
      setRunning(s.running);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const unsub = onNotify((method, params) => {
      if (!params || typeof params !== 'object' || Array.isArray(params)) return;
      const p = params as Record<string, unknown>;
      const safeKeys = new Set(['running', 'progress', 'current_file', 'ok_count', 'err_count', 'logs']);
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p)) {
        if (safeKeys.has(k)) filtered[k] = v;
      }
      if (method === 'process.progress') {
        setStatus((prev) => prev ? { ...prev, ...filtered } as ProcessStatus : null);
      } else if (method === 'process.complete') {
        setStatus((prev) => prev ? { ...prev, running: false, progress: 100, ...filtered } as ProcessStatus : null);
        setRunning(false);
      }
    });
    return unsub;
  }, []);

  const startProcess = useCallback(async (body: ProcessBody) => {
    await api.startProcess(body);
    setRunning(true);
    pollStatus();
  }, [pollStatus]);

  const cancelProcess = useCallback(async () => {
    await api.cancelProcess();
    pollStatus();
  }, [pollStatus]);

  return { status, running, pollStatus, startProcess, cancelProcess };
}
