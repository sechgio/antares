import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import App from '../App';
import { findSidebarTab } from './sidebarNav';

vi.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: null, loading: false, signOut: vi.fn() }),
}));
vi.mock('../components/connections', () => ({
  default: ({ initialSection }: { initialSection?: string }) => <p>Conexiones: {initialSection ?? 'connections'}</p>,
}));
vi.mock('../components/agent', () => ({
  default: ({ onConfigureProvider }: { onConfigureProvider?: () => void }) => (
    <button type="button" onClick={onConfigureProvider}>Configurar IA</button>
  ),
}));

it('abre Conexiones desde la navegación y Proveedores IA desde el agente', async () => {
  render(<App />);
  expect(screen.queryByRole('button', { name: 'Flujos' })).not.toBeInTheDocument();
  fireEvent.click(await findSidebarTab('Conexiones'));
  await screen.findByText('Conexiones: connections');
  fireEvent.click(await findSidebarTab('Agent'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Agent' }).at(-1)!);
  fireEvent.click(await screen.findByRole('button', { name: 'Configurar IA' }));
  await screen.findByText('Conexiones: providers');
});
