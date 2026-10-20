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

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it('lista los modelos reales del proveedor y elige uno', async () => {
  const list = vi.spyOn(aiProvidersApi, 'aiProviderStatus').mockResolvedValue(status('local', ['llama3.1', 'llama3.2', 'qwen2.5']));
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
  vi.spyOn(aiProvidersApi, 'aiProviderStatus').mockResolvedValue(status('local', ['llama3.1', 'qwen2.5']));
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

it('cambia de proveedor y conserva recientes', async () => {
  localStorage.setItem('antares-agent-models', JSON.stringify([{ provider: 'local', model: 'llama3.2' }]));
  const list = vi.spyOn(aiProvidersApi, 'aiProviderStatus').mockImplementation(async (id: string) => (
    id === 'openai' ? status('openai', ['gpt-4o', 'gpt-4.1']) : status('local', ['llama3.1', 'llama3.2'])
  ));
  render(<ModelPicker providers={providers} value={{ provider: 'local', model: 'llama3.1' }} onChange={vi.fn()} />);
  fireEvent.click(screen.getByLabelText('Elegir proveedor y modelo'));
  const dialog = screen.getByRole('dialog', { name: 'Modelos disponibles' });
  await waitFor(() => expect(within(dialog).getByText('Recientes')).toBeInTheDocument());
  expect(within(dialog).getAllByText('llama3.2')).toHaveLength(1);

  fireEvent.click(within(dialog).getByRole('button', { name: 'OpenAI' }));
  await waitFor(() => expect(within(dialog).getByText('gpt-4.1')).toBeInTheDocument());
  expect(list).toHaveBeenCalledWith('openai');
  expect(within(dialog).queryByText('Recientes')).toBeNull();
});

it('explica el fallo y aun así acepta un modelo manual', async () => {
  vi.spyOn(aiProvidersApi, 'aiProviderStatus').mockResolvedValue(status('local', [], 'El proveedor no responde'));
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
