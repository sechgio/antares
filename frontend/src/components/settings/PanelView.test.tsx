import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '../../i18n';
import PanelView from './PanelView';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: vi.fn(),
      getUser: vi.fn(),
    },
    rpc: vi.fn(),
    functions: {
      invoke: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({ data: null, error: null })),
        })),
      })),
    })),
  },
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', email: 'admin@test.com', displayName: 'Admin', isAdmin: true, isDisabled: false, createdAt: '' },
    loading: false,
    error: null,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    refreshUser: vi.fn(),
  }),
}));

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({
    toasts: [],
    addToast: vi.fn(),
    removeToast: vi.fn(),
  }),
}));

describe('PanelView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the panel title for admins', async () => {
    const { supabase } = await import('../../lib/supabase');
    (supabase.rpc as any).mockResolvedValue({
      data: [{ user_id: 'u1', email: 'a@b.com', display_name: 'A', is_admin: false, is_disabled: false, created_at: '2026-01-01', last_sign_in_at: null }],
      error: null,
    });

    render(<PanelView />);
    expect(screen.getByText(/Panel de Usuarios/i)).toBeInTheDocument();
  });

  it('loads and displays user list', async () => {
    const { supabase } = await import('../../lib/supabase');
    (supabase.rpc as any).mockResolvedValue({
      data: [
        { user_id: 'u1', email: 'a@b.com', display_name: 'A', is_admin: false, is_disabled: false, created_at: '2026-01-01', last_sign_in_at: null },
        { user_id: 'u2', email: 'c@d.com', display_name: 'C', is_admin: true, is_disabled: false, created_at: '2026-01-02', last_sign_in_at: '2026-06-01' },
      ],
      error: null,
    });

    render(<PanelView />);
    await waitFor(() => {
      expect(screen.getByText('a@b.com')).toBeInTheDocument();
      expect(screen.getByText('c@d.com')).toBeInTheDocument();
    });
  });

  it('renders create user form fields', async () => {
    const { supabase } = await import('../../lib/supabase');
    (supabase.rpc as any).mockResolvedValue({ data: [], error: null });

    render(<PanelView />);
    expect(screen.getByText(/Crear usuario/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/correo@dominio.com/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/^Contraseña$/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Confirmar contraseña/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear/i })).toBeDisabled();
  });

  it('creates user via admin-create-user edge function', async () => {
    const { supabase } = await import('../../lib/supabase');
    (supabase.rpc as any).mockResolvedValue({ data: [], error: null });
    (supabase.functions.invoke as any).mockResolvedValue({
      data: { user: { id: 'new-user-id', email: 'new@test.com' } },
      error: null,
    });

    render(<PanelView />);

    fireEvent.change(screen.getByPlaceholderText(/correo@dominio.com/i), {
      target: { value: 'new@test.com' },
    });
    fireEvent.change(screen.getByPlaceholderText(/^Contraseña$/i), {
      target: { value: 'secret123' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Confirmar contraseña/i), {
      target: { value: 'secret123' },
    });

    const createButton = screen.getByRole('button', { name: /Crear/i });
    expect(createButton).not.toBeDisabled();
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith('admin-create-user', {
        body: { email: 'new@test.com', password: 'secret123', email_confirm: true, role: 'user' },
      });
    });
  });
});
