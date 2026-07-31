import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';

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
  it('keeps Canvas mounted when switching away and back', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Canvas' }, { timeout: 5000 }));
    expect(await screen.findByTestId('canvas-keep-alive', {}, { timeout: 15000 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Conversión' }));
    await waitFor(() => {
      expect(screen.getByText(/Arrastra imágenes o videos aquí/i)).toBeInTheDocument();
    }, { timeout: 8000 });

    // Still in the DOM while another tab is active (not remounted on return).
    expect(screen.getByTestId('canvas-keep-alive')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Canvas' }));
    expect(screen.getByTestId('canvas-keep-alive')).toBeInTheDocument();
  }, 30000);
});
