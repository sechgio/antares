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
vi.mock('../components/connections', () => ({
  default: ({ initialSection }: { initialSection?: string }) => <p>Conexiones: {initialSection ?? 'connections'}</p>,
}));
vi.mock('../components/agent', () => ({
  default: ({ onConfigureProvider }: { onConfigureProvider?: () => void }) => (
    <button type="button" onClick={onConfigureProvider}>Configurar IA</button>
  ),
}));

it('no hay tab de Conexiones y el agente abre la sección de Ajustes', async () => {
  render(<App />);
  expect(screen.queryByRole('button', { name: 'Flujos' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Conexiones' })).not.toBeInTheDocument();
  fireEvent.click(await findSidebarTab('Agent'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Agent' }).at(-1)!);
  fireEvent.click(await screen.findByRole('button', { name: 'Configurar IA' }));
  await screen.findByText('Conexiones: connections');
});

it('transmite la incertidumbre de una escritura sin alterar los rechazos confirmados', async () => {
  const previousApi = window.electronAPI;
  let notify: ((method: string, params: unknown) => void | Promise<void>) | undefined;
  window.electronAPI = { ...previousApi!, onNotify: (callback) => { notify = callback; return () => {}; } };
  const response = vi.spyOn(agentApi, 'agentRendererResult').mockResolvedValue({ accepted: true });
  try {
    render(<App />);
    await waitFor(() => expect(notify).toBeDefined());
    executeRendererTool.mockRejectedValue(Object.assign(new Error('Respuesta perdida'), { name: 'AgentEffectUncertainError' }));
    await act(async () => { await notify?.('agent.renderer-tool', { id: 'op1', method: 'espacios_espacio_create', params: {} }); });
    expect(response).toHaveBeenCalledWith('op1', undefined, 'Respuesta perdida', true);
    executeRendererTool.mockRejectedValue(new Error('Permiso denegado [42501]'));
    await act(async () => { await notify?.('agent.renderer-tool', { id: 'op2', method: 'espacios_espacio_create', params: {} }); });
    expect(response).toHaveBeenCalledWith('op2', undefined, 'Permiso denegado [42501]', false);
  } finally { window.electronAPI = previousApi; response.mockRestore(); }
});
