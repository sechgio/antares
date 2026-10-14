import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { aiProvidersApi, type AiProviderSpec } from '../../api/aiProvidersApi';
import ProvidersView from './ProvidersView';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));

const provider: AiProviderSpec = {
  id: 'anthropic', provider: 'anthropic', label: 'Anthropic', description: 'Messages', docs: '',
  editable_base_url: true, default_base_url: 'https://api.anthropic.com',
  base_url: 'https://proxy.example.com/anthropic/v1', default_model: 'custom-model',
  configured: true, has_key: true, key_masked: '••••1234', needs_key: true,
};

beforeEach(() => {
  vi.restoreAllMocks();
  addToast.mockClear();
  vi.spyOn(aiProvidersApi, 'aiProvidersList').mockResolvedValue({ providers: [provider] });
  vi.spyOn(aiProvidersApi, 'aiProviderSave').mockResolvedValue({ provider });
});

it('muestra la dirección y el modelo guardados al volver a la configuración', async () => {
  render(<ProvidersView />);
  expect(await screen.findByLabelText('Base URL Anthropic')).toHaveValue(provider.base_url);
  expect(screen.getByLabelText('Modelo Anthropic')).toHaveValue('custom-model');
});

it('conserva la dirección y el modelo personalizados al actualizar solo la clave', async () => {
  render(<ProvidersView />);
  fireEvent.change(await screen.findByLabelText('API key Anthropic'), { target: { value: 'new-key' } });
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await waitFor(() => expect(aiProvidersApi.aiProviderSave).toHaveBeenCalledWith({
    provider: 'anthropic', api_key: 'new-key', base_url: provider.base_url, model: 'custom-model',
  }));
  expect(screen.getByLabelText('API key Anthropic')).toHaveValue('');
});

it('permite volver a la dirección y al modelo predeterminados sin reemplazar la clave', async () => {
  render(<ProvidersView />);
  fireEvent.change(await screen.findByLabelText('Base URL Anthropic'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Modelo Anthropic'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await waitFor(() => expect(aiProvidersApi.aiProviderSave).toHaveBeenCalledWith({
    provider: 'anthropic', api_key: undefined, base_url: '', model: '',
  }));
});

it('puede probar inmediatamente después de restaurar los valores predeterminados', async () => {
  const restored = { ...provider, base_url: provider.default_base_url, default_model: 'official-model' };
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValueOnce({ providers: [provider] }).mockResolvedValue({ providers: [restored] });
  vi.spyOn(aiProvidersApi, 'aiProviderStatus').mockResolvedValue({ provider: { ...restored, reachable: true, models_count: 1, error: null } });
  render(<ProvidersView />);
  fireEvent.change(await screen.findByLabelText('Base URL Anthropic'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Modelo Anthropic'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Probar' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Probar' }));
  await waitFor(() => expect(aiProvidersApi.aiProviderStatus).toHaveBeenCalledOnce());
  expect(screen.getByLabelText('Base URL Anthropic')).toHaveValue(restored.base_url);
  expect(screen.getByLabelText('Modelo Anthropic')).toHaveValue(restored.default_model);
});

it('invalida el resultado de la prueba cuando cambian los ajustes y pide guardarlos antes de probar', async () => {
  vi.spyOn(aiProvidersApi, 'aiProviderStatus').mockResolvedValue({ provider: { ...provider, reachable: true, models_count: 2, error: null } });
  render(<ProvidersView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Probar' }));
  expect(await screen.findByText('Disponible · 2 modelos')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Base URL Anthropic'), { target: { value: 'https://other.example.com/v1' } });
  expect(screen.queryByText('Disponible · 2 modelos')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Probar' }));
  expect(aiProvidersApi.aiProviderStatus).toHaveBeenCalledTimes(1);
  expect(addToast).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringMatching(/Guarda/) }));
});

it.each(['openai', 'anthropic'])('guarda, prueba y elimina la configuración de %s sin enviar la clave enmascarada', async (id) => {
  const current = { ...provider, id, provider: id, label: id };
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [current] });
  const probe = vi.spyOn(aiProvidersApi, 'aiProviderStatus').mockResolvedValue({ provider: { ...current, reachable: false, models_count: null, error: 'HTTP 401' } });
  const remove = vi.spyOn(aiProvidersApi, 'aiProviderDelete').mockResolvedValue({ deleted: true });
  render(<ProvidersView />);
  fireEvent.change(await screen.findByLabelText(`Modelo ${id}`), { target: { value: 'otro-modelo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await waitFor(() => expect(aiProvidersApi.aiProviderSave).toHaveBeenCalledWith({
    provider: id, api_key: undefined, base_url: current.base_url, model: 'otro-modelo',
  }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Probar' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Probar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 401');
  expect(probe).toHaveBeenCalledWith(id);
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(id));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
