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

  const pollStatus = useCallback(async () => {
    try {
      const status = await getBackendStatus();
      if (!mountedRef.current) return;
      // Never stay stuck in 'fatal' from the renderer perspective — the spawner
      // is now designed to retry forever. We map fatal/unknown to 'starting'
      // so the UI always shows "reconnecting" instead of giving up.
      const rawState = (status.state as BackendState) || 'unknown';
      const displayState = rawState === 'fatal' ? 'starting' : rawState;
      setBackendState(displayState);
      if (status.lastError && rawState !== 'ready') {
        // Only show non-scary truncated error
        setErrorMessage(status.lastError.message);
      } else {
        setErrorMessage(null);
      }
    } catch {
      // IPC not available yet — backend is still booting or Electron not ready
      if (mountedRef.current) setBackendState('starting');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // Initial poll
    pollStatus();
    // Poll every 2 seconds if not ready for faster UX recovery; every 5s otherwise.
    const interval = setInterval(() => {
      pollStatus();
    }, backendState === 'ready' ? 5000 : 2000);
    // Listen for backend lifecycle notifications
    const unsub = onNotify((method, _params) => {
      if (!mountedRef.current) return;
      if (method === 'backend.ready') {
        setBackendState('ready');
        setErrorMessage(null);
        setIsRestarting(false);
      } else if (method === 'backend.fatal') {
        // The spawner retries forever; we just show reconnecting.
        setBackendState('starting');
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
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
      unsub();
    };
  }, [pollStatus, backendState]);

  const handleRestart = useCallback(async () => {
    setIsRestarting(true);
    setErrorMessage(null);
    try {
      const result = await restartBackend();
      if (!mountedRef.current) return;
      if (result.success) {
        setBackendState('ready');
      } else {
        // Even if manual restart doesn't succeed immediately, the spawner
        // will keep trying. Show reconnecting instead of fatal.
        setBackendState('starting');
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
