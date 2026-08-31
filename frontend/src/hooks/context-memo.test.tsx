import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { memo } from 'react';
import { render } from '@testing-library/react';
import { ToastProvider, useToast } from './useToast';
import { DialogProvider, useDialog } from './useDialog';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

vi.mock('../lib/supabase', () => {
  const mockAuth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  };
  const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
  return {
    supabase: {
      auth: mockAuth,
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: vi.fn(() => ({ data: null, error: null })) })),
        })),
      })),
      rpc: vi.fn(),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    },
  };
});

describe('context memoization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null }, error: null });
    (supabase.auth.onAuthStateChange as any).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  it('toast provider does not re-render consumers on unrelated state', async () => {
    let renders = 0;
    const Consumer = memo(function Consumer() {
      renders++;
      const { addToast } = useToast();
      // use addToast to ensure context read
      void addToast;
      return null;
    });

    const { rerender } = render(
      <ToastProvider>
        <Consumer />
      </ToastProvider>,
    );
    const before = renders;
    rerender(
      <ToastProvider>
        <Consumer />
      </ToastProvider>,
    );
    expect(renders).toBe(before);
  });

  it('dialog provider does not re-render consumers on unrelated state', async () => {
    let renders = 0;
    const Consumer = memo(function Consumer() {
      renders++;
      const { openDialog } = useDialog();
      void openDialog;
      return null;
    });

    const { rerender } = render(
      <DialogProvider>
        <Consumer />
      </DialogProvider>,
    );
    const before = renders;
    rerender(
      <DialogProvider>
        <Consumer />
      </DialogProvider>,
    );
    expect(renders).toBe(before);
  });

  it('auth provider does not re-render consumers on unrelated state', async () => {
    let renders = 0;
    const Consumer = memo(function Consumer() {
      renders++;
      const { user } = useAuth();
      void user;
      return null;
    });

    const { rerender } = render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
    // wait a tick for async init to settle
    await new Promise((r) => setTimeout(r, 20));
    const before = renders;
    rerender(
      <AuthProvider>
        <Consumer />
      </AuthProvider>,
    );
    // allow effects to run
    await new Promise((r) => setTimeout(r, 10));
    expect(renders).toBe(before);
  });
});
