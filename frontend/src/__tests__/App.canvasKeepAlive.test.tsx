import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { findSidebarTab } from './sidebarNav';
import { registerCanvasFlushOwner } from '../utils/ackCanvasFlush';

const { mockSupabase } = vi.hoisted(() => {
  const empty = { data: [] as unknown[], error: null };
  const queryResult = vi.fn(async () => empty);
  const returnThis = function (this: unknown) {
    return this;
  };
  const chain = {
    select: vi.fn(returnThis),
    insert: vi.fn(returnThis),
    update: vi.fn(returnThis),
    delete: vi.fn(returnThis),
    eq: vi.fn(returnThis),
    order: vi.fn(() => queryResult()),
    single: vi.fn(async () => ({ data: null, error: null })),
  };
  const channel = { on: vi.fn(returnThis), subscribe: vi.fn(() => ({})) };
  return {
    mockSupabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn(async () => ({ data: [], error: null })),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      },
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mockSupabase }));

vi.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    user: {
      id: 'test',
      email: 'test@test.com',
      displayName: 'Test',
      isAdmin: true,
      isDisabled: false,
      createdAt: '',
    },
    loading: false,
    error: null,
    signIn: async () => ({ error: null }),
    signUp: async () => ({ error: null }),
    signOut: async () => {},
    refreshUser: async () => {},
  }),
}));

describe('App Canvas keep-alive', () => {
  it('acknowledges quit flush when Canvas has never been mounted', async () => {
    const previousApi = window.electronAPI;
    const listeners: Array<(method: string, params: unknown) => void | Promise<void>> = [];
    const canvasFlushAck = vi.fn(async () => ({ ok: true }));
    window.electronAPI = {
      ...previousApi!,
      onNotify: (callback) => {
        listeners.push(callback);
        return () => {};
      },
      canvasFlushAck,
    };

    try {
      render(<App />);
      await waitFor(() => expect(listeners.length).toBeGreaterThan(0));
      await act(async () => {
        for (const cb of listeners) await cb('app.flush-canvas-before-quit', {});
      });
      expect(canvasFlushAck).toHaveBeenCalledTimes(1);
    } finally {
      window.electronAPI = previousApi;
    }
  });

  it('leaves the quit flush ack to Canvas while it owns the flush', async () => {
    const previousApi = window.electronAPI;
    const listeners: Array<(method: string, params: unknown) => void | Promise<void>> = [];
    const canvasFlushAck = vi.fn(async () => ({ ok: true }));
    window.electronAPI = {
      ...previousApi!,
      onNotify: (callback) => {
        listeners.push(callback);
        return () => {};
      },
      canvasFlushAck,
    };
    const release = registerCanvasFlushOwner();

    try {
      render(<App />);
      await waitFor(() => expect(listeners.length).toBeGreaterThan(0));
      await act(async () => {
        for (const cb of listeners) await cb('app.flush-canvas-before-quit', {});
      });
      expect(canvasFlushAck).not.toHaveBeenCalled();
    } finally {
      release();
      window.electronAPI = previousApi;
    }
  });

  it('keeps Canvas mounted when switching away and back', async () => {
    render(<App />);

    fireEvent.click(await findSidebarTab('Canvas'));
    expect(await screen.findByTestId('canvas-keep-alive', {}, { timeout: 15000 })).toBeInTheDocument();

    fireEvent.click(await findSidebarTab('Conversión'));
    await waitFor(
      () => {
        expect(screen.getByText(/Arrastra imágenes o videos aquí/i)).toBeInTheDocument();
      },
      { timeout: 8000 },
    );

    expect(screen.getByTestId('canvas-keep-alive')).toBeInTheDocument();

    fireEvent.click(await findSidebarTab('Canvas'));
    expect(screen.getByTestId('canvas-keep-alive')).toBeInTheDocument();
  }, 30000);

  it('unmounts Canvas after keep-alive idle timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<App />);
      fireEvent.click(await findSidebarTab('Canvas'));
      expect(await screen.findByTestId('canvas-keep-alive', {}, { timeout: 15000 })).toBeInTheDocument();

      fireEvent.click(await findSidebarTab('Conversión'));
      await waitFor(() => {
        expect(screen.getByTestId('canvas-keep-alive')).toBeInTheDocument();
      });

      await vi.advanceTimersByTimeAsync(60 * 1000 + 100);
      await waitFor(() => {
        expect(screen.queryByTestId('canvas-keep-alive')).not.toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  }, 30000);
});
