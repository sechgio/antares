import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentSession, type AgentTask } from '../../api/agentApi';
import ScheduledTasksPanel from './ScheduledTasksPanel';

const { addToast, confirm } = vi.hoisted(() => ({ addToast: vi.fn(), confirm: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm }) }));

const sessions: AgentSession[] = [
  { id: 's1', title: 'Primera', provider: 'local', model: 'm', created_at: 1, updated_at: 1, last_error: null },
];

const pending: AgentTask = {
  id: 't1', session_id: 's1', content: 'Revisar la bandeja', due_at: Date.now() + 3600000, interval_ms: 1800000,
  status: 'pending', created_at: 1, updated_at: 1, timezone: 'America/Lima', silent: true,
  runs: [{ at: Date.now() - 60000, due_at: Date.now() - 120000, status: 'delivered' }],
  last_run_at: Date.now() - 60000, last_status: 'delivered',
};
const delivered: AgentTask = {
  id: 't2', session_id: 's1', content: 'Informe único', due_at: Date.now() - 60000, interval_ms: 0,
  status: 'delivered', created_at: 1, updated_at: 1, timezone: 'America/Lima', silent: false,
  runs: [{ at: Date.now() - 30000, due_at: Date.now() - 60000, status: 'delivered' }],
};

beforeEach(() => {
  vi.restoreAllMocks();
  confirm.mockReset();
  vi.spyOn(agentApi, 'agentTasksList').mockResolvedValue({ tasks: [pending, delivered] });
  vi.spyOn(agentApi, 'agentTasksSave').mockResolvedValue({ scheduled: pending });
  vi.spyOn(agentApi, 'agentTasksRun').mockResolvedValue({ scheduled: pending });
  vi.spyOn(agentApi, 'agentTasksCancel').mockResolvedValue({ cancelled: true, id: 't1' });
});

async function open() {
  render(<ScheduledTasksPanel sessions={sessions} sessionId="s1" onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('Revisar la bandeja')).toBeInTheDocument());
}

it('muestra estado, repetición, silencio e historial de ejecuciones', async () => {
  await open();
  expect(screen.getByText('Programado')).toBeInTheDocument();
  expect(screen.getByText('Entregado')).toBeInTheDocument();
  expect(screen.getByText(/Cada 30 min/)).toBeInTheDocument();
  expect(screen.getByText('Silencioso')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Ejecutar ahora/ })).toHaveLength(1);
  expect(screen.getAllByText('Entregado')).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: /Historial de ejecuciones: Revisar la bandeja/ }));
  expect(screen.getAllByText('Entregado')).toHaveLength(2);
});

it('edita un encargo pendiente y envía la repetición en minutos', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: /Editar encargo: Revisar la bandeja/ }));
  expect(screen.getByLabelText('Contenido del encargo')).toHaveValue('Revisar la bandeja');
  fireEvent.change(screen.getByLabelText('Contenido del encargo'), { target: { value: 'Revisar la bandeja actualizada' } });
  fireEvent.change(screen.getByLabelText('Repetición en minutos'), { target: { value: '60' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' })); });

  expect(agentApi.agentTasksSave).toHaveBeenLastCalledWith(expect.objectContaining({
    session_id: 's1', id: 't1', content: 'Revisar la bandeja actualizada', every_minutes: 60, silent: true,
    due_at: expect.stringMatching(/Z$/),
  }));
  expect(addToast).toHaveBeenCalledWith({ message: 'Encargo actualizado', type: 'success' });
});

it('crea un encargo nuevo para la conversación elegida', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: /Nuevo encargo/ }));
  fireEvent.change(screen.getByLabelText('Contenido del encargo'), { target: { value: 'Preparar el cierre mensual' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Programar encargo' })); });

  expect(agentApi.agentTasksSave).toHaveBeenLastCalledWith(expect.objectContaining({
    session_id: 's1', content: 'Preparar el cierre mensual', every_minutes: null, silent: false,
    due_at: expect.stringMatching(/Z$/),
  }));
  expect(vi.mocked(agentApi.agentTasksSave).mock.calls.at(-1)?.[0]).not.toHaveProperty('id');
  expect(addToast).toHaveBeenCalledWith({ message: 'Encargo programado', type: 'success' });
});

it('ejecuta ahora y cancela sólo tras confirmar', async () => {
  confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await open();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Ejecutar ahora/ })); });
  expect(agentApi.agentTasksRun).toHaveBeenCalledWith('t1');
  expect(addToast).toHaveBeenCalledWith({ message: 'Encargo enviado a ejecutar', type: 'success' });

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Cancelar encargo: Revisar la bandeja/ })); });
  expect(agentApi.agentTasksCancel).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Cancelar encargo: Revisar la bandeja/ })); });
  expect(agentApi.agentTasksCancel).toHaveBeenCalledWith('t1');
});
