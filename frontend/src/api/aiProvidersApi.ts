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
  custom?: boolean;
  api?: string;
  invalid?: boolean;
  capabilities?: AiModelCapabilities;
}

export interface AiModelCapabilities {
  vision?: boolean;
  context_window?: number;
}

export type AiProviderApiFormat = 'openai' | 'anthropic';

interface AiProviderCustomInput {
  id?: string;
  label: string;
  api: AiProviderApiFormat;
  base_url: string;
  model: string;
  api_key?: string;
  remove_key?: boolean;
  vision?: boolean | null;
  context_window?: number | null;
}

export interface AiProviderStatus extends AiProviderSpec {
  reachable: boolean;
  models_count: number | null;
  models: string[];
  error: string | null;
}

export const aiProvidersApi = {
  aiProvidersList: (p?: { include_invalid?: boolean }) =>
    _invoke<{ providers: AiProviderSpec[] }>('ai_providers_list', p ?? {}),

  aiProviderSave: (p: { provider: string; api_key?: string; base_url?: string; model?: string }) =>
    _invoke<{ provider: AiProviderSpec }>('ai_provider_save', p),

  aiProviderCustomSave: (p: AiProviderCustomInput) =>
    _invoke<{ id: string; provider: AiProviderSpec }>('ai_provider_custom_save', { ...p }),

  aiProviderDelete: (provider: string) =>
    _invoke<{ deleted: boolean }>('ai_provider_delete', { provider }),

  aiProviderStatus: (provider: string) =>
    _invoke<{ provider: AiProviderStatus }>('ai_provider_status', { provider }),
};
