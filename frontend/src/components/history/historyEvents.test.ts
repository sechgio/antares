import { describe, expect, it } from 'vitest';
import {
  HISTORY_REEXECUTE_EVENT,
  dispatchHistoryReexecute,
  subscribeHistoryReexecute,
} from './historyEvents';

describe('history reexecute events', () => {
  it('dispatches same-window custom events without using postMessage', () => {
    const payload = {
      id: 1,
      run_type: 'conversion',
      timestamp: '2026-05-16T00:00:00Z',
      formato: 'JPEG',
      calidad: 95,
      ok_count: 1,
      err_count: 0,
      patron: '{codigo}',
      files_json: '[]',
      options_json: '{}',
    } as const;
    let received = null;
    const unsubscribe = subscribeHistoryReexecute((run) => {
      received = run;
    });

    dispatchHistoryReexecute(payload);

    expect(received).toEqual(payload);
    expect(HISTORY_REEXECUTE_EVENT).toBe('antares:history-reexecute');
    unsubscribe();
  });
});
