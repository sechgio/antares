import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { aiProvidersApi, type AiProviderSpec, type AiProviderStatus } from '../../api/aiProvidersApi';
import ModelPicker from './ModelPicker';

const providers: AiProviderSpec[] = [
  { id: 'local', label: 'Local', description: '', docs: '', editable_base_url: false, default_base_url: '', default_model: 'llama3.1', provider: 'openai', configured: true, has_key: true, key_masked: null, base_url: '', needs_key: false },
  { id: 'openai', label: 'OpenAI', description: '', docs: '', editable_base_url: false, default_base_url: '', default_model: 'gpt-4o', provider: 'openai', configured: true, has_key: true, key_masked: null, base_url: '', needs_key: false },
];

function status(id: string, models: string[], error: string | null = null): { provider: AiProviderStatus } {
  const spec = providers.find((item) => item.id === id)!;
  return { provider: { ...spec, reachable: error === null, models_count: models.length, models, error } };
}

function mockStatus(local: string[], error: string | null = null) {
  return vi.spyOn(aiProvidersApi, 'aiProviderStatus').mockImplementation(async (id: string) => (
    id === 'openai' ? status('openai', ['gpt-4o', 'gpt-4.1']) : status('local', local, error)
  ));
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('lista los modelos reales del proveedor y elige uno', async () => {
  const list = mockStatus(['llama3.1', 'llama3.2', 'qwen2.5']);
  const change = vi.fn();
  render(<ModelPicker providers={providers} value={{ provider: 'local', model: 'llama3.1' }} onChange={change} />);
  fireEvent.click(screen.getByLabelText('Elegir proveedor y modelo'));

  const dialog = screen.getByRole('dialog', { name: 'Modelos disponibles' });
  await waitFor(() => expect(within(dialog).getByText('qwen2.5')).toBeInTheDocument());
  expect(list).toHaveBeenCalledWith('local');
  fireEvent.click(within(dialog).getByText('llama3.2'));
  expect(change).toHaveBeenCalledWith({ provider: 'local', model: 'llama3.2' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('filtra por nombre y permite escribir un modelo que no aparece', async () => {
  mockStatus(['llama3.1', 'qwen2.5']);
  const change = vi.fn();
  render(<ModelPicker providers={providers} value={{ provider: 'local', model: 'llama3.1' }} onChange={change} />);
  fireEvent.click(screen.getByLabelText('Elegir proveedor y modelo'));
  const dialog = screen.getByRole('dialog', { name: 'Modelos disponibles' });
  await waitFor(() => expect(within(dialog).getByText('qwen2.5')).toBeInTheDocument());

  fireEvent.change(within(dialog).getByLabelText('Buscar modelo'), { target: { value: 'qwen' } });
  expect(within(dialog).queryByText('llama3.1')).toBeNull();
  fireEvent.click(within(dialog).getByText('qwen2.5'));
  expect(change).toHaveBeenCalledWith({ provider: 'local', model: 'qwen2.5' });

  fireEvent.click(screen.getByLabelText('Elegir proveedor y modelo'));
  const again = screen.getByRole('dialog', { name: 'Modelos disponibles' });
  await waitFor(() => expect(within(again).getByText('llama3.1')).toBeInTheDocument());
  fireEvent.change(within(again).getByLabelText('Buscar modelo'), { target: { value: 'modelo-propio' } });
  fireEvent.click(within(again).getByText('Usar «modelo-propio»'));
  expect(change).toHaveBeenLastCalledWith({ provider: 'local', model: 'modelo-propio' });
});

it('agrupa los modelos de todos los proveedores y elige uno de otro proveedor', async () => {
  const list = mockStatus(['llama3.1', 'llama3.2']);
  const change = vi.fn();
  render(<ModelPicker providers={providers} value={{ provider: 'local', model: 'llama3.1' }} onChange={change} />);
  fireEvent.click(screen.getByLabelText('Elegir proveedor y modelo'));
  const dialog = screen.getByRole('dialog', { name: 'Modelos disponibles' });
  const openai = await within(dialog).findByRole('group', { name: 'OpenAI' });
  await waitFor(() => expect(within(openai).getByText('gpt-4.1')).toBeInTheDocument());
  expect(within(within(dialog).getByRole('group', { name: 'Local' })).getByText('llama3.2')).toBeInTheDocument();
  expect(list).toHaveBeenCalledWith('local');
  expect(list).toHaveBeenCalledWith('openai');
  fireEvent.click(within(openai).getByText('gpt-4.1'));
  expect(change).toHaveBeenCalledWith({ provider: 'openai', model: 'gpt-4.1' });
});

it('explica el fallo y aun así acepta un modelo manual', async () => {
  mockStatus([], 'El proveedor no responde');
  const change = vi.fn();
  render(<ModelPicker providers={providers} value={{ provider: 'local', model: 'llama3.1' }} onChange={change} />);
  fireEvent.click(screen.getByLabelText('Elegir proveedor y modelo'));
  const dialog = screen.getByRole('dialog', { name: 'Modelos disponibles' });
  await waitFor(() => expect(within(dialog).getByText('El proveedor no responde')).toBeInTheDocument());
  expect(within(dialog).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('Buscar modelo'), { target: { value: 'manual-1' } });
  fireEvent.click(within(dialog).getByText('Usar «manual-1»'));
  expect(change).toHaveBeenCalledWith({ provider: 'local', model: 'manual-1' });
});

it('permite recorrer la lista con teclado y señala la selección actual', async () => {
  mockStatus(['llama3.1', 'qwen2.5']);
  const change = vi.fn();
  render(<ModelPicker providers={providers} value={{ provider: 'local', model: 'llama3.1' }} onChange={change} />);
  const trigger = screen.getByLabelText('Elegir proveedor y modelo');
  fireEvent.click(trigger);
  const search = await screen.findByRole('combobox', { name: 'Buscar modelo' });
  await screen.findByRole('option', { name: /qwen2.5/ });
  expect(screen.getByRole('option', { name: /llama3.1/ })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(search).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: /qwen2.5/ }).id);
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(change).toHaveBeenCalledWith({ provider: 'local', model: 'qwen2.5' });
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.keyDown(await screen.findByRole('combobox'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('agrupa los modelos personalizados y los elige sin consultar su servicio', async () => {
  const custom: AiProviderSpec = {
    ...providers[1], id: 'custom-mi-gateway-1a2b3c', label: 'Mi gateway', default_model: 'mi-modelo', custom: true, api: 'openai',
  };
  const list = mockStatus(['llama3.1']);
  const change = vi.fn();
  render(<ModelPicker providers={[...providers, custom]} value={{ provider: custom.id, model: 'mi-modelo' }} onChange={change} />);
  const trigger = screen.getByLabelText('Elegir proveedor y modelo');
  expect(trigger).toHaveTextContent('Mi gateway');
  fireEvent.click(trigger);

  const dialog = screen.getByRole('dialog', { name: 'Modelos disponibles' });
  const option = within(within(dialog).getByRole('group', { name: 'Personalizados' })).getByRole('option', { name: /Mi gateway/ });
  expect(option).toHaveAttribute('aria-selected', 'true');
  expect(option).toHaveTextContent('mi-modelo');
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(list).not.toHaveBeenCalledWith(custom.id);
  fireEvent.click(option);
  expect(change).toHaveBeenCalledWith({ provider: custom.id, model: 'mi-modelo' });
});

it('busca bajo demanda los modelos activos de un modelo personalizado y elige uno', async () => {
  const custom: AiProviderSpec = {
    ...providers[1], id: 'custom-inferencia-1a2b3c', label: 'Inferencia', default_model: 'zai-org/GLM-5.3-Flash', custom: true, api: 'openai',
  };
  const list = vi.spyOn(aiProvidersApi, 'aiProviderStatus').mockImplementation(async (id: string) => (
    id === custom.id
      ? { provider: { ...custom, reachable: true, models_count: 2, models: ['zai-org/GLM-5.3-Flash', 'deepseek-ai/DeepSeek-V4'], error: null } }
      : status(id, [])
  ));
  const change = vi.fn();
  render(<ModelPicker providers={[...providers, custom]} value={{ provider: custom.id, model: custom.default_model }} onChange={change} />);
  fireEvent.click(screen.getByLabelText('Elegir proveedor y modelo'));
  const group = within(screen.getByRole('dialog', { name: 'Modelos disponibles' })).getByRole('group', { name: 'Personalizados' });
  expect(list).not.toHaveBeenCalledWith(custom.id);
  fireEvent.click(within(group).getByRole('button', { name: 'Buscar modelos activos de Inferencia' }));
  const fetched = await within(group).findByRole('option', { name: /DeepSeek-V4/ });
  expect(list).toHaveBeenCalledWith(custom.id);
  expect(within(group).getAllByRole('option')).toHaveLength(2);
  fireEvent.click(fetched);
  expect(change).toHaveBeenCalledWith({ provider: custom.id, model: 'deepseek-ai/DeepSeek-V4' });
});
