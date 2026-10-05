import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentSession } from '../../api/agentApi';
import { aiProvidersApi } from '../../api/aiProvidersApi';
import AgentView from './AgentView';

const { addToast, confirm } = vi.hoisted(() => ({ addToast: vi.fn(), confirm: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm }) }));

type Snapshot = Awaited<ReturnType<typeof agentApi.agentMessagesList>>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const session: AgentSession = {
  id: 's1', title: 'Primera', provider: 'local', model: 'prueba',
  created_at: 1, updated_at: 1, last_error: null,
};
const empty: Snapshot = { messages: [], running: false, pending_approvals: [] };
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

beforeEach(() => {
  vi.restoreAllMocks();
  addToast.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  vi.spyOn(aiProvidersApi, 'aiProvidersList').mockResolvedValue({ providers: [] });
  vi.spyOn(agentApi, 'agentToolsList').mockResolvedValue({ tools: [] });
  vi.spyOn(agentApi, 'agentSessionsList').mockResolvedValue({ sessions: [session] });
  vi.spyOn(agentApi, 'agentMessageSend').mockResolvedValue({ accepted: true });
});

afterEach(() => {
  vi.useRealTimers();
  if (scrollToDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

it('descarta la lectura previa al envío y drena la actualización pendiente de la misma sesión', async () => {
  const initial = deferred<Snapshot>();
  const current = deferred<Snapshot>();
  const list = vi.spyOn(agentApi, 'agentMessagesList')
    .mockReturnValueOnce(initial.promise).mockReturnValueOnce(current.promise)
    .mockResolvedValue({ ...empty, messages: [{ role: 'assistant', content: 'Respuesta final', ts: 2 }] });
  render(<AgentView />);
  await act(async () => {});
  fireEvent.click(screen.getByText('Primera'));
  expect(list).toHaveBeenCalledTimes(1);
  vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Mensaje nuevo' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  expect(agentApi.agentMessageSend).toHaveBeenCalledWith('s1', 'Mensaje nuevo');
  await act(async () => { initial.resolve(empty); });
  expect(list).toHaveBeenCalledTimes(2);
  expect(screen.getByText('El agente está trabajando')).toBeInTheDocument();
  await act(async () => {
    current.resolve({ ...empty, running: true, messages: [{ role: 'user', content: 'Mensaje nuevo', ts: 1 }] });
  });
  expect(screen.getByText('Mensaje nuevo')).toBeInTheDocument();
  await act(async () => { vi.advanceTimersByTime(1500); });
  expect(list).toHaveBeenCalledTimes(3);
  expect(screen.getByText('Respuesta final')).toBeInTheDocument();
  expect(screen.queryByText('El agente está trabajando')).not.toBeInTheDocument();
});

it('no aplica running=false de una lectura antigua mientras el envío sigue pendiente', async () => {
  const initial = deferred<Snapshot>();
  const send = deferred<{ accepted: boolean }>();
  vi.spyOn(agentApi, 'agentMessagesList').mockReturnValueOnce(initial.promise).mockResolvedValue({ ...empty, running: true });
  vi.mocked(agentApi.agentMessageSend).mockReturnValue(send.promise);
  render(<AgentView />);
  await act(async () => {});
  fireEvent.click(screen.getByText('Primera'));
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Mensaje nuevo' } });
  fireEvent.click(screen.getByLabelText('Enviar'));
  await act(async () => { initial.resolve(empty); });
  expect(screen.getByText('El agente está trabajando')).toBeInTheDocument();
  await act(async () => { send.resolve({ accepted: true }); });
});

it('mantiene el turno activo cuando un sondeo termina antes de que se acepte el envío', async () => {
  const send = deferred<{ accepted: boolean }>();
  const poll = deferred<Snapshot>();
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValueOnce(empty)
    .mockReturnValueOnce(poll.promise).mockResolvedValue({ ...empty, running: true });
  vi.mocked(agentApi.agentMessageSend).mockReturnValue(send.promise);
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Mensaje nuevo' } });
  fireEvent.click(screen.getByLabelText('Enviar'));
  await act(async () => { vi.advanceTimersByTime(1500); });
  expect(list).toHaveBeenCalledTimes(2);
  await act(async () => { poll.resolve(empty); });
  expect(screen.getByText('El agente está trabajando')).toBeInTheDocument();
  await act(async () => { send.resolve({ accepted: true }); });
});

it('un envío pendiente en otra sesión no descarta los mensajes de la sesión seleccionada', async () => {
  const second = { ...session, id: 's2', title: 'Segunda' };
  const send = deferred<{ accepted: boolean }>();
  const snapshot = deferred<Snapshot>();
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [session, second] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValueOnce(empty)
    .mockReturnValueOnce(snapshot.promise).mockResolvedValue(empty);
  vi.mocked(agentApi.agentMessageSend).mockReturnValue(send.promise);
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Mensaje nuevo' } });
  fireEvent.click(screen.getByLabelText('Enviar'));
  fireEvent.click(screen.getByText('Segunda'));
  await act(async () => { send.resolve({ accepted: true }); });
  await act(async () => {
    snapshot.resolve({ ...empty, messages: [{ role: 'assistant', content: 'Mensaje de segunda', ts: 1 }] });
  });
  expect(screen.getByText('Mensaje de segunda')).toBeInTheDocument();
});

it('un envío fallido conserva el borrador y termina el indicador de ejecución', async () => {
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.mocked(agentApi.agentMessageSend).mockRejectedValue(new Error('Sin conexión'));
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Reintentar' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  expect(screen.getByLabelText('Mensaje para el agente')).toHaveValue('Reintentar');
  expect(screen.queryByText('El agente está trabajando')).not.toBeInTheDocument();
  expect(addToast).toHaveBeenCalledWith({ message: 'Sin conexión', type: 'error' });
});
