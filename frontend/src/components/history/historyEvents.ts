import type { HistoryRun } from './RunList';

export const HISTORY_REEXECUTE_EVENT = 'antares:history-reexecute';

/** Holds the last reexecute payload until ConversionView is mounted and consumes it. */
let pendingReexecute: HistoryRun | null = null;

export function dispatchHistoryReexecute(run: HistoryRun): void {
  pendingReexecute = run;
  window.dispatchEvent(new CustomEvent<HistoryRun>(HISTORY_REEXECUTE_EVENT, { detail: run }));
}

/** Return and clear any pending reexecute payload (safe to call on ConversionView mount). */
export function takePendingHistoryReexecute(): HistoryRun | null {
  const run = pendingReexecute;
  pendingReexecute = null;
  return run;
}

export function peekPendingHistoryReexecute(): HistoryRun | null {
  return pendingReexecute;
}

export function subscribeHistoryReexecute(callback: (run: HistoryRun) => void): () => void {
  const listener = (event: Event) => {
    callback((event as CustomEvent<HistoryRun>).detail);
  };
  window.addEventListener(HISTORY_REEXECUTE_EVENT, listener);
  return () => window.removeEventListener(HISTORY_REEXECUTE_EVENT, listener);
}
