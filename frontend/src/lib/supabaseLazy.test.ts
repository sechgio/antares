import { describe, expect, it, vi } from 'vitest';

const lazyState = vi.hoisted(() => ({ attempts: 0, client: { kind: 'supabase-client' } }));

vi.mock('./supabase', () => {
  lazyState.attempts += 1;
  if (lazyState.attempts === 1) throw new Error('transient chunk failure');
  return { supabase: lazyState.client };
});

import { getSupabaseClient } from './supabaseLazy';

describe('getSupabaseClient', () => {
  it('retries after a transient import failure', async () => {
    await expect(getSupabaseClient()).rejects.toThrow();
    await expect(getSupabaseClient()).resolves.toBe(lazyState.client);
    expect(lazyState.attempts).toBe(2);
  });
});
