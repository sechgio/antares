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
  return {
    supabase: {
      auth: mockAuth,
      from: mockFrom,
      rpc: vi.fn(),
    },
  };
});

describe('AuthProvider', () => {
  beforeEach(() => {
    // Only clear call history, not implementations (vitest 4 clearAllMocks resets impls)
    (supabase.auth.getSession as any).mockClear();
    (supabase.auth.onAuthStateChange as any).mockClear();
    (supabase.from as any).mockClear();
    // Ensure onAuthStateChange always returns a valid subscription object
    (supabase.auth.onAuthStateChange as any).mockImplementation(() => ({
      data: { subscription: { unsubscribe: vi.fn() } },
    }));
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
});