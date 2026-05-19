import { useState, useEffect, useCallback, useRef } from 'react';
import { getBackendStatus, restartBackend, onNotify } from '../api';

type BackendState = 'idle' | 'starting' | 'ready' | 'exited' | 'fatal' | 'unknown';

interface BackendStatusResult {
  backendState: BackendState;
  errorMessage: string | null;
  isRestarting: boolean;
  restartBackend: () => Promise<void>;
}

export function useBackendStatus(): BackendStatusResult {
  const [backendState, setBackendState] = useState<BackendState>('unknown');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const mountedRef = useRef(true);
  const backendStateRef = useRef<BackendState>('unknown');
  const lastPollAtRef = useRef(0);

  const isPollingRef = useRef(false);
  const pollStatus = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;
    try {
      const status = await getBackendStatus();
      if (!mountedRef.current) return;
      const rawState = (status.state as BackendState) || 'unknown';
      setBackendState(rawState);
      if (status.lastError && rawState !== 'ready') {
        // Only show non-scary truncated error
        setErrorMessage(status.lastError.message);
      } else {
        setErrorMessage(null);
      }
    } catch {
      // IPC not available yet — backend is still booting or Electron not ready
      if (mountedRef.current) setBackendState('starting');
    } finally {
      isPollingRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // Initial poll
    lastPollAtRef.current = Date.now();
    pollStatus();
    return () => {
      mountedRef.current = false;
    };
  }, [pollStatus]);

  useEffect(() => {
    backendStateRef.current = backendState;
  }, [backendState]);

  // Stable interval: poll frequently while starting, less often once ready,
  // without recreating timers whenever the state changes.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const minDelay = backendStateRef.current === 'ready' ? 5000 : 2000;
      if (now - lastPollAtRef.current < minDelay) return;
      lastPollAtRef.current = now;
      pollStatus();
    }, 2000);
    return () => clearInterval(interval);
  }, [pollStatus]);

  // Listen for backend lifecycle notifications
  useEffect(() => {
    const unsub = onNotify((method, _params) => {
      if (!mountedRef.current) return;
      if (method === 'backend.ready') {
        setBackendState('ready');
        setErrorMessage(null);
        setIsRestarting(false);
      } else if (method === 'backend.fatal') {
        setBackendState('fatal');
        pollStatus();
        setIsRestarting(false);
      } else if (method === 'backend.starting') {
        setBackendState('starting');
      } else if (method === 'backend.restarting') {
        setBackendState('starting');
        setIsRestarting(true);
      } else if (method === 'backend.error') {
        pollStatus();
      }
    });
    return unsub;
  }, [pollStatus]);

  const handleRestart = useCallback(async () => {
    setIsRestarting(true);
    setErrorMessage(null);
    try {
      const result = await restartBackend();
      if (!mountedRef.current) return;
      if (result.success) {
        setBackendState('ready');
      } else {
        setBackendState((result.state as BackendState) || 'starting');
        await pollStatus();
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : 'Error desconocido');
      setBackendState('starting');
    } finally {
      if (mountedRef.current) setIsRestarting(false);
    }
  }, [pollStatus]);

  return { backendState, errorMessage, isRestarting, restartBackend: handleRestart };
}
