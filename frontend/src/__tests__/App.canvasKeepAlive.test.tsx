import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { findSidebarTab } from './sidebarNav';
import { registerCanvasFlushOwner } from '../utils/ackCanvasFlush';

const { mockSupabase } = vi.hoisted(() => {
  const empty = { data: [] as unknown[], error: null };
  const queryResult = vi.fn().mockResolvedValue(empty);
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockImplementation(() => queryResult()),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnValue({}) };
  return {
    mockSupabase: {
      from: vi.fn(() => chain),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
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
    let notifyHandler: ((method: string, params: unknown) => void | Promise<void>) | undefined;
    const canvasFlushAck = vi.fn(async () => ({ ok: true }));
    window.electronAPI = {
      ...previousApi!,
      onNotify: (callback) => {
        notifyHandler = callback;
        return () => {};
      },
      canvasFlushAck,
    };

    try {
      render(<App />);
      await waitFor(() => expect(notifyHandler).toBeDefined());
      await act(async () => {
        await notifyHandler?.('app.flush-canvas-before-quit', {});
      });
      expect(canvasFlushAck).toHaveBeenCalledTimes(1);
    } finally {
      window.electronAPI = previousApi;
    }
  });

  it('leaves the quit flush ack to Canvas while it owns the flush', async () => {
    const previousApi = window.electronAPI;
    let notifyHandler: ((method: string, params: unknown) => void | Promise<void>) | undefined;
    const canvasFlushAck = vi.fn(async () => ({ ok: true }));
    window.electronAPI = {
      ...previousApi!,
      onNotify: (callback) => {
        notifyHandler = callback;
        return () => {};
      },
      canvasFlushAck,
    };
    const release = registerCanvasFlushOwner();

    try {
      render(<App />);
      await waitFor(() => expect(notifyHandler).toBeDefined());
      await act(async () => {
        await notifyHandler?.('app.flush-canvas-before-quit', {});
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
    await waitFor(() => {
      expect(screen.getByText(/Arrastra imágenes o videos aquí/i)).toBeInTheDocument();
    }, { timeout: 8000 });

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
