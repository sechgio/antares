import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import App from '../App';
import { findSidebarTab } from './sidebarNav';
import { agentApi } from '../api/agentApi';

const executeRendererTool = vi.hoisted(() => vi.fn());
vi.mock('../components/agent/rendererTools', () => ({ executeRendererTool }));

vi.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: null, loading: false, signOut: vi.fn() }),
}));
vi.mock('../components/connections/ProvidersView', () => ({
  default: () => <p>Sección Proveedores</p>,
}));
vi.mock('../components/agent', () => ({
  default: ({ onConfigureProvider }: { onConfigureProvider?: () => void }) => (
    <button type="button" onClick={onConfigureProvider}>Configurar IA</button>
  ),
}));

it('no hay tab de Conexiones y el agente abre la sección Proveedores de Ajustes', async () => {
  render(<App />);
  expect(screen.queryByRole('button', { name: 'Flujos' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Conexiones' })).not.toBeInTheDocument();
  fireEvent.click(await findSidebarTab('Agent'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Agent' }).at(-1)!);
  fireEvent.click(await screen.findByRole('button', { name: 'Configurar IA' }));
  await screen.findByText('Sección Proveedores');
});

it('transmite la incertidumbre de una escritura sin alterar los rechazos confirmados', async () => {
  const previousApi = window.electronAPI;
  const listeners: Array<(method: string, params: unknown) => void | Promise<void>> = [];
  window.electronAPI = { ...previousApi!, onNotify: (callback) => { listeners.push(callback); return () => {}; } };
  const response = vi.spyOn(agentApi, 'agentRendererResult').mockResolvedValue({ accepted: true });
  const notifyAll = async (params: unknown) => {
    await act(async () => { for (const cb of listeners) await cb('agent.renderer-tool', params); });
  };
  try {
    render(<App />);
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0));
    executeRendererTool.mockRejectedValue(Object.assign(new Error('Respuesta perdida'), { name: 'AgentEffectUncertainError' }));
    await notifyAll({ id: 'op1', method: 'espacios_espacio_create', params: {} });
    await waitFor(() => expect(response).toHaveBeenCalledWith('op1', undefined, 'Respuesta perdida', true));
    executeRendererTool.mockRejectedValue(new Error('Permiso denegado [42501]'));
    await notifyAll({ id: 'op2', method: 'espacios_espacio_create', params: {} });
    await waitFor(() => expect(response).toHaveBeenCalledWith('op2', undefined, 'Permiso denegado [42501]', false));
  } finally {
    window.electronAPI = previousApi; response.mockRestore();
  }
});
