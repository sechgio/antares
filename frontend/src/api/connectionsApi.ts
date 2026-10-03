import { _invoke } from './core';

export interface ConnectionProviderSpec {
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

export interface ConnectionStatus {
  provider: string;
  configured: boolean;
  client_id_masked?: string;
  connected: boolean;
  account?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
  auth_type: string;
  redirect_hint: string;
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
  connectionsDisconnect: (provider: string) =>
    _invoke<{ success: boolean }>('connections_disconnect', { provider }),
  connectionsStatus: (provider: string) =>
    _invoke<ConnectionStatus>('connections_status', { provider }),
};
