import { _invoke } from './core';

interface ConnectionState {
  state?: 'connecting' | 'unconfigured' | 'unavailable' | 'disconnected' | 'reauth_required' | 'missing_scopes' | 'connected';
  status_message?: string;
  missing_scopes?: string[];
  public_app?: boolean;
}

export interface ConnectionProviderSpec extends ConnectionState {
  id: string;
  label: string;
  description: string;
  docs: string;
  auth_type: 'oauth_secret' | 'oauth_pkce';
  requires_client_secret: boolean;
  scopes: string[];
  redirect_hint: string;
  provider: string;
  category?: string;
  configured: boolean;
  client_id_masked?: string;
  connected: boolean;
  account?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
}

export interface ConnectionCategory {
  id: string;
  label: string;
}

export const connectionsApi = {
  connectionsProviders: () =>
    _invoke<{ providers: ConnectionProviderSpec[]; categories: ConnectionCategory[] }>(
      'connections_providers',
    ),
  connectionsOauthConfigSave: (params: {
    provider: string;
    client_id: string;
    client_secret?: string;
  }) => _invoke<{ success: boolean; configured: boolean }>('connections_oauth_config_save', params),
  connectionsConnect: (provider: string) =>
    _invoke<{ url: string; redirect_uri: string; opened: boolean }>('connections_connect', {
      provider,
    }),
  connectionsCancel: (provider: string) =>
    _invoke<{ success: boolean }>('connections_cancel', { provider }),
  connectionsDisconnect: (provider: string) =>
    _invoke<{ success: boolean }>('connections_disconnect', { provider }),
};
