import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { agentApi } from '../../api/agentApi';
import { connectionsApi, type ConnectionProviderSpec } from '../../api/connectionsApi';
import { mcpApi } from '../../api/mcpApi';
import ComplementosView from './ComplementosView';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm: vi.fn() }) }));

const provider = (id: string, label: string, connected: boolean): ConnectionProviderSpec => ({
  id, label, description: `Usa ${label}`, docs: '', auth_type: 'oauth_pkce', requires_client_secret: false, scopes: [],
  redirect_hint: '', provider: id, category: 'desarrollo', configured: true, connected,
});

beforeEach(() => {
  vi.restoreAllMocks(); addToast.mockClear();
  vi.spyOn(connectionsApi, 'connectionsProviders').mockResolvedValue({
    providers: [provider('github', 'GitHub', true), provider('slack', 'Slack', false)],
    categories: [{ id: 'desarrollo', label: 'Desarrollo' }],
  });
  vi.spyOn(mcpApi, 'mcpServersList').mockResolvedValue({ servers: [] });
});

it('lista el catálogo, filtra los conectados y abre el detalle desde Instalados', async () => {
  render(<ComplementosView />);
  const catalog = await screen.findByRole('region', { name: 'Desarrollo' });
  expect(within(catalog).getByText('Slack')).toBeInTheDocument();
  const installed = screen.getByRole('list', { name: 'Complementos instalados' });
  expect(within(installed).queryByText('Slack')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^Conectados/ }));
  expect(within(catalog).queryByText('Slack')).not.toBeInTheDocument();

  fireEvent.click(within(installed).getByRole('button', { name: 'GitHub' }));
  expect(await screen.findByLabelText('Detalle de GitHub')).toBeInTheDocument();
});

it('muestra las habilidades del agente sin cargar sus instrucciones', async () => {
  const list = vi.spyOn(agentApi, 'agentSkillsList').mockResolvedValue({
    skills: [{ id: 'a'.repeat(24), name: 'pdf-review', description: 'Revisa documentos PDF' }],
    library: 'C:/skills', warnings: ['rota: encabezado inválido'], truncated: false,
  });
  render(<ComplementosView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Habilidades' }));
  const skills = await screen.findByRole('region', { name: 'Habilidades disponibles' });
  expect(within(skills).getByText('pdf-review')).toBeInTheDocument();
  expect(screen.getByRole('note', { name: 'Habilidades omitidas' })).toHaveTextContent('rota: encabezado inválido');
  expect(screen.queryByRole('textbox', { name: 'Buscar complementos' })).not.toBeInTheDocument();

  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar habilidades' }), { target: { value: 'excel' } });
  expect(screen.getByText('Sin resultados para «excel».')).toBeInTheDocument();
  expect(list).toHaveBeenCalledTimes(1);
});

it('crea una habilidad nueva y refresca el catálogo', async () => {
  const list = vi.spyOn(agentApi, 'agentSkillsList').mockResolvedValue({
    skills: [], library: 'C:/skills', warnings: [], truncated: false,
  });
  const create = vi.spyOn(agentApi, 'agentSkillCreate').mockResolvedValue({
    skill: { id: 'b'.repeat(24), name: 'critico-docs', description: 'Revisión crítica de documentos' },
  });
  render(<ComplementosView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Habilidades' }));
  await screen.findByText('Todavía no hay habilidades instaladas.');

  fireEvent.click(screen.getByRole('button', { name: 'Nueva habilidad' }));
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Critico Docs!' } });
  fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'Revisión crítica de documentos' } });
  fireEvent.change(screen.getByLabelText('Instrucciones (opcional)'), { target: { value: 'Revisa cada página.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Crear habilidad' }));

  await waitFor(() => expect(create).toHaveBeenCalledWith({
    name: 'critico-docs', description: 'Revisión crítica de documentos', body: 'Revisa cada página.',
  }));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
});

it('normaliza las vocales acentuadas al crear una habilidad', async () => {
  vi.spyOn(agentApi, 'agentSkillsList').mockResolvedValue({
    skills: [], library: 'C:/skills', warnings: [], truncated: false,
  });
  const create = vi.spyOn(agentApi, 'agentSkillCreate').mockResolvedValue({
    skill: { id: 'c'.repeat(24), name: 'analisis-de-pdf', description: 'Analiza documentos PDF' },
  });
  render(<ComplementosView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Habilidades' }));
  await screen.findByText('Todavía no hay habilidades instaladas.');

  fireEvent.click(screen.getByRole('button', { name: 'Nueva habilidad' }));
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Análisis de PDF' } });
  fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'Analiza documentos PDF' } });
  fireEvent.click(screen.getByRole('button', { name: 'Crear habilidad' }));

  await waitFor(() => expect(create).toHaveBeenCalledWith({
    name: 'analisis-de-pdf', description: 'Analiza documentos PDF',
  }));
});
