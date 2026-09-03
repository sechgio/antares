import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { TAB_DEFINITIONS } from '../navigation';

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
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn((cb?: (status: string) => void) => {
      if (typeof cb === 'function') cb('SUBSCRIBED');
      return { unsubscribe: vi.fn() };
    }),
  };
  return {
    mockSupabase: {
      from: vi.fn(() => createThenableChain()),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    },
  };
});

vi.mock('../lib/supabase', () => ({ supabase: mockSupabase }));

vi.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    user: { id: 'test', email: 'test@test.com', displayName: 'Test', isAdmin: true, isDisabled: false, createdAt: '' },
    loading: false,
    error: null,
    signIn: async () => ({ error: null }),
    signUp: async () => ({ error: null }),
    signOut: async () => {},
    refreshUser: async () => {},
  }),
}));

describe('App', () => {
  it('shows an Electron-only message when the preload bridge is unavailable', () => {
    const electronAPI = window.electronAPI;
    window.electronAPI = undefined;

    render(<App />);

    expect(screen.getByText('Abre Antares desde la aplicacion de escritorio')).toBeInTheDocument();
    expect(screen.queryByText('Arrastra imágenes o videos aquí')).not.toBeInTheDocument();

    window.electronAPI = electronAPI;
  });

  it('renders without crashing', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByText('Conversión').length).toBeGreaterThan(0);
    });
  });

  it('can open Espacios tab', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Espacios' }, { timeout: 5000 }));
    await waitFor(
      () => {
        expect(screen.queryByText(/Cargando espacios/i)).not.toBeInTheDocument();
      },
      { timeout: 15000 },
    );
    expect(
      await screen.findByRole('button', { name: /Crear primer espacio/i }, { timeout: 15000 }),
    ).toBeInTheDocument();
  }, 30000);

  it('keeps conversion empty-state actions visible before files are selected', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Conversión' }, { timeout: 5000 }));
    await waitFor(() => {
      expect(screen.getByText(/Arrastra imágenes o videos aquí/i)).toBeInTheDocument();
    }, { timeout: 8000 });
    expect(await screen.findByRole('button', { name: /Seleccionar archivos/i }, { timeout: 8000 })).toBeInTheDocument();
  }, 20000);

  it('has sidebar with navigation buttons', () => {
    render(<App />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(4);
  });

  it('opens Reportes de Campo from the sidebar', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Reportes de Campo/i }, { timeout: 5000 }));

    expect(await screen.findByRole('heading', { name: /Paneles/i }, { timeout: 10000 })).toBeInTheDocument();
  }, 15000);

  it('opens Informes tecnicos from the sidebar', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Informes técnicos|Informes tecnicos/i }));

    expect(await screen.findByRole('heading', { name: /Informes técnicos|Informes tecnicos/i }, { timeout: 5000 })).toBeInTheDocument();
  });

  it('renders the image optimizer without its title in a full-height workspace', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Optimizador/i }, { timeout: 5000 }));

    const preset = await screen.findByRole('button', { name: /Optimizar web/i }, { timeout: 15000 });
    const routeViewport = preset.closest('main')?.firstElementChild;

    expect(screen.queryByRole('heading', { name: /Image Optimizer/i })).not.toBeInTheDocument();
    expect(routeViewport).toBeInstanceOf(HTMLElement);
    expect(routeViewport).not.toHaveClass('px-6');
    expect(routeViewport).not.toHaveClass('py-6');
  }, 20000);

  it('does not render the removed shared header for any tool', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Conversión' }, { timeout: 5000 });

    for (const tab of TAB_DEFINITIONS) {
      fireEvent.click(screen.getByRole('button', { name: tab.label }));
      await waitFor(
        () => {
          expect(screen.queryByTestId('app-header')).not.toBeInTheDocument();
        },
        { timeout: 5000 },
      );
      if (tab.id === 'canvas') {
        await waitFor(() => {
          expect(document.querySelector('.canvas-app')).toBeTruthy();
        }, { timeout: 15000 });
      }
    }
  }, 90000);

  it('opens settings lazily from the title bar', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Conversión' }, { timeout: 5000 });

    expect(screen.queryByTestId('settings-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('titlebar-settings-button'));
    expect(await screen.findByTestId('settings-modal', {}, { timeout: 8000 })).toBeInTheDocument();
  });

  it('opens search from Ctrl+K without rendering a header search button', async () => {
    render(<App />);

    expect(screen.queryByRole('button', { name: 'Buscar' })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(screen.getByPlaceholderText('Buscar acción...')).toBeInTheDocument();
  });
});
