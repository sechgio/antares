import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import App from '../App';
import { findSidebarTab } from './sidebarNav';

const { guard } = vi.hoisted(() => ({ guard: vi.fn() }));
vi.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: null, loading: false, signOut: vi.fn() }),
}));
vi.mock('../components/conversion/ConversionView', () => ({ default: () => <p>Conversión abierta</p> }));
vi.mock('../components/flows', () => ({
  default: ({ registerLeaveGuard }: { registerLeaveGuard?: (value: (() => Promise<boolean>) | null) => void }) => {
    useEffect(() => {
      registerLeaveGuard?.(guard);
      return () => registerLeaveGuard?.(null);
    }, [registerLeaveGuard]);
    return <p>Editor con borrador</p>;
  },
}));

it('conserva Flujos al cancelar la salida y cambia de herramienta cuando se permite salir', async () => {
  guard.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<App />);
  fireEvent.click(await findSidebarTab('Flujos'));
  await screen.findByText('Editor con borrador');
  fireEvent.click(await findSidebarTab('Conversión'));
  await waitFor(() => expect(guard).toHaveBeenCalledOnce());
  expect(screen.getByText('Editor con borrador')).toBeInTheDocument();
  fireEvent.click(await findSidebarTab('Conversión'));
  await screen.findByText('Conversión abierta');
  expect(screen.queryByText('Editor con borrador')).not.toBeInTheDocument();
});
