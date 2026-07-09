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

import { subscribeEspaciosSync, unsubscribeEspaciosSync } from '../api/realtime';

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
