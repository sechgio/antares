import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAuth, AuthProvider } from './AuthContext';
import { supabase } from '../lib/supabase';

vi.mock('../lib/supabase', () => {
  const mockAuth = {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    admin: {
      listUsers: vi.fn(),
      createUser: vi.fn(),
      updateUserById: vi.fn(),
      deleteUser: vi.fn(),
    },
  };
  const mockFrom = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => ({ data: null, error: null })),
      })),
    })),
  }));
  const channel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  };
  return {
    supabase: {
      auth: mockAuth,
      from: mockFrom,
      rpc: vi.fn(),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    },
  };
});

function mockProfile(row: { display_name: string; is_admin: boolean; is_disabled: boolean } | null) {
  (supabase.from as any).mockReturnValue({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => ({
          data: row,
          error: row ? null : { message: 'not found' },
        })),
      })),
    })),
  });
}

describe('AuthProvider', () => {
  beforeEach(() => {
    (supabase.auth.getSession as any).mockClear();
    (supabase.auth.onAuthStateChange as any).mockClear();
    (supabase.auth.signInWithPassword as any).mockClear();
    (supabase.auth.signOut as any).mockClear();
    (supabase.from as any).mockClear();
    (supabase.channel as any).mockClear();
    (supabase.removeChannel as any).mockClear();
    (supabase.auth.onAuthStateChange as any).mockImplementation(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }));
    const channel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    };
    (supabase.channel as any).mockReturnValue(channel);
  });

  it('starts in loading state and resolves to no user when no session', async () => {
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null }, error: null });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.user).toBeNull();
    });
  });

  it('exposes user when a session exists', async () => {
    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: {
          access_token: 'tok',
          user: { id: 'u1', email: 'a@b.com', created_at: '2026-01-01' },
        },
      },
      error: null,
    });
    (supabase.from as any).mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({
            data: { display_name: 'A', is_admin: false, is_disabled: false },
            error: null,
          })),
        })),
      })),
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.user?.email).toBe('a@b.com');
    });
  });

  it('clears error on signOut after a failed signIn', async () => {
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null }, error: null });
    (supabase.auth.signInWithPassword as any).mockResolvedValue({
      error: { message: 'Invalid credentials' },
    });
    (supabase.auth.signOut as any).mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });

    await act(async () => {
      await result.current.signIn('a@b.com', 'wrong');
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Invalid credentials');
    });

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.error).toBeNull();
  });

  it('applies a late valid session after the safety timeout without invalidating gen', async () => {
    let resolveSession: (value: unknown) => void = () => {};
    const sessionPromise = new Promise((resolve) => {
      resolveSession = resolve;
    });
    (supabase.auth.getSession as any).mockReturnValue(sessionPromise);
    (supabase.from as any).mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({
            data: { display_name: 'Late', is_admin: false, is_disabled: false },
            error: null,
          })),
        })),
      })),
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.user).toBeNull();

    await act(async () => {
      resolveSession({
        data: {
          session: {
            access_token: 'tok',
            user: { id: 'u-late', email: 'late@b.com', created_at: '2026-01-01' },
          },
        },
        error: null,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.user?.email).toBe('late@b.com');
    });
    vi.useRealTimers();
  });

  it('rejects signUp with invite-only message without calling Supabase', async () => {
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null }, error: null });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let signUpResult: { error: string | null } = { error: null };
    await act(async () => {
      signUpResult = await result.current.signUp('new@b.com', 'secret');
    });

    expect(supabase.auth.signUp).not.toHaveBeenCalled();
    expect(signUpResult.error).toBe(
      'Registro deshabilitado. Solicita una invitación a un administrador.',
    );
    expect(result.current.error).toBe(
      'Registro deshabilitado. Solicita una invitación a un administrador.',
    );
  });

  it('signs out and clears user when session profile is disabled', async () => {
    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: {
          access_token: 'tok',
          user: { id: 'u-disabled', email: 'disabled@b.com', created_at: '2026-01-01' },
        },
      },
      error: null,
    });
    mockProfile({ display_name: 'Disabled', is_admin: false, is_disabled: true });
    (supabase.auth.signOut as any).mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(result.current.user).toBeNull();
    expect(result.current.error).toMatch(/desactivad/i);
  });

  it('rejects signIn when the account is disabled', async () => {
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null }, error: null });
    (supabase.auth.signInWithPassword as any).mockResolvedValue({
      data: {
        session: { access_token: 'tok' },
        user: { id: 'u-disabled', email: 'disabled@b.com', created_at: '2026-01-01' },
      },
      error: null,
    });
    mockProfile({ display_name: 'Disabled', is_admin: false, is_disabled: true });
    (supabase.auth.signOut as any).mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    let signInResult: { error: string | null } = { error: null };
    await act(async () => {
      signInResult = await result.current.signIn('disabled@b.com', 'secret');
    });

    expect(signInResult.error).toMatch(/desactivad/i);
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(result.current.user).toBeNull();
  });

  it('signs out when realtime marks the current profile as disabled', async () => {
    let profileHandler: ((payload: { new: Record<string, unknown> }) => void) | null = null;
    const channel = {
      on: vi.fn((_event: string, _filter: unknown, cb: (payload: { new: Record<string, unknown> }) => void) => {
        profileHandler = cb;
        return channel;
      }),
      subscribe: vi.fn().mockReturnThis(),
    };
    (supabase.channel as any).mockReturnValue(channel);

    (supabase.auth.getSession as any).mockResolvedValue({
      data: {
        session: {
          access_token: 'tok',
          user: { id: 'u1', email: 'a@b.com', created_at: '2026-01-01' },
        },
      },
      error: null,
    });
    mockProfile({ display_name: 'A', is_admin: false, is_disabled: false });
    (supabase.auth.signOut as any).mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.user?.email).toBe('a@b.com');
    });
    await waitFor(() => {
      expect(profileHandler).not.toBeNull();
    });

    await act(async () => {
      profileHandler?.({ new: { user_id: 'u1', is_disabled: true, is_admin: false, display_name: 'A' } });
    });

    await waitFor(() => {
      expect(result.current.user).toBeNull();
    });
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(result.current.error).toMatch(/desactivad/i);
  });

  it('does not fetch profile twice on boot', async () => {
    const session = {
      access_token: 'tok',
      user: { id: 'u1', email: 'a@b.com', created_at: '2026-01-01' },
    };
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session }, error: null });

    const fromSpy = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({
            data: { display_name: 'x', is_admin: false, is_disabled: false },
            error: null,
          })),
        })),
      })),
    }));
    (supabase.from as any).mockImplementation(fromSpy as any);

    (supabase.auth.onAuthStateChange as any).mockImplementation((cb: any) => {
      queueMicrotask(() => cb('INITIAL_SESSION', session));
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.user?.email).toBe('a@b.com');
    });

    await new Promise((r) => setTimeout(r, 20));

    expect(fromSpy).toHaveBeenCalledTimes(1);
  });

  it('does not fetch profile twice when INITIAL_SESSION fires synchronously', async () => {
    const session = {
      access_token: 'tok2',
      user: { id: 'u1', email: 'sync@b.com', created_at: '2026-01-01' },
    };
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session }, error: null });

    const fromSpy = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({
            data: { display_name: 'sync', is_admin: false, is_disabled: false },
            error: null,
          })),
        })),
      })),
    }));
    (supabase.from as any).mockImplementation(fromSpy as any);

    (supabase.auth.onAuthStateChange as any).mockImplementation((cb: any) => {
      cb('INITIAL_SESSION', session);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.user?.email).toBe('sync@b.com');
    });

    await new Promise((r) => setTimeout(r, 20));

    expect(fromSpy).toHaveBeenCalledTimes(1);
  });
});
