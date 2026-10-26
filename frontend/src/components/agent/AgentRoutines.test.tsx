import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentSession, type AgentTask } from '../../api/agentApi';
import AgentRoutines from './AgentRoutines';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));

const bot = { id: 'bot', name: 'Rutinario' };
const sessions: AgentSession[] = [
  { id: 'old', title: 'Antigua', provider: 'local', model: 'm', created_at: 1, updated_at: 1, last_error: null, profile: bot },
  { id: 'new', title: 'Reciente', provider: 'local', model: 'm', created_at: 2, updated_at: 5, last_error: null, profile: bot },
  { id: 'other', title: 'Otra', provider: 'local', model: 'm', created_at: 3, updated_at: 9, last_error: null },
];
const task = (id: string, extra: Partial<AgentTask>): AgentTask => ({
  id, session_id: 'old', content: `Rutina ${id}`, due_at: 1, interval_ms: 3_600_000, status: 'pending', created_at: 1, ...extra,
});

beforeEach(() => {
  vi.restoreAllMocks();
  addToast.mockClear();
  vi.spyOn(agentApi, 'agentSessionsList').mockResolvedValue({ sessions });
});

it('lista solo las rutinas activas del agente y crea las nuevas en su conversación más reciente', async () => {
  vi.spyOn(agentApi, 'agentTasksList').mockResolvedValue({ queues: [], tasks: [
    task('diaria', { interval_ms: 86_400_000 }),
    task('unica', { interval_ms: 0 }),
    task('cancelada', { status: 'cancelled' }),
    task('ajena', { session_id: 'other' }),
  ] });
  const save = vi.spyOn(agentApi, 'agentTasksSave').mockResolvedValue({ scheduled: task('nueva', {}) });
  await act(async () => { render(<AgentRoutines profileId="bot" />); });
  const list = within(screen.getByRole('list', { name: 'Rutinas del agente' }));
  expect(list.getAllByRole('listitem')).toHaveLength(1);
  expect(list.getByText('Rutina diaria')).toBeInTheDocument();
  expect(list.getByText('cada día')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Encargo de la rutina'), { target: { value: 'Resume los correos' } });
  fireEvent.change(screen.getByLabelText('Repetir cada (minutos)'), { target: { value: '60' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Añadir' })); });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'new', content: 'Resume los correos', every_minutes: 60 }));
});

it('cancela una rutina y avisa cuando el agente ya tiene tres', async () => {
  const list = vi.spyOn(agentApi, 'agentTasksList').mockResolvedValue({ queues: [], tasks: [task('a', {}), task('b', {}), task('c', {})] });
  const cancel = vi.spyOn(agentApi, 'agentTasksCancel').mockResolvedValue({ cancelled: true, id: 'a' });
  await act(async () => { render(<AgentRoutines profileId="bot" />); });
  expect(screen.getByText(/ya tiene 3 rutinas/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Encargo de la rutina')).not.toBeInTheDocument();
  list.mockResolvedValue({ queues: [], tasks: [task('b', {}), task('c', {})] });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancelar rutina: Rutina a' })); });
  expect(cancel).toHaveBeenCalledWith('a');
  expect(screen.getByLabelText('Encargo de la rutina')).toBeInTheDocument();
});

it('pide abrir una conversación cuando el agente aún no tiene ninguna', async () => {
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [sessions[2]] });
  vi.spyOn(agentApi, 'agentTasksList').mockResolvedValue({ queues: [], tasks: [] });
  await act(async () => { render(<AgentRoutines profileId="bot" />); });
  expect(screen.getByText(/Abre una conversación con este agente/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Añadir' })).not.toBeInTheDocument();
});
