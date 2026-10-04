import { _invoke } from './core';

export interface AiProviderSpec {
  id: string;
  label: string;
  description: string;
  docs: string;
  editable_base_url: boolean;
  default_base_url: string;
  default_model: string;
  provider: string;
  configured: boolean;
  has_key: boolean;
  key_masked: string | null;
  base_url: string;
  needs_key: boolean;
}

export interface AiProviderStatus extends AiProviderSpec {
  reachable: boolean;
  models_count: number | null;
  error: string | null;
}

export const aiProvidersApi = {
  aiProvidersList: () => _invoke<{ providers: AiProviderSpec[] }>('ai_providers_list'),

  aiProviderSave: (p: { provider: string; api_key?: string; base_url?: string }) =>
    _invoke<{ provider: AiProviderSpec }>('ai_provider_save', p),

  aiProviderDelete: (provider: string) =>
    _invoke<{ deleted: boolean }>('ai_provider_delete', { provider }),

  aiProviderStatus: (provider: string) =>
    _invoke<{ provider: AiProviderStatus }>('ai_provider_status', { provider }),
};
