import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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

function pickProcessFields(p: Record<string, unknown>): Partial<ProcessStatus> {
  const safeKeys = new Set(['running', 'progress', 'current_file', 'ok_count', 'err_count', 'logs', 'cancelled']);
  const filtered: Partial<ProcessStatus> = {};
  for (const [k, v] of Object.entries(p)) {
    if (!safeKeys.has(k)) continue;
    if (k === 'progress' && typeof v !== 'number') continue;
    (filtered as Record<string, unknown>)[k] = v;
  }
  return filtered;
}

function pollErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

export type ProcessRunnerPhase = 'idle' | 'running' | 'completed';

export type ProcessRunnerState =
  | { phase: 'idle'; status: ProcessStatus | null; pollError: string | null }
  | { phase: 'running'; status: ProcessStatus; pollError: string | null }
  | { phase: 'completed'; status: ProcessStatus; cancelled: boolean; pollError: string | null };

export interface ProcessRunnerHookResult {
  state: ProcessRunnerState;
  status: ProcessStatus | null;
  running: boolean;
  pollError: string | null;
  pollStatus: () => Promise<void>;
  startProcess: (body: ProcessBody) => Promise<{ started: boolean; reason?: string; job_id?: string } | undefined>;
  cancelProcess: () => Promise<void>;
}

export function useProcessRunner(): ProcessRunnerHookResult {
  const [status, setStatus] = useState<ProcessStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  const pollStatus = useCallback(async () => {
    try {
      const s = await api.getStatus();
      setPollError(null);
      setStatus(s);
      setRunning(s.running);
    } catch (err) {
      // Keep optimistic/running state: a transient getStatus failure must not
      // look like the job finished. Surface the error so the UI can retry poll.
      if (runningRef.current) {
        setPollError(pollErrorMessage(err));
      }
    }
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
      const filtered = pickProcessFields(params as Record<string, unknown>);
      if (method === 'process.progress') {
        setStatus((prev) => ({ ...(prev ?? emptyStatus()), ...filtered, running: true } as ProcessStatus));
        setRunning(true);
      } else if (method === 'process.complete') {
        const p = params as Record<string, unknown>;
        const cancelled = p.cancelled === true;
        setStatus((prev) => {
          const base = prev ?? emptyStatus();
          const progress = cancelled
            ? (typeof filtered.progress === 'number' ? filtered.progress : base.progress)
            : (typeof filtered.progress === 'number' ? filtered.progress : 100);
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
    setPollError(null);
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

  const state: ProcessRunnerState = useMemo(() => {
    if (running) {
      return {
        phase: 'running',
        status: status ?? emptyStatus(),
        pollError,
      };
    }
    if (status && (status.progress === 100 || status.cancelled)) {
      return {
        phase: 'completed',
        status,
        cancelled: Boolean(status.cancelled),
        pollError,
      };
    }
    return {
      phase: 'idle',
      status,
      pollError,
    };
  }, [running, status, pollError]);

  return { state, status, running, pollError, pollStatus, startProcess, cancelProcess };
}
