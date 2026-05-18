import type { HistoryRun } from './RunList';

export const HISTORY_REEXECUTE_EVENT = 'antares:history-reexecute';

export function dispatchHistoryReexecute(run: HistoryRun): void {
  window.dispatchEvent(new CustomEvent<HistoryRun>(HISTORY_REEXECUTE_EVENT, { detail: run }));
}

export function subscribeHistoryReexecute(callback: (run: HistoryRun) => void): () => void {
  const listener = (event: Event) => {
    callback((event as CustomEvent<HistoryRun>).detail);
  };
  window.addEventListener(HISTORY_REEXECUTE_EVENT, listener);
  return () => window.removeEventListener(HISTORY_REEXECUTE_EVENT, listener);
}
