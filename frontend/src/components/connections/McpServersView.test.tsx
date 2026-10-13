import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { mcpApi } from '../../api/mcpApi';
import McpServersView from './McpServersView';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }));

beforeEach(() => {
  vi.restoreAllMocks(); addToast.mockClear();
  vi.spyOn(mcpApi, 'mcpServersList').mockResolvedValue({ servers: [{ id: 's1', name: 'Servidor local', transport: 'stdio',
    url: '', command: 'python', args: ['mcp.py'], secret_keys: ['API_KEY'], tools_count: 1 }] });
  vi.spyOn(mcpApi, 'mcpServerTools').mockResolvedValue({ tools: [{ name: 'search', description: 'Buscar', enabled: true }] });
});

it('revierte la selección si falla su persistencia y muestra sólo las claves públicas', async () => {
  const toggle = vi.spyOn(mcpApi, 'mcpServerToolSet').mockRejectedValue(new Error('Disco no disponible'));
  render(<McpServersView />);
  fireEvent.click(await screen.findByRole('button', { name: /1 herramientas/ }));
  const control = await screen.findByRole('switch', { name: 'Habilitar search' });
  fireEvent.click(control);
  await waitFor(() => expect(toggle).toHaveBeenCalledWith('s1', 'search', false));
  await waitFor(() => expect(control).toHaveAttribute('aria-checked', 'true'));
  expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  expect(screen.getByText('Claves: API_KEY')).toBeInTheDocument();
});

it('el JSON conserva argumentos con espacios y separa los secretos', async () => {
  const add = vi.spyOn(mcpApi, 'mcpServerAdd').mockResolvedValue({ server: { id: 's2', name: 'Otro', transport: 'stdio', url: '', command: 'python', args: [], secret_keys: [], tools_count: null } });
  render(<McpServersView />);
  fireEvent.click(screen.getByRole('button', { name: 'Añadir servidor' }));
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Configuración JSON del servidor' }), { target: { value: JSON.stringify({ name: 'Otro', transport: 'stdio', command: 'python', args: ['archivo con espacios.py'] }) } });
  fireEvent.click(screen.getByRole('button', { name: 'Formulario' }));
  expect(screen.getByRole('textbox', { name: 'Nombre del servidor' })).toHaveValue('Otro');
  fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
  expect(JSON.parse((screen.getByRole('textbox', { name: 'Configuración JSON del servidor' }) as HTMLTextAreaElement).value).args).toEqual(['archivo con espacios.py']);
  fireEvent.change(screen.getByRole('textbox', { name: 'Secretos del servidor' }), { target: { value: 'API_KEY=secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Registrar servidor' }));
  await waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({ args: ['archivo con espacios.py'], secrets: { env: { API_KEY: 'secret' } } })));
});
