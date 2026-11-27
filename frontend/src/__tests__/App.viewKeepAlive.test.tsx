import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { findSidebarTab } from './sidebarNav';

const { mockSupabase } = vi.hoisted(() => {
  const empty = { data: [] as unknown[], error: null };

  function createThenableChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    const api = {
      select: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      is: vi.fn(() => chain),
      neq: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      order: vi.fn(() => chain),
      single: vi.fn(async () => ({ data: null, error: null })),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(empty).then(resolve, reject),
    };
    Object.assign(chain, api);
    return chain;
  }

  const channel = {
    on: vi.fn(function (this: unknown) {
      return this;
    }),
    subscribe: vi.fn((cb?: (status: string) => void) => {
      if (typeof cb === 'function') cb('SUBSCRIBED');
      return { unsubscribe: vi.fn() };
    }),
  };
  return {
    mockSupabase: {
      from: vi.fn(() => createThenableChain()),
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
      createdAt: '',
    },
    loading: false,
    error: null,
    signIn: async () => ({ error: null }),
    signUp: async () => ({ error: null }),
    signOut: async () => {},
  }),
}));

vi.mock('../components/formatos/FormatosView', () => ({
  default: () => <p>Formatos abierto</p>,
}));

describe('App view keep-alive', () => {
  it('keeps Conversion mounted when switching away and back', async () => {
    render(<App />);

    fireEvent.click(await findSidebarTab('Conversión'));
    const dropzoneBefore = await screen.findByText(/Arrastra imágenes o videos aquí/i, {}, { timeout: 8000 });
    const container = screen.getByTestId('keep-alive-convert');
    expect(container).not.toHaveClass('hidden');

    fireEvent.click(await findSidebarTab('Espacios'));
    await waitFor(() => expect(screen.getByTestId('keep-alive-convert')).toHaveClass('hidden'), { timeout: 8000 });
    const hiddenContainer = screen.getByTestId('keep-alive-convert');
    expect(hiddenContainer).toHaveAttribute('aria-hidden', 'true');
    expect(hiddenContainer.hasAttribute('inert')).toBe(true);
    expect(screen.getByText(/Arrastra imágenes o videos aquí/i)).toBeInTheDocument();

    fireEvent.click(await findSidebarTab('Conversión'));
    await waitFor(() => expect(screen.getByTestId('keep-alive-convert')).not.toHaveClass('hidden'), { timeout: 8000 });
    const dropzoneAfter = screen.getByText(/Arrastra imágenes o videos aquí/i);
    expect(dropzoneAfter).toBe(dropzoneBefore);
  }, 30000);

  it('keeps Espacios mounted hidden while another tab is active', async () => {
    render(<App />);

    fireEvent.click(await findSidebarTab('Espacios'));
    expect(
      await screen.findByRole('button', { name: /Crear primer espacio/i }, { timeout: 15000 }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('keep-alive-espacios')).not.toHaveClass('hidden');

    fireEvent.click(await findSidebarTab('Conversión'));
    await screen.findByText(/Arrastra imágenes o videos aquí/i, {}, { timeout: 8000 });
    await waitFor(() => expect(screen.getByTestId('keep-alive-espacios')).toHaveClass('hidden'), { timeout: 8000 });
    expect(screen.getByRole('button', { name: /Crear primer espacio/i, hidden: true })).toBeInTheDocument();

    fireEvent.click(await findSidebarTab('Espacios'));
    await waitFor(() => expect(screen.getByTestId('keep-alive-espacios')).not.toHaveClass('hidden'), { timeout: 8000 });
  }, 30000);

  it('unmounts non-whitelisted views when switching away', async () => {
    render(<App />);

    fireEvent.click(await findSidebarTab('Formatos PDF'));
    await screen.findByText('Formatos abierto');

    fireEvent.click(await findSidebarTab('Conversión'));
    await screen.findByText(/Arrastra imágenes o videos aquí/i, {}, { timeout: 8000 });

    expect(screen.queryByText('Formatos abierto')).not.toBeInTheDocument();
    expect(screen.queryByTestId('keep-alive-formatos')).not.toBeInTheDocument();
  }, 20000);
});
