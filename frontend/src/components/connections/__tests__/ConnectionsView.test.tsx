import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { connectionsApi, type ConnectionProviderSpec } from '../../../api/connectionsApi';
import { mcpApi } from '../../../api/mcpApi';
import ConnectionsView from '../ConnectionsView';

const { addToast, confirm } = vi.hoisted(() => ({ addToast: vi.fn(), confirm: vi.fn() }));
vi.mock('../../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../../hooks/useDialog', () => ({ useDialog: () => ({ confirm }) }));
vi.mock('../../../api', () => ({ onNotify: () => () => {} }));

const spec = (over: Partial<ConnectionProviderSpec> = {}): ConnectionProviderSpec => ({
  id: 'github', label: 'GitHub', description: 'Repos de GitHub', docs: '', auth_type: 'oauth_secret',
  requires_client_secret: true, scopes: ['repo', 'read:user'], redirect_hint: 'http://127.0.0.1:42831/callback',
  provider: 'github', category: 'desarrollo', configured: true, connected: false, ...over,
});

function Harness() {
  const [detailId, setDetailId] = useState<string | null>(null);
  return <ConnectionsView detailId={detailId} onDetailChange={setDetailId} />;
}

function renderView() {
  return render(<Harness />);
}

async function openDetailAndConnect() {
  renderView();
  fireEvent.click(await screen.findByRole('button', { name: /GitHub/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Conectar con GitHub' }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  addToast.mockClear();
  confirm.mockReset();
  vi.spyOn(mcpApi, 'mcpServersList').mockResolvedValue({ servers: [] });
  vi.spyOn(connectionsApi, 'connectionsProviders').mockResolvedValue({
    providers: [spec()], categories: [{ id: 'desarrollo', label: 'Desarrollo' }],
  });
});

it('pide consentimiento con los permisos antes de abrir el navegador', async () => {
  confirm.mockResolvedValue(true);
  const connect = vi.spyOn(connectionsApi, 'connectionsConnect').mockResolvedValue({
    url: 'https://github.com/login/oauth/authorize', redirect_uri: 'x', opened: true,
  });
  await openDetailAndConnect();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(String(confirm.mock.calls[0][0].description)).toContain('Permisos solicitados: repo, read:user');
  await waitFor(() => expect(connect).toHaveBeenCalledWith('github'));
  expect(await screen.findByRole('button', { name: 'Cancelar conexión' })).toBeInTheDocument();
  expect(screen.getByText(/Esperando autorización en el navegador/)).toBeInTheDocument();
});

it('no abre el navegador si se cancela el consentimiento', async () => {
  confirm.mockResolvedValue(false);
  const connect = vi.spyOn(connectionsApi, 'connectionsConnect');
  await openDetailAndConnect();
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(connect).not.toHaveBeenCalled();
});

it('cancela el flujo en curso y oculta la espera', async () => {
  confirm.mockResolvedValue(true);
  vi.spyOn(connectionsApi, 'connectionsConnect').mockResolvedValue({
    url: 'https://github.com/login/oauth/authorize', redirect_uri: 'x', opened: true,
  });
  const cancelApi = vi.spyOn(connectionsApi, 'connectionsCancel').mockResolvedValue({ success: true });
  await openDetailAndConnect();
  fireEvent.click(await screen.findByRole('button', { name: 'Cancelar conexión' }));
  await waitFor(() => expect(cancelApi).toHaveBeenCalledWith('github'));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancelar conexión' })).not.toBeInTheDocument());
});
