import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ConnectionProviderSpec } from '../../api/connectionsApi';
import ConnectionDetail from './ConnectionDetail';

vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

const google: ConnectionProviderSpec = {
  id: 'google', provider: 'google', label: 'Google', description: 'Drive y Sheets', docs: 'https://console.cloud.google.com',
  auth_type: 'oauth_secret', requires_client_secret: true, scopes: ['openid'], redirect_hint: 'http://127.0.0.1:42846/callback',
  configured: true, connected: false, state: 'disconnected', status_message: 'Cuenta desconectada',
};

function renderDetail(provider: ConnectionProviderSpec, onConnect = vi.fn()) {
  render(<ConnectionDetail provider={provider} connecting={false} onConnect={onConnect} onDisconnect={vi.fn()}
    onSaveCreds={vi.fn()} onClose={vi.fn()} />);
  return onConnect;
}

it('con la app pública de Antares conecta directo sin pedir Client ID', () => {
  const onConnect = renderDetail({ ...google, public_app: true });
  expect(screen.queryByLabelText('Client ID de Google')).not.toBeInTheDocument();
  expect(screen.queryByText('2. Registra la dirección de retorno')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Conectar con Google'));
  expect(onConnect).toHaveBeenCalledOnce();
});

it('sin app pública conserva el formulario de credenciales propio', () => {
  renderDetail({ ...google, configured: false });
  expect(screen.getByLabelText('Client ID de Google')).toBeInTheDocument();
  expect(screen.getByText('Conectar con Google').closest('button')).toBeDisabled();
});
