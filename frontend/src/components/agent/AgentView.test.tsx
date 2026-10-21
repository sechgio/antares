import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentSession } from '../../api/agentApi';
import { aiProvidersApi, type AiProviderSpec } from '../../api/aiProvidersApi';
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
const suggestionProvider: AiProviderSpec = {
  id: 'local', label: 'Local', description: '', docs: '', editable_base_url: false, default_base_url: '', default_model: 'prueba',
  provider: 'openai', configured: true, has_key: true, key_masked: null, base_url: '', needs_key: false,
};
const availableTools = [
  { name: 'flows_list', kind: 'backend' as const, gated: false, enabled: true },
  { name: 'db_clear', kind: 'backend' as const, gated: true, enabled: true },
];
const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
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

it('guarda las herramientas de la conversación y conserva la selección si falla', async () => {
  vi.mocked(agentApi.agentToolsList).mockResolvedValue({ tools: availableTools });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const set = vi.spyOn(agentApi, 'agentToolsSet')
    .mockResolvedValueOnce({ tools: availableTools.map((tool) => ({ ...tool, enabled: tool.name !== 'db_clear' })) })
    .mockRejectedValueOnce(new Error('No se pudo guardar'))
    .mockResolvedValueOnce({ tools: availableTools });
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  expect(agentApi.agentToolsList).toHaveBeenLastCalledWith('s1');
  fireEvent.click(screen.getByLabelText('Herramientas del agente'));
  fireEvent.click(screen.getByText('Con aprobación', { selector: 'summary' }));
  await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Habilitar db_clear' })); });
  expect(set).toHaveBeenLastCalledWith('s1', ['flows_list']);
  expect(screen.getByRole('switch', { name: 'Habilitar db_clear' })).toHaveAttribute('aria-checked', 'false');
  await act(async () => { fireEvent.click(screen.getByRole('switch', { name: 'Habilitar db_clear' })); });
  expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', message: 'No se pudo guardar' }));
  expect(screen.getByRole('switch', { name: 'Habilitar db_clear' })).toHaveAttribute('aria-checked', 'false');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restablecer herramientas' })); });
  expect(set).toHaveBeenLastCalledWith('s1', null);
  expect(screen.getByRole('switch', { name: 'Habilitar db_clear' })).toHaveAttribute('aria-checked', 'true');
});

it('descarta una selección guardada tarde al cambiar de conversación', async () => {
  const second = { ...session, id: 's2', title: 'Segunda' };
  const save = deferred<{ tools: typeof availableTools }>();
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [session, second] });
  vi.mocked(agentApi.agentToolsList).mockResolvedValue({ tools: availableTools });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.spyOn(agentApi, 'agentToolsSet').mockReturnValue(save.promise);
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  fireEvent.click(screen.getByLabelText('Herramientas del agente'));
  fireEvent.click(screen.getByText('Con aprobación', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Habilitar db_clear' }));
  expect(screen.getByRole('switch', { name: 'Habilitar db_clear' })).toBeDisabled();
  await act(async () => { fireEvent.click(screen.getByText('Segunda')); });
  await act(async () => { save.resolve({ tools: availableTools.map((tool) => ({ ...tool, enabled: false })) }); });
  expect(screen.getByRole('switch', { name: 'Habilitar db_clear' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('switch', { name: 'Habilitar db_clear' })).not.toBeDisabled();
});

it('descarta la carga de herramientas de una conversación anterior', async () => {
  const first = deferred<{ tools: typeof availableTools }>();
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [session, { ...session, id: 's2', title: 'Segunda' }] });
  vi.mocked(agentApi.agentToolsList).mockImplementation((id) => id === 's1' ? first.promise : Promise.resolve({ tools: availableTools }));
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  render(<AgentView />);
  await act(async () => {});
  fireEvent.click(screen.getByText('Primera'));
  await act(async () => { fireEvent.click(screen.getByText('Segunda')); });
  await act(async () => { first.resolve({ tools: availableTools.map((tool) => ({ ...tool, enabled: false })) }); });
  fireEvent.click(screen.getByLabelText('Herramientas del agente'));
  fireEvent.click(screen.getByText('Con aprobación', { selector: 'summary' }));
  expect(screen.getByRole('switch', { name: 'Habilitar db_clear' })).toHaveAttribute('aria-checked', 'true');
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
  expect(agentApi.agentMessageSend).toHaveBeenCalledWith('s1', 'Mensaje nuevo', expect.any(String), []);
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

it('adjunta archivos y carpetas y los envía por id con el mensaje', async () => {
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const attach = vi.spyOn(agentApi, 'agentAttach')
    .mockResolvedValueOnce({ attachments: [{ id: 'a1', name: 'clientes.xlsx', kind: 'files' }] })
    .mockResolvedValueOnce({ attachments: [{ id: 'a2', name: 'fotos', kind: 'folder' }] });
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  await act(async () => { fireEvent.click(screen.getByLabelText('Adjuntar archivos')); });
  await act(async () => { fireEvent.click(screen.getByLabelText('Adjuntar carpeta')); });
  expect(attach.mock.calls).toEqual([['files'], ['folder']]);
  expect(screen.getByText('clientes.xlsx')).toBeInTheDocument();
  expect(screen.getByText('fotos')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Genera el informe' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  expect(agentApi.agentMessageSend).toHaveBeenCalledWith('s1', 'Genera el informe', expect.any(String), ['a1', 'a2']);
  expect(screen.queryByText('clientes.xlsx')).not.toBeInTheDocument();
});

it('avisa de las rutas escritas que no se autorizaron', async () => {
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.mocked(agentApi.agentMessageSend).mockResolvedValue({
    accepted: true,
    files: { granted: [], rejected: [{ path: 'C:\datos', reason: 'una carpeta requiere seleccionar los archivos concretos' }] },
  });
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Usa C:\datos' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  expect(addToast).toHaveBeenCalledWith({
    message: 'No se autorizó C:\datos: una carpeta requiere seleccionar los archivos concretos',
    type: 'warning',
  });
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

  vi.mocked(agentApi.agentMessageSend).mockResolvedValue({ accepted: true });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  const [first, second] = vi.mocked(agentApi.agentMessageSend).mock.calls;
  expect(second[2]).toBe(first[2]);
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Otro mensaje' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  expect(vi.mocked(agentApi.agentMessageSend).mock.calls[2][2]).not.toBe(first[2]);
});

it('restaura la conversación y la cola sin enviar tareas automáticamente tras reiniciar', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  localStorage.setItem('antares-agent-queue', JSON.stringify([{ session: session.id, text: 'Tarea pendiente', requestId: 'req-guardado' }]));
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({
    ...empty, messages: [{ role: 'assistant', content: 'Progreso recuperado', ts: 2 }],
  });
  render(<AgentView />);
  await act(async () => {});
  expect(screen.getByText('Progreso recuperado')).toBeInTheDocument();
  expect(screen.getByText('Tarea pendiente')).toHaveAttribute('title', 'Mensaje pendiente — clic para enviar');
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByText('Tarea pendiente')); });
  expect(agentApi.agentMessageSend).toHaveBeenCalledExactlyOnceWith(session.id, 'Tarea pendiente', 'req-guardado', []);
});

it('muestra respuestas progresivas y estados de herramientas durante el sondeo', async () => {
  vi.useFakeTimers();
  localStorage.setItem('antares-agent-session', session.id);
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({
    ...empty, running: true, messages: [{ role: 'assistant', content: 'Progreso', partial: true, ts: 2 }],
  });
  render(<AgentView />);
  await act(async () => {});
  expect(screen.getByText('Progreso')).toBeInTheDocument();
  list.mockResolvedValue({ ...empty, running: true, messages: [{
    role: 'assistant', content: 'Progreso ampliado', ts: 2,
    tool_calls: [{ id: 'c1', name: 'flows_run', params: {}, gated: true, status: 'running' }],
  }] });
  await act(async () => { vi.advanceTimersByTime(1500); });
  expect(screen.getByText('Progreso ampliado')).toBeInTheDocument();
  expect(screen.getByText('ejecutando')).toBeInTheDocument();
  list.mockResolvedValue({ ...empty, messages: [{
    role: 'assistant', content: 'Turno interrumpido', ts: 2,
    tool_calls: [{ id: 'c1', name: 'flows_run', params: {}, gated: true, status: 'interrupted', result: 'Resultado incierto' }],
  }] });
  await act(async () => { vi.advanceTimersByTime(1500); });
  expect(screen.getByText('interrumpida · comprueba el resultado')).toBeInTheDocument();
  expect(screen.getByText('Resultado incierto')).toBeInTheDocument();
});

it('detener pausa la cola y conserva las tareas pendientes para un envío explícito', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true });
  vi.spyOn(agentApi, 'agentTurnCancel').mockImplementation(async () => {
    list.mockResolvedValue(empty);
    return { cancelled: true };
  });
  render(<AgentView />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Siguiente tarea' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByLabelText('Detener')); });
  expect(agentApi.agentTurnCancel).toHaveBeenCalledWith(session.id);
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem('antares-agent-queue') || '[]')).toEqual([
    { session: session.id, text: 'Siguiente tarea', requestId: expect.any(String), attachments: [], failed: true },
  ]);
});

it('recupera una aprobación pendiente sin aprobarla al montar y permite detenerla', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  const approval = {
    id: 'a1', session_id: session.id, call_id: 'c1', method: 'flows_run', params: {},
    status: 'pending' as const, created_at: 1, decided_at: null,
  };
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, pending_approvals: [approval] });
  const approve = vi.spyOn(agentApi, 'agentApprove');
  const deny = vi.spyOn(agentApi, 'agentDeny');
  vi.spyOn(agentApi, 'agentTurnCancel').mockImplementation(async () => {
    list.mockResolvedValue(empty);
    return { cancelled: true };
  });
  render(<AgentView />);
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'Aprobar' })).toBeInTheDocument();
  expect(approve).not.toHaveBeenCalled();
  expect(deny).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByLabelText('Detener')); });
  expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  expect(approve).not.toHaveBeenCalled();
});

it('envía un mensaje en cola como corrección del encargo en curso', async () => {
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true });
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Usa la plantilla B' } });
  fireEvent.click(screen.getByLabelText('Enviar'));
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar como corrección')); });
  expect(agentApi.agentMessageSend).toHaveBeenCalledExactlyOnceWith('s1', 'Usa la plantilla B', expect.any(String), [], true);
  expect(screen.queryByText('En cola')).not.toBeInTheDocument();
});

it('muestra el contexto de la conversación y permite retirar un archivo concedido', async () => {
  const withContext = {
    ...empty,
    context: { modules: [{ id: 'sellador', label: 'Sellador' }], files: [{ path: 'C:\\docs\\informe.pdf', folder: false }], accounts: ['ana@example.com'] },
    usage: { input: 1500, output: 200 },
  };
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(withContext);
  const remove = vi.spyOn(agentApi, 'agentContextRemoveFile').mockResolvedValue({ removed: 1 });
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  expect(screen.getByText('Sellador')).toBeInTheDocument();
  expect(screen.getByText('informe.pdf')).toBeInTheDocument();
  expect(screen.getByText('ana@example.com')).toBeInTheDocument();
  const usage = screen.getByRole('button', { name: 'Contexto usado' });
  fireEvent.mouseEnter(usage);
  expect(screen.getByRole('tooltip')).toHaveTextContent('Entrada1,5 kSalida200');
  await act(async () => { fireEvent.click(screen.getByLabelText('Retirar acceso a informe.pdf')); });
  expect(remove).toHaveBeenCalledWith('s1', 'C:\\docs\\informe.pdf');
});

it('abre una conversación desde un agente guardado con su mensaje inicial', async () => {
  vi.spyOn(aiProvidersApi, 'aiProvidersList').mockResolvedValue({ providers: [
    { id: 'local', label: 'Local', configured: true, has_key: true, needs_key: false, default_model: 'prueba' },
  ] } as never);
  vi.spyOn(agentApi, 'agentProfilesList').mockResolvedValue({ profiles: [{
    id: 'p1', name: 'Informe mensual', description: 'Cortes del mes', instructions: 'x', starter: 'Prepara el informe de este mes',
    tools: null, created_at: 1, updated_at: 1,
  }] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [{ ...session, id: 's9', profile: { id: 'p1', name: 'Informe mensual' } }] });
  const create = vi.spyOn(agentApi, 'agentSessionCreate').mockResolvedValue({ session: { ...session, id: 's9', profile: { id: 'p1', name: 'Informe mensual' } } });
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByTitle('Nueva conversación con Informe mensual')); });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ profile_id: 'p1' }));
  expect(screen.getByLabelText('Mensaje para el agente')).toHaveValue('Prepara el informe de este mes');
  const suggestions = within(screen.getByRole('group', { name: 'Sugerencias' }));
  expect(suggestions.getAllByRole('button')).toHaveLength(1);
  expect(suggestions.getByRole('button', { name: 'Prepara el informe de este mes' })).toBeEnabled();
});

it('envía una sugerencia del composer creando una única conversación si no hay ninguna', async () => {
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [suggestionProvider] });
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const created = deferred<{ session: AgentSession }>();
  const create = vi.spyOn(agentApi, 'agentSessionCreate').mockReturnValue(created.promise);
  render(<AgentView />);
  const group = await screen.findByRole('group', { name: 'Sugerencias' });
  const buttons = within(group).getAllByRole('button');
  expect(buttons).toHaveLength(3);
  expect(group.querySelector('[aria-hidden="true"]')).toHaveAttribute('inert');
  fireEvent.click(buttons[0]);
  fireEvent.click(buttons[0]);
  expect(create).toHaveBeenCalledExactlyOnceWith({ provider: 'local', model: 'prueba' });
  buttons.forEach((button) => expect(button).toBeDisabled());
  await act(async () => { created.resolve({ session }); });
  expect(agentApi.agentMessageSend).toHaveBeenCalledExactlyOnceWith('s1', buttons[0].textContent, expect.any(String), []);
});

it('ofrece sugerencias en un chat con historial y permite reintentar un envío fallido sin borrar el borrador', async () => {
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [suggestionProvider] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, messages: [{ role: 'assistant', content: 'Respuesta previa', ts: 1 }] });
  vi.mocked(agentApi.agentMessageSend).mockRejectedValueOnce(new Error('No hay conexión')).mockResolvedValue({ accepted: true });
  localStorage.setItem('antares-agent-session', 's1');
  render(<AgentView />);
  await screen.findByText('Respuesta previa');
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Borrador sin enviar' } });
  const suggestion = within(screen.getByRole('group', { name: 'Sugerencias' })).getAllByRole('button')[1];
  await act(async () => { fireEvent.click(suggestion); });
  expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'No hay conexión' }));
  expect(suggestion).toBeEnabled();
  expect(screen.getByLabelText('Mensaje para el agente')).toHaveValue('Borrador sin enviar');
  await act(async () => { fireEvent.click(suggestion); });
  expect(agentApi.agentMessageSend).toHaveBeenLastCalledWith('s1', suggestion.textContent, expect.any(String), []);
  expect(screen.getByText('Respuesta previa')).toBeVisible();
});

it.each(['running', 'approval'])('deshabilita las sugerencias mientras el turno está en %s', async (state) => {
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [suggestionProvider] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty,
    running: state === 'running',
    pending_approvals: state === 'approval' ? [{ id: 'a1', session_id: 's1', call_id: 'c1', method: 'db_clear', params: {}, status: 'pending', created_at: 1, decided_at: null }] : [],
  });
  localStorage.setItem('antares-agent-session', 's1');
  render(<AgentView />);
  await act(async () => {});
  within(screen.getByRole('group', { name: 'Sugerencias' })).getAllByRole('button').forEach((button) => {
    expect(button).toBeDisabled();
    fireEvent.click(button);
  });
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
});

it('crea la conversación con el modelo real elegido en el selector', async () => {
  vi.spyOn(aiProvidersApi, 'aiProvidersList').mockResolvedValue({ providers: [
    { id: 'local', label: 'Local', configured: true, has_key: true, needs_key: false, default_model: 'prueba' },
  ] } as never);
  vi.spyOn(aiProvidersApi, 'aiProviderStatus').mockResolvedValue({ provider: {
    id: 'local', label: 'Local', description: '', docs: '', editable_base_url: false, default_base_url: '', default_model: 'prueba',
    provider: 'openai', configured: true, has_key: true, key_masked: null, base_url: '', needs_key: false,
    reachable: true, models_count: 2, models: ['prueba', 'otro-modelo'], error: null,
  } });
  vi.spyOn(agentApi, 'agentSessionsList').mockResolvedValue({ sessions: [] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const create = vi.spyOn(agentApi, 'agentSessionCreate').mockResolvedValue({ session: { ...session, id: 's8' } });
  render(<AgentView />);
  await act(async () => {});
  fireEvent.click(screen.getByLabelText('Elegir proveedor y modelo'));
  const dialog = await screen.findByRole('dialog', { name: 'Modelos disponibles' });
  await waitFor(() => expect(within(dialog).getByText('otro-modelo')).toBeInTheDocument());
  fireEvent.click(within(dialog).getByText('otro-modelo'));
  await act(async () => { fireEvent.click(screen.getByLabelText('Nueva conversación')); });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ provider: 'local', model: 'otro-modelo' }));
});

it('cambia el modelo del chat actual, conserva los mensajes y retiene el anterior si falla', async () => {
  const provider = {
    id: 'local', label: 'Local', description: '', docs: '', editable_base_url: false, default_base_url: '', default_model: 'prueba',
    provider: 'openai', configured: true, has_key: true, key_masked: null, base_url: '', needs_key: false,
  };
  vi.spyOn(aiProvidersApi, 'aiProvidersList').mockResolvedValue({ providers: [provider] });
  vi.spyOn(aiProvidersApi, 'aiProviderStatus').mockResolvedValue({ provider: {
    ...provider, reachable: true, models_count: 2, models: ['prueba', 'otro-modelo'], error: null,
  } });
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty,
    messages: [{ role: 'assistant', content: 'Respuesta anterior', ts: 1 }],
  });
  const save = deferred<{ session: AgentSession }>();
  const set = vi.spyOn(agentApi, 'agentSessionModelSet').mockReturnValueOnce(save.promise).mockRejectedValueOnce(new Error('Proveedor no disponible'));
  const create = vi.spyOn(agentApi, 'agentSessionCreate');
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  const trigger = screen.getByLabelText('Elegir proveedor y modelo');
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('option', { name: /otro-modelo/ }));
  expect(set).toHaveBeenCalledWith('s1', 'local', 'otro-modelo');
  expect(trigger).toBeDisabled();
  expect(screen.getByText('Respuesta anterior')).toBeVisible();
  await act(async () => { save.resolve({ session: { ...session, model: 'otro-modelo' } }); });
  expect(trigger).toHaveTextContent('otro-modelo');
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('option', { name: /prueba/ }));
  await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Proveedor no disponible' })));
  expect(trigger).toHaveTextContent('otro-modelo');
  list.mockResolvedValue({ ...empty, running: true });
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Continúa' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  expect(trigger).toBeDisabled();
  expect(agentApi.agentMessageSend).toHaveBeenCalledWith('s1', 'Continúa', expect.any(String), []);
});
