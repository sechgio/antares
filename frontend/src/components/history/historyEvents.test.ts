import { afterEach, describe, expect, it } from 'vitest';
import {
  HISTORY_REEXECUTE_EVENT,
  dispatchHistoryReexecute,
  peekPendingHistoryReexecute,
  subscribeHistoryReexecute,
  takePendingHistoryReexecute,
} from './historyEvents';
import type { HistoryRun } from './RunList';

const sampleRun = {
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
} as const satisfies HistoryRun;

describe('history reexecute events', () => {
  afterEach(() => {
    takePendingHistoryReexecute();
  });

  it('dispatches same-window custom events without using postMessage', () => {
    let received: HistoryRun | null = null;
    const unsubscribe = subscribeHistoryReexecute((run) => {
      received = run;
    });

    dispatchHistoryReexecute(sampleRun);

    expect(received).toEqual(sampleRun);
    expect(HISTORY_REEXECUTE_EVENT).toBe('antares:history-reexecute');
    unsubscribe();
  });

  it('buffers payload so ConversionView can consume it after mounting', () => {
    dispatchHistoryReexecute(sampleRun);
    expect(peekPendingHistoryReexecute()).toEqual(sampleRun);

    const taken = takePendingHistoryReexecute();
    expect(taken).toEqual(sampleRun);
    expect(takePendingHistoryReexecute()).toBeNull();
    expect(peekPendingHistoryReexecute()).toBeNull();
  });
});
