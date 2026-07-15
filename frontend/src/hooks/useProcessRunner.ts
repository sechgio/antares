import { useState, useEffect, useCallback } from 'react';
import { api, onNotify } from '../api';
import { ProcessStatus } from '../types';
import type { ProcessBody } from '../api';

function emptyStatus(): ProcessStatus {
  return {
    running: false,
    progress: 0,
    current_file: '',
    ok_count: 0,
    err_count: 0,
    logs: [],
  };
}

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
      // Backend lifecycle: handle before params filter so empty/undefined params still reset.
      if (method === 'backend.restarting' || method === 'backend.fatal' || method === 'backend.error') {
        setRunning(false);
        setStatus((prev) => (prev ? { ...prev, running: false } : prev));
        return;
      }

      if (!params || typeof params !== 'object' || Array.isArray(params)) return;
      const p = params as Record<string, unknown>;
      const safeKeys = new Set(['running', 'progress', 'current_file', 'ok_count', 'err_count', 'logs', 'cancelled']);
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p)) {
        if (safeKeys.has(k)) filtered[k] = v;
      }
      if (method === 'process.progress') {
        setStatus((prev) => ({ ...(prev ?? emptyStatus()), ...filtered, running: true } as ProcessStatus));
        setRunning(true);
      } else if (method === 'process.complete') {
        const cancelled = p.cancelled === true;
        setStatus((prev) => {
          const base = prev ?? emptyStatus();
          const progress = cancelled
            ? (typeof filtered.progress === 'number' ? filtered.progress as number : base.progress)
            : (typeof filtered.progress === 'number' ? filtered.progress as number : 100);
          return { ...base, ...filtered, running: false, progress } as ProcessStatus;
        });
        setRunning(false);
      }
    });
    return unsub;
  }, []);

  const startProcess = useCallback(async (body: ProcessBody) => {
    // Flip running optimistically BEFORE the await: api.startProcess can block
    // up to ~30s while the backend boots (waitForReady), and the start button
    // is gated on `running`. Setting it after the await left the button enabled
    // during that window, so a second click enqueued a second process_start.
    setRunning(true);
    setStatus((prev) => ({ ...(prev ?? emptyStatus()), running: true, progress: 0 }));
    try {
      const result = await api.startProcess(body);
      if (!result?.started) {
        if (result?.reason === 'already_running') {
          await pollStatus();
          return result;
        }
        setRunning(false);
        setStatus((prev) => (prev ? { ...prev, running: false } : emptyStatus()));
        return result;
      }
      await pollStatus();
      return result;
    } catch (err) {
      setRunning(false);
      setStatus((prev) => (prev ? { ...prev, running: false } : null));
      throw err;
    }
  }, [pollStatus]);

  const cancelProcess = useCallback(async () => {
    await api.cancelProcess();
    pollStatus();
  }, [pollStatus]);

  return { status, running, pollStatus, startProcess, cancelProcess };
}
