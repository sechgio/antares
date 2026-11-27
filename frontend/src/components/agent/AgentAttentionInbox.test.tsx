import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { agentApi, type AgentSession, type AgentTask } from '../../api/agentApi';
import AgentAttentionInbox from './AgentAttentionInbox';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));

it('responde y verifica encargos de agentes distintos y ofrece el salto a la solicitud', async () => {
  const first: AgentSession = {
    id: 'first',
    title: 'Primera',
    provider: 'local',
    model: 'm',
    created_at: 1,
    updated_at: 1,
    last_error: null,
  };
  const second = { ...first, id: 'second', title: 'Segunda' };
  const source: AgentTask = {
    id: 'source',
    session_id: 'first',
    content: 'Solicitud',
    due_at: 0,
    interval_ms: 0,
    created_at: 1,
    status: 'delivered',
  };
  const question: AgentTask = {
    ...source,
    id: 'q',
    content: 'Revisar',
    status: 'needs_input',
    question: '¿Con qué fecha?',
  };
  const review: AgentTask = {
    ...source,
    id: 'r',
    session_id: 'second',
    content: 'Entregar',
    status: 'to_verify',
    origin_task_id: source.id,
    output: 'Informe preparado',
  };
  vi.spyOn(agentApi, 'agentTasksList')
    .mockResolvedValueOnce({ tasks: [source, question, review] })
    .mockResolvedValueOnce({ tasks: [source, review] })
    .mockResolvedValue({ tasks: [source] });
  const respond = vi.spyOn(agentApi, 'agentTasksRespond').mockResolvedValue({ scheduled: review });
  const verify = vi.spyOn(agentApi, 'agentTasksVerify').mockResolvedValue({ scheduled: source });
  const open = vi.fn();
  render(<AgentAttentionInbox sessions={[first, second]} onClose={vi.fn()} onOpenTask={open} />);
  const inbox = within(screen.getByRole('dialog', { name: 'Encargos por atender' }));
  expect(await inbox.findByText('Informe preparado')).toBeVisible();
  fireEvent.click(inbox.getByRole('button', { name: 'Ir a la solicitud' }));
  expect(open).toHaveBeenCalledWith(source);
  fireEvent.change(inbox.getByRole('textbox', { name: 'Respuesta para el encargo' }), { target: { value: 'Hoy' } });
  fireEvent.click(inbox.getByRole('button', { name: 'Responder' }));
  await waitFor(() => expect(inbox.queryByText('Revisar')).not.toBeInTheDocument());
  expect(respond).toHaveBeenCalledWith('q', 'Hoy');
  fireEvent.click(inbox.getByRole('button', { name: 'Marcar verificado' }));
  expect(await inbox.findByText('No hay encargos por atender.')).toBeVisible();
  expect(verify).toHaveBeenCalledWith('r');
  vi.restoreAllMocks();
});
