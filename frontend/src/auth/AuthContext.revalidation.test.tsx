import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAuth, AuthProvider } from './AuthContext';
import { supabase } from '../lib/supabase';

vi.mock('../lib/supabase', () => {
  const channel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  };
  return {
    supabase: {
      auth: {
        getSession: vi.fn(),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        signInWithPassword: vi.fn(),
        signUp: vi.fn(),
        signOut: vi.fn(),
      },
      from: vi.fn(),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    },
  };
});

type GetSessionResult = Awaited<
  ReturnType<NonNullable<typeof supabase>['auth']['getSession']>
>;
type FromResult = ReturnType<NonNullable<typeof supabase>['from']>;
type ChannelResult = ReturnType<NonNullable<typeof supabase>['channel']>;

const TEST_USER = { id: 'u1', email: 'a@b.com', created_at: '2026-01-01' };

function mockSession() {
  vi.mocked(supabase!.auth.getSession).mockResolvedValue({
    data: {
      session: { access_token: 'tok', user: { ...TEST_USER } },
    },
    error: null,
  } as unknown as GetSessionResult);
}

function mockProfile(
  row: { display_name: string; is_admin: boolean; is_disabled: boolean } | null,
  error: { message: string } | null = null,
) {
  vi.mocked(supabase!.from).mockReturnValue({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(() => ({
          data: row,
          error,
        })),
      })),
    })),
  } as unknown as FromResult);
}

describe('AuthProvider session revalidation', () => {
  beforeEach(() => {
    vi.mocked(supabase!.auth.getSession).mockClear();
    vi.mocked(supabase!.auth.onAuthStateChange).mockClear();
    vi.mocked(supabase!.auth.signInWithPassword).mockClear();
    vi.mocked(supabase!.auth.signOut).mockClear();
    vi.mocked(supabase!.from).mockClear();
    vi.mocked(supabase!.channel).mockClear();
    vi.mocked(supabase!.removeChannel).mockClear();
    const channel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    };
    vi.mocked(supabase!.channel).mockReturnValue(channel as unknown as ChannelResult);
    vi.mocked(supabase!.auth.signOut).mockResolvedValue({ error: null });
    mockSession();
    mockProfile({ display_name: 'A', is_admin: false, is_disabled: false });
  });

  it('revalidates the session on window focus and signs out a newly disabled profile', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.user?.id).toBe('u1');
    });

    mockProfile({ display_name: 'A', is_admin: false, is_disabled: true });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.user).toBeNull();
    });
    expect(supabase!.auth.signOut).toHaveBeenCalled();
    expect(result.current.error).toMatch(/desactivad/i);
  });

  it('revalidates the session when the profile channel reports CHANNEL_ERROR', async () => {
    let statusCallback: ((status: string) => void) | null = null;
    const channel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn((cb: (status: string) => void) => {
        statusCallback = cb;
        return channel;
      }),
    };
    vi.mocked(supabase!.channel).mockReturnValue(channel as unknown as ChannelResult);

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.user?.id).toBe('u1');
    });
    expect(statusCallback).not.toBeNull();

    mockProfile({ display_name: 'A', is_admin: false, is_disabled: true });
    await act(async () => {
      statusCallback?.('CHANNEL_ERROR');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.user).toBeNull();
    });
    expect(supabase!.auth.signOut).toHaveBeenCalled();
    expect(result.current.error).toMatch(/desactivad/i);
  });

  it('keeps the session when a revalidation profile fetch fails transiently', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.user?.id).toBe('u1');
    });

    mockProfile(null, { message: 'temporary network failure' });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(supabase!.auth.getSession).toHaveBeenCalledTimes(2);
    });
    expect(result.current.user?.id).toBe('u1');
    expect(supabase!.auth.signOut).not.toHaveBeenCalled();
  });
});
