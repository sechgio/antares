import { describe, expect, it, vi, beforeEach } from 'vitest';

const subscribe = vi.fn();
const channel = {
  on: vi.fn(function (this: unknown) {
    return this;
  }),
  subscribe,
};

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
  },
}));

import {
  subscribeDueNotifications,
  subscribeEspaciosSync,
  unsubscribeEspaciosSync,
} from '../api/realtime';

describe('subscribeEspaciosSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channel.on.mockImplementation(function (this: unknown) {
      return this;
    });
    subscribe.mockImplementation((cb?: (s: string) => void) => {
      cb?.('SUBSCRIBED');
      return channel;
    });
  });

  it('reports live status when subscribed', () => {
    const onStatus = vi.fn();
    subscribeEspaciosSync('e1', 'p1', vi.fn(), onStatus);
    expect(onStatus).toHaveBeenCalledWith('connecting');
    expect(onStatus).toHaveBeenCalledWith('live');
  });

  it('reports offline when supabase is unavailable', async () => {
    vi.resetModules();
    vi.doMock('../../../lib/supabase', () => ({ supabase: null }));
    const { subscribeEspaciosSync: sub } = await import('../api/realtime');
    const onStatus = vi.fn();
    expect(sub(null, null, vi.fn(), onStatus)).toBeNull();
    expect(onStatus).toHaveBeenCalledWith('offline');
  });

  it('unsubscribes via removeChannel', () => {
    const ch = subscribeEspaciosSync('e1', 'p1', vi.fn());
    unsubscribeEspaciosSync(ch);
  });
});

describe('subscribeDueNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channel.on.mockImplementation(function (this: unknown) {
      return this;
    });
    subscribe.mockImplementation((cb?: (s: string) => void) => {
      cb?.('SUBSCRIBED');
      return channel;
    });
  });

  it('subscribes to tareas and board_columns without proyecto filter', () => {
    const onChange = vi.fn();
    const onStatus = vi.fn();
    subscribeDueNotifications(onChange, onStatus);

    expect(channel.on).toHaveBeenCalledTimes(2);
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tareas' },
      expect.any(Function),
    );
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'board_columns' },
      expect.any(Function),
    );
    expect(onStatus).toHaveBeenCalledWith('connecting');
    expect(onStatus).toHaveBeenCalledWith('live');
  });

  it('invokes onChange when postgres_changes fires', () => {
    const onChange = vi.fn();
    const handlers: Array<() => void> = [];
    channel.on.mockImplementation(function (this: unknown, _event: string, _filter: unknown, cb: () => void) {
      handlers.push(cb);
      return this;
    });

    subscribeDueNotifications(onChange);
    expect(handlers).toHaveLength(2);
    handlers[0]();
    handlers[1]();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
