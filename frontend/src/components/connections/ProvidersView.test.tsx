import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { aiProvidersApi, type AiProviderSpec } from '../../api/aiProvidersApi';
import ProvidersView from './ProvidersView';

const { addToast, confirm } = vi.hoisted(() => ({ addToast: vi.fn(), confirm: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm }) }));

const provider: AiProviderSpec = {
  id: 'anthropic', provider: 'anthropic', label: 'Anthropic', description: 'Messages', docs: '',
  editable_base_url: true, default_base_url: 'https://api.anthropic.com',
  base_url: 'https://proxy.example.com/anthropic/v1', default_model: 'custom-model',
  configured: true, has_key: true, key_masked: '••••1234', needs_key: true,
};

const customProvider: AiProviderSpec = {
  ...provider,
  id: 'custom-mi-gateway-1a2b3c', provider: 'custom-mi-gateway-1a2b3c', label: 'Mi gateway',
  description: 'Modelo personalizado · OpenAI compatible (Chat Completions)',
  custom: true, api: 'openai', base_url: 'https://gateway.example.com/v1',
  default_base_url: 'https://gateway.example.com/v1', default_model: 'mi-modelo',
  key_masked: '••••9876',
};

beforeEach(() => {
  vi.restoreAllMocks();
  addToast.mockClear();
  confirm.mockReset().mockResolvedValue(true);
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

function pick(name: string, steps: number) {
  const select = screen.getByRole('button', { name });
  for (let i = 0; i <= steps; i += 1) fireEvent.keyDown(select, { key: 'ArrowDown' });
  fireEvent.keyDown(select, { key: 'Enter' });
}

it('añade un modelo de Anthropic con el endpoint del preset y el ID como nombre', async () => {
  const save = vi.spyOn(aiProvidersApi, 'aiProviderCustomSave').mockResolvedValue({ id: customProvider.id, provider: customProvider });
  render(<ProvidersView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Añadir modelo' }));
  const dialog = screen.getByRole('dialog', { name: 'Añadir modelo personalizado' });
  expect(within(dialog).getByText('Endpoint: https://api.anthropic.com')).toBeVisible();

  const model = within(dialog).getByRole('combobox', { name: 'Modelo personalizado' });
  fireEvent.focus(model);
  fireEvent.change(model, { target: { value: 'opus' } });
  fireEvent.mouseDown(within(dialog).getByRole('option', { name: /claude-opus-5-5/ }));
  expect(model).toHaveValue('claude-opus-5-5');
  fireEvent.change(within(dialog).getByLabelText('Clave del modelo personalizado'), { target: { value: 'sk-ant-1' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir modelo' }));

  await waitFor(() => expect(save).toHaveBeenCalledWith({
    label: 'claude-opus-5-5',
    api: 'anthropic',
    base_url: 'https://api.anthropic.com',
    model: 'claude-opus-5-5',
    api_key: 'sk-ant-1',
  }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('valida el modelo y la clave antes de guardar', async () => {
  const save = vi.spyOn(aiProvidersApi, 'aiProviderCustomSave');
  render(<ProvidersView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Añadir modelo' }));
  const dialog = screen.getByRole('dialog', { name: 'Añadir modelo personalizado' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir modelo' }));
  expect(within(dialog).getByText('Introduce el ID del modelo.')).toBeVisible();
  expect(within(dialog).getByText('Introduce una clave o elige otra forma de autenticación.')).toBeVisible();
  expect(save).not.toHaveBeenCalled();
});

it('añade un modelo de otro proveedor con formato, dirección, nombre y clave', async () => {
  const save = vi.spyOn(aiProvidersApi, 'aiProviderCustomSave').mockResolvedValue({ id: customProvider.id, provider: customProvider });
  render(<ProvidersView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Añadir modelo' }));
  const dialog = screen.getByRole('dialog', { name: 'Añadir modelo personalizado' });
  pick('Proveedor del modelo personalizado', 4);
  pick('Formato de API del modelo personalizado', 1);
  fireEvent.change(within(dialog).getByLabelText('Dirección base del modelo personalizado'), { target: { value: 'https://gateway.example.com/v1' } });
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'Modelo personalizado' }), { target: { value: 'mi-modelo' } });
  fireEvent.change(within(dialog).getByLabelText('Clave del modelo personalizado'), { target: { value: 'sk-9876' } });
  fireEvent.change(within(dialog).getByLabelText('Nombre del modelo personalizado'), { target: { value: 'Mi gateway' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir modelo' }));

  await waitFor(() => expect(save).toHaveBeenCalledWith({
    label: 'Mi gateway',
    api: 'anthropic',
    base_url: 'https://gateway.example.com/v1',
    model: 'mi-modelo',
    api_key: 'sk-9876',
  }));
  expect(addToast).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'success' }));
});

it('muestra el error del servicio dentro del editor sin cerrarlo', async () => {
  vi.spyOn(aiProvidersApi, 'aiProviderCustomSave').mockRejectedValue(new Error('base_url debe ser una URL http(s) válida'));
  render(<ProvidersView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Añadir modelo' }));
  const dialog = screen.getByRole('dialog', { name: 'Añadir modelo personalizado' });
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'Modelo personalizado' }), { target: { value: 'x' } });
  fireEvent.change(within(dialog).getByLabelText('Clave del modelo personalizado'), { target: { value: 'k' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir modelo' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('base_url debe ser una URL http(s) válida');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('edita un modelo personalizado sin reemplazar la clave y permite probarlo y eliminarlo', async () => {
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [customProvider] });
  const save = vi.spyOn(aiProvidersApi, 'aiProviderCustomSave').mockResolvedValue({
    id: customProvider.id,
    provider: customProvider,
  });
  const probe = vi.spyOn(aiProvidersApi, 'aiProviderStatus').mockResolvedValue({
    provider: { ...customProvider, reachable: true, models_count: 3, models: ['mi-modelo', 'mi-modelo-2', 'otro'], error: null },
  });
  const remove = vi.spyOn(aiProvidersApi, 'aiProviderDelete').mockResolvedValue({ deleted: true });
  render(<ProvidersView />);

  expect(await screen.findByText('mi-modelo')).toBeVisible();
  expect(screen.getByText('Modelos personalizados · 1')).toBeVisible();
  expect(screen.getByText('••••9876')).toBeVisible();
  expect(screen.getByText('OpenAI compatible (Chat Completions)')).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Probar Mi gateway' }));
  expect(await screen.findByText('Disponible · 3 modelos')).toBeVisible();
  expect(probe).toHaveBeenCalledWith(customProvider.id);

  fireEvent.click(screen.getByRole('button', { name: 'Editar Mi gateway' }));
  const dialog = screen.getByRole('dialog', { name: 'Editar modelo personalizado' });
  const model = within(dialog).getByRole('combobox', { name: 'Modelo personalizado' });
  expect(model).toHaveValue('mi-modelo');
  expect(within(dialog).getByLabelText('Dirección base del modelo personalizado')).toHaveValue('https://gateway.example.com/v1');
  fireEvent.focus(model);
  fireEvent.change(model, { target: { value: 'mi-modelo-' } });
  fireEvent.mouseDown(await within(dialog).findByRole('option', { name: 'mi-modelo-2' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));

  await waitFor(() => expect(save).toHaveBeenCalledWith({
    id: customProvider.id,
    label: 'Mi gateway',
    api: 'openai',
    base_url: 'https://gateway.example.com/v1',
    model: 'mi-modelo-2',
  }));
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Mi gateway' }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(customProvider.id));
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ type: 'destructive' }));
});

it('no elimina el modelo si se cancela la confirmación', async () => {
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [customProvider] });
  const remove = vi.spyOn(aiProvidersApi, 'aiProviderDelete');
  confirm.mockResolvedValue(false);
  render(<ProvidersView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Mi gateway' }));
  await waitFor(() => expect(confirm).toHaveBeenCalled());
  expect(remove).not.toHaveBeenCalled();
});

it('permite quitar la clave guardada de un modelo personalizado', async () => {
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [customProvider] });
  vi.spyOn(aiProvidersApi, 'aiProviderStatus').mockResolvedValue({
    provider: { ...customProvider, reachable: false, models_count: null, models: [], error: 'x' },
  });
  const save = vi.spyOn(aiProvidersApi, 'aiProviderCustomSave').mockResolvedValue({
    id: customProvider.id,
    provider: customProvider,
  });
  render(<ProvidersView />);

  fireEvent.click(await screen.findByRole('button', { name: 'Editar Mi gateway' }));
  const dialog = screen.getByRole('dialog', { name: 'Editar modelo personalizado' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Sin clave' }));
  expect(within(dialog).getByText('Al guardar se eliminará la clave guardada.')).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));

  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
    id: customProvider.id,
    remove_key: true,
  })));
  expect(save.mock.calls.at(-1)?.[0]).not.toHaveProperty('api_key');
});

it('muestra los modelos ilegibles con opción de eliminarlos', async () => {
  const invalidProvider: AiProviderSpec = {
    ...customProvider,
    id: 'custom-roto-aaaaaa',
    provider: 'custom-roto-aaaaaa',
    label: 'Modelo no válido',
    description: 'No se pudo leer su configuración guardada',
    api: '',
    invalid: true,
    configured: false,
    has_key: false,
    key_masked: null,
    base_url: '',
    default_base_url: '',
    default_model: '',
    needs_key: false,
  };
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [invalidProvider] });
  const remove = vi.spyOn(aiProvidersApi, 'aiProviderDelete').mockResolvedValue({ deleted: true });
  render(<ProvidersView />);

  expect(await screen.findByText('Modelo no válido')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Probar Modelo no válido' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar custom-roto-aaaaaa' }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith('custom-roto-aaaaaa'));
});

it('muestra un error con reintento si no puede cargar el listado', async () => {
  vi.mocked(aiProvidersApi.aiProvidersList)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ providers: [provider] });
  render(<ProvidersView />);

  expect(await screen.findByText('No se pudieron cargar los proveedores.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByLabelText('Base URL Anthropic')).toHaveValue(provider.base_url);
});
