import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { agentApi, type AgentApproval, type AgentPermissionMode, type AgentSession } from '../../api/agentApi';
import { aiProvidersApi, type AiProviderSpec } from '../../api/aiProvidersApi';
import { mcpApi } from '../../api/mcpApi';
import AgentView from './AgentView';

const { addToast, confirm } = vi.hoisted(() => ({ addToast: vi.fn(), confirm: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm }) }));

type Snapshot = Awaited<ReturnType<typeof agentApi.agentMessagesList>>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function agentUpdates() {
  let notify: (method: string, params: unknown) => void = () => {};
  vi.spyOn(window.electronAPI, 'onNotify').mockImplementation((callback) => {
    notify = callback;
    return () => { notify = () => {}; };
  });
  return () => notify('agent.changed', { session_id: 's1' });
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
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  addToast.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  vi.spyOn(aiProvidersApi, 'aiProvidersList').mockResolvedValue({ providers: [] });
  vi.spyOn(agentApi, 'agentToolsList').mockResolvedValue({ tools: [] });
  vi.spyOn(agentApi, 'agentSessionsList').mockResolvedValue({ sessions: [session] });
  vi.spyOn(agentApi, 'agentMessageSend').mockResolvedValue({ accepted: true });
  vi.spyOn(agentApi, 'agentPolicyGet').mockResolvedValue({ rules: {}, audit: [] });
});

afterEach(() => {
  vi.useRealTimers();
  if (scrollToDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

it('crea el agente y abre su conversación sin enviar mensajes ni duplicarla al editar', async () => {
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [suggestionProvider] });
  vi.spyOn(agentApi, 'agentProfilesList').mockResolvedValue({ profiles: [] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const profile = { id: 'revisor', name: 'Revisor', color: '#0E7490', description: '', instructions: 'Revisa informes', starter: '', tools: null, created_at: 1, updated_at: 1 };
  vi.spyOn(agentApi, 'agentProfileSave').mockResolvedValue({ profile });
  const create = vi.spyOn(agentApi, 'agentSessionCreate').mockResolvedValue({ session: { ...session, profile: { id: profile.id, name: profile.name } } });
  render(<AgentView />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Nuevo agente' }));
  const editor = within(screen.getByRole('dialog', { name: 'Crear agente' }));
  fireEvent.change(editor.getByLabelText('Nombre del agente'), { target: { value: profile.name } });
  fireEvent.change(editor.getByLabelText('Indicaciones del agente'), { target: { value: profile.instructions } });
  fireEvent.click(editor.getByRole('radio', { name: 'Color Verde' }));
  await act(async () => { fireEvent.click(editor.getByRole('button', { name: 'Crear y chatear' })); });
  expect(create).toHaveBeenCalledExactlyOnceWith({ provider: 'local', model: 'prueba', profile_id: profile.id });
  expect(screen.queryByRole('dialog', { name: 'Crear agente' })).not.toBeInTheDocument();
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Agentes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Editar agente Revisor' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Guardar' })); });
  expect(create).toHaveBeenCalledTimes(1);
});

it('guarda el agente sin proveedor y muestra el perfil sin intentar abrir un chat', async () => {
  vi.spyOn(agentApi, 'agentProfilesList').mockResolvedValue({ profiles: [] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const profile = { id: 'revisor', name: 'Revisor', description: '', instructions: 'Revisa informes', starter: '', tools: null, created_at: 1, updated_at: 1 };
  vi.spyOn(agentApi, 'agentProfileSave').mockResolvedValue({ profile });
  const create = vi.spyOn(agentApi, 'agentSessionCreate');
  render(<AgentView />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Nuevo agente' }));
  const editor = within(screen.getByRole('dialog', { name: 'Crear agente' }));
  fireEvent.change(editor.getByLabelText('Nombre del agente'), { target: { value: profile.name } });
  fireEvent.change(editor.getByLabelText('Indicaciones del agente'), { target: { value: profile.instructions } });
  await act(async () => { fireEvent.click(editor.getByRole('button', { name: 'Crear agente' })); });
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Agentes' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Editar agente Revisor' })).toBeInTheDocument();
  expect(addToast).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
});

it.each([
  { used: 150000, text: null },
  { used: 170000, text: /usó el 85 % de su presupuesto diario/ },
  { used: 200000, text: /agotó su presupuesto diario/ },
])('avisa del presupuesto diario del agente a partir del 80 %: $used', async ({ used, text }) => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentProfilesList').mockResolvedValue({ profiles: [] });
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, token_budget: { limit: 200000, used } });
  render(<AgentView />);
  await waitFor(() => expect(list).toHaveBeenCalled());
  await act(async () => {});
  if (text) expect(await screen.findByText(text)).toBeInTheDocument();
  else expect(screen.queryByText(/presupuesto diario/)).not.toBeInTheDocument();
});

it.each([
  { options: { remember: true }, payload: { approval_id: 'a1', remember: true } },
  { options: { grantApp: true }, payload: { approval_id: 'a1', grant_app: true } },
  { options: {}, payload: { approval_id: 'a1' } },
])('conserva separados los permisos de dominio y aplicación: $options', async ({ options, payload }) => {
  const invoke = vi.spyOn(window.electronAPI, 'invoke').mockResolvedValue({});
  await agentApi.agentApprove('a1', options);
  expect(invoke).toHaveBeenCalledWith('agent_approve', payload);
});

it('sugiere bots con @ y permite elegir con teclado sin enviar el mensaje', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.spyOn(agentApi, 'agentProfilesList').mockResolvedValue({ profiles: ['Revisor de PDFs', 'Redactor'].map((name, index) => ({
    id: `bot-${index}`, name, description: 'Comprueba firmas', instructions: 'Revisa', starter: '', tools: null, created_at: 1, updated_at: 1,
  })) });
  render(<AgentView />);
  await act(async () => {});
  const composer = screen.getByRole('textbox', { name: 'Mensaje para el agente' });
  fireEvent.change(composer, { target: { value: 'Consulta @' } });
  expect(screen.getByRole('listbox', { name: 'Bots y conectores para mencionar' })).toBeVisible();
  expect(screen.getAllByRole('option', { name: /Comprueba firmas/ })).toHaveLength(2);
  fireEvent.keyDown(composer, { key: 'Enter', isComposing: true });
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
  expect(composer).toHaveValue('Consulta @');
  fireEvent.keyDown(composer, { key: 'ArrowDown' });
  expect(screen.getByRole('option', { name: /Redactor/ })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(composer, { key: 'Enter' });
  expect(composer).toHaveValue('Consulta @bot:bot-1 ');
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
  fireEvent.change(composer, { target: { value: 'Consulta @Revi' } });
  expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.keyDown(composer, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(composer).toHaveValue('Consulta @Revi');
});

it('sugiere conectores y servidores MCP con @ e inserta la mención que habilita sus herramientas', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.spyOn(mcpApi, 'mcpServersList').mockResolvedValue({ servers: [{
    id: 'srv', name: 'Mi Servidor', transport: 'http', url: 'https://mcp.example.com', command: '', args: [], secret_keys: [], tools_count: 3,
  }] });
  render(<AgentView />);
  await act(async () => {});
  const composer = screen.getByRole('textbox', { name: 'Mensaje para el agente' });
  fireEvent.change(composer, { target: { value: 'Revisa @gma' } });
  expect(screen.getByRole('option', { name: /Gmail\s*Buscar y leer correos/ })).toHaveAttribute('aria-selected', 'true');
  fireEvent.keyDown(composer, { key: 'Enter' });
  expect(composer).toHaveValue('Revisa @gmail ');
  fireEvent.change(composer, { target: { value: 'Busca con @mi' } });
  await act(async () => {});
  expect(screen.getByRole('option', { name: /Mi Servidor\s*Servidor MCP · 3 herramientas/ })).toBeVisible();
  fireEvent.keyDown(composer, { key: 'Tab' });
  expect(composer).toHaveValue('Busca con @mi-servidor ');
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
});

it('distingue bots con nombres repetidos y conserva el texto después del cursor', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.spyOn(agentApi, 'agentProfilesList').mockResolvedValue({ profiles: ['Revisor', 'Révisor'].map((name, index) => ({
    id: `bot-${index}`, name, description: `Especialidad ${index}`, instructions: 'Revisa', starter: '', tools: null, created_at: 1, updated_at: 1,
  })) });
  render(<AgentView />);
  await act(async () => {});
  const composer = screen.getByRole('textbox', { name: 'Mensaje para el agente' });
  fireEvent.change(composer, { target: { value: 'Pide @ el informe', selectionStart: 6 } });
  fireEvent.click(screen.getByRole('option', { name: /Especialidad 1/ }));
  expect(composer).toHaveValue('Pide @bot:bot-1  el informe');
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
});

it('conserva el bot seleccionado en la cola restaurada aunque cambie su nombre', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true });
  const original = { id: 'bot-original', name: 'Revisor', description: '', instructions: 'Revisa', starter: '', tools: null,
    created_at: 1, updated_at: 1 };
  const profiles = vi.spyOn(agentApi, 'agentProfilesList').mockResolvedValue({ profiles: [original] });
  const view = render(<AgentView />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Consulta @Rev' } });
  fireEvent.click(screen.getByRole('option', { name: /Revisor/ }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dejar para después' })); });
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
  view.unmount();
  profiles.mockResolvedValue({ profiles: [{ ...original, name: 'Archivado' }, { ...original, id: 'bot-replacement' }] });
  list.mockResolvedValue(empty);
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByTitle('Reintentar el envío pendiente')); });
  expect(agentApi.agentMessageSend).toHaveBeenCalledExactlyOnceWith(session.id, 'Consulta @bot:bot-original', expect.any(String), []);
});

it('separa agentes y conversaciones sin perder el borrador ni enviar mensajes', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.spyOn(agentApi, 'agentProfilesList').mockResolvedValue({ profiles: [{
    id: 'revisor', name: 'Revisor de PDFs', description: 'Comprueba firmas', instructions: 'Revisa', starter: '', tools: null,
    created_at: 1, updated_at: 1,
  }] });
  render(<AgentView />);
  await act(async () => {});
  const navigation = within(screen.getByRole('group', { name: 'Vistas del agente' }));
  expect(navigation.getByRole('button', { name: 'Conversaciones' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByTitle('Nueva conversación con Revisor de PDFs')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Borrador pendiente' } });
  fireEvent.click(navigation.getByRole('button', { name: 'Agentes' }));
  expect(screen.getByTitle('Nueva conversación con Revisor de PDFs')).toBeInTheDocument();
  expect(within(screen.getByRole('complementary', { name: 'Agentes y conversaciones' })).queryByText('Primera')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Mensaje para el agente')).toHaveValue('Borrador pendiente');
  fireEvent.click(screen.getByRole('button', { name: 'Buscar agentes' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar agentes' }), { target: { value: 'firmas' } });
  expect(screen.getByTitle('Nueva conversación con Revisor de PDFs')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar agentes' }), { target: { value: 'sin-coincidencias' } });
  expect(screen.getByText(/Sin agentes para/)).toBeInTheDocument();
  fireEvent.keyDown(screen.getByLabelText('Mensaje para el agente'), { key: 'k', ctrlKey: true });
  expect(navigation.getByRole('button', { name: 'Conversaciones' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('textbox', { name: 'Buscar conversaciones' })).toHaveFocus();
  fireEvent.click(navigation.getByRole('button', { name: 'Agentes' }));
  expect(screen.getByRole('textbox', { name: 'Buscar agentes' })).toHaveValue('sin-coincidencias');
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar búsqueda' }));
  expect(screen.getByTitle('Nueva conversación con Revisor de PDFs')).toBeInTheDocument();
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
});

it('busca herramientas por etiqueta o nombre y abre solo los grupos con coincidencias', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.mocked(agentApi.agentToolsList).mockResolvedValue({ tools: [
    ...availableTools, { name: 'shell_run', kind: 'backend', gated: true, enabled: false },
  ] });
  const save = vi.spyOn(agentApi, 'agentToolsSet');
  render(<AgentView />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Herramientas del agente' }));
  const panel = within(screen.getByRole('dialog', { name: 'Herramientas del agente' }));
  const search = panel.getByRole('textbox', { name: 'Buscar herramientas' });
  await waitFor(() => expect(search).toHaveFocus());
  const transitions = getComputedStyle(search).transitionProperty.split(',').map((property) => property.trim());
  expect(transitions).toContain('border-color');
  expect(transitions).not.toContain('all');
  expect(transitions).not.toContain('visibility');
  expect(panel.getByText('2 de 3 habilitadas')).toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'PowerShell' } });
  expect(panel.getByRole('switch', { name: 'Habilitar shell_run' })).toHaveAttribute('aria-checked', 'false');
  expect(panel.queryByText('Uso general', { selector: 'summary' })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'db_clear' } });
  expect(panel.getByRole('switch', { name: 'Habilitar db_clear' })).toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'sin-coincidencias' } });
  expect(panel.getByText(/No hay coincidencias/)).toBeInTheDocument();
  fireEvent.click(panel.getByRole('button', { name: 'Limpiar búsqueda de herramientas' }));
  expect(search).toHaveValue('');
  expect(save).not.toHaveBeenCalled();
});

it('filtra skills y MCP sin instalar ni habilitar capacidades automáticamente', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.mocked(agentApi.agentToolsList).mockResolvedValue({ tools: [
    ...availableTools,
    { name: 'skills_list', kind: 'backend', module: 'agent', gated: false, enabled: false },
    { name: 'skills_read', kind: 'backend', module: 'agent', gated: false, enabled: false },
    { name: 'mcp_library', kind: 'mcp', gated: true, enabled: false },
  ] });
  const save = vi.spyOn(agentApi, 'agentToolsSet');
  render(<AgentView />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Herramientas del agente' }));
  const panel = within(screen.getByRole('dialog', { name: 'Herramientas del agente' }));
  const filters = within(panel.getByRole('group', { name: 'Filtrar herramientas' }));
  fireEvent.click(filters.getByRole('button', { name: 'Skills' }));
  expect(panel.getByRole('switch', { name: 'Habilitar skills_list' })).toHaveAttribute('aria-checked', 'false');
  expect(panel.getAllByRole('switch')).toHaveLength(2);
  expect(panel.getByText(/no instalan skills/)).toBeInTheDocument();
  fireEvent.click(filters.getByRole('button', { name: 'MCP' }));
  expect(panel.getAllByRole('switch')).toHaveLength(1);
  expect(panel.getByRole('switch', { name: 'Habilitar mcp_library' })).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(filters.getByRole('button', { name: 'Skills' }));
  save.mockResolvedValueOnce({ tools: [] });
  await act(async () => { fireEvent.click(panel.getByRole('switch', { name: 'Habilitar skills_list' })); });
  expect(save).toHaveBeenLastCalledWith('s1', ['flows_list', 'db_clear', 'skills_list']);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Herramientas del agente' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Herramientas del agente' })).toHaveFocus();
});

it('muestra conversaciones de una sola línea y reserva los avatares de la barra lateral para los agentes', async () => {
  const profile = { id: 'p1', name: 'Reportes', description: 'Prepara informes', instructions: '', starter: '', tools: null, created_at: 1, updated_at: 1 };
  vi.spyOn(agentApi, 'agentProfilesList').mockResolvedValue({ profiles: [profile] });
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [
    { ...session, profile: { id: profile.id, name: profile.name }, last_error: 'Proveedor sin conexión' },
    { ...session, id: 's2', title: '' },
  ] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  localStorage.setItem('antares-agent-session', session.id);
  render(<AgentView />);
  const sidebar = screen.getByRole('complementary', { name: 'Agentes y conversaciones' });
  const first = await within(sidebar).findByRole('button', { name: 'Primera' });
  expect(first).toHaveAttribute('title', 'Primera');
  expect(first).toHaveAttribute('aria-current', 'page');
  expect(within(sidebar).queryAllByRole('img')).toHaveLength(0);
  expect(within(sidebar).queryByText(/prueba|local|hace|ahora/)).not.toBeInTheDocument();
  expect(within(sidebar).getByTitle('Proveedor sin conexión')).toBeInTheDocument();
  expect(screen.getByRole('main', { name: 'Conversación del agente' }).querySelector('header svg[role="img"]')).toBeNull();
  const second = within(sidebar).getByRole('button', { name: 'Conversación' });
  await act(async () => { fireEvent.click(second); });
  expect(second).toHaveAttribute('aria-current', 'page');
  expect(first).not.toHaveAttribute('aria-current');
  expect(agentApi.agentMessagesList).toHaveBeenLastCalledWith('s2');
  fireEvent.click(within(sidebar).getByRole('button', { name: 'Agentes' }));
  expect(within(sidebar).getAllByRole('img')).toHaveLength(1);
  expect(within(sidebar).getByRole('img', { name: 'Reportes' })).toBeInTheDocument();
});

it('conserva la búsqueda y el borrado desde las filas compactas', async () => {
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [session, { ...session, id: 's2', title: 'Segunda' }] });
  confirm.mockResolvedValue(true);
  const remove = vi.spyOn(agentApi, 'agentSessionDelete').mockResolvedValue({ deleted: true, id: 's2' });
  render(<AgentView />);
  const sidebar = screen.getByRole('complementary', { name: 'Agentes y conversaciones' });
  await within(sidebar).findByRole('button', { name: 'Primera' });
  fireEvent.click(within(sidebar).getByRole('button', { name: 'Buscar conversaciones' }));
  fireEvent.change(within(sidebar).getByRole('textbox', { name: 'Buscar conversaciones' }), { target: { value: 'Segunda' } });
  expect(within(sidebar).queryByRole('button', { name: 'Primera' })).not.toBeInTheDocument();
  expect(within(sidebar).getByRole('button', { name: 'Segunda' })).toBeInTheDocument();
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [session] });
  await act(async () => { fireEvent.click(within(sidebar).getByRole('button', { name: 'Eliminar conversación' })); });
  expect(remove).toHaveBeenCalledExactlyOnceWith('s2');
  expect(within(sidebar).queryByRole('button', { name: 'Segunda' })).not.toBeInTheDocument();
});

it('amplía el buscador y restaura las acciones al cerrarlo', async () => {
  const configure = vi.fn();
  render(<AgentView onConfigureProvider={configure} />);
  const sidebar = screen.getByRole('complementary', { name: 'Agentes y conversaciones' });
  await within(sidebar).findByRole('button', { name: 'Primera' });
  fireEvent.click(within(sidebar).getByRole('button', { name: 'Buscar conversaciones' }));
  const search = within(sidebar).getByRole('textbox', { name: 'Buscar conversaciones' });
  expect(search).toHaveFocus();
  expect(within(sidebar).queryByRole('button', { name: 'Nueva conversación' })).not.toBeInTheDocument();
  expect(within(sidebar).queryByRole('button', { name: 'Proveedores' })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'Sin resultados' } });
  expect(within(sidebar).getByText('Sin resultados para «Sin resultados».')).toBeInTheDocument();
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(within(sidebar).queryByRole('textbox')).not.toBeInTheDocument();
  expect(within(sidebar).getByRole('button', { name: 'Nueva conversación' })).toBeInTheDocument();
  fireEvent.click(within(sidebar).getByRole('button', { name: 'Proveedores' }));
  expect(configure).toHaveBeenCalledOnce();
  expect(within(sidebar).getByRole('button', { name: 'Primera' })).toBeInTheDocument();
});

it('oculta y muestra la barra lateral sin perder la conversación ni el borrador', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty,
    messages: [{ role: 'assistant', content: 'Respuesta conservada', ts: 1 }],
  });
  render(<AgentView />);
  await screen.findByText('Respuesta conservada');
  const composer = screen.getByRole('textbox', { name: 'Mensaje para el agente' });
  fireEvent.change(composer, { target: { value: 'Borrador pendiente' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ocultar barra lateral' }));
  expect(screen.queryByRole('complementary', { name: 'Agentes y conversaciones' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mostrar barra lateral' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('Respuesta conservada')).toBeVisible();
  expect(composer).toHaveValue('Borrador pendiente');
  fireEvent.click(screen.getByRole('button', { name: 'Mostrar barra lateral' }));
  const sidebar = screen.getByRole('complementary', { name: 'Agentes y conversaciones' });
  expect(within(sidebar).getByRole('button', { name: 'Primera' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('button', { name: 'Ocultar barra lateral' })).toHaveAttribute('aria-expanded', 'true');
  expect(composer).toHaveValue('Borrador pendiente');
});

it('permite ocultar la barra sin conversación activa y Ctrl+K la recupera para buscar', async () => {
  render(<AgentView />);
  await screen.findByRole('button', { name: 'Primera' });
  fireEvent.click(screen.getByRole('button', { name: 'Ocultar barra lateral' }));
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('main'), { key: 'k', ctrlKey: true });
  const sidebar = screen.getByRole('complementary', { name: 'Agentes y conversaciones' });
  expect(within(sidebar).getByRole('textbox', { name: 'Buscar conversaciones' })).toHaveFocus();
  const hide = screen.getByRole('button', { name: 'Ocultar barra lateral' });
  hide.focus();
  fireEvent.click(hide);
  fireEvent.keyDown(screen.getByRole('main'), { key: 'k', ctrlKey: true });
  expect(within(sidebar).getByRole('textbox', { name: 'Buscar conversaciones' })).toHaveFocus();
});

it('regula el razonamiento con los niveles del modelo y lo guarda al soltar', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  const reasoning_levels = ['low', 'medium', 'high'] as const;
  const plain = { ...session, id: 's2', title: 'Segunda', reasoning_levels: [] };
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [{ ...session, reasoning_levels: [...reasoning_levels], reasoning_effort: 'xhigh' }, plain] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const save = vi.spyOn(agentApi, 'agentSessionReasoningSet')
    .mockResolvedValueOnce({ session: { ...session, reasoning_levels: [...reasoning_levels], reasoning_effort: 'medium' } });
  render(<AgentView />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Razonamiento: Alto' }));
  const slider = within(screen.getByRole('dialog', { name: 'Nivel de razonamiento' })).getByRole('slider', { name: 'Nivel de razonamiento' });
  expect(slider).toHaveAttribute('max', '2');
  fireEvent.change(slider, { target: { value: '1' } });
  expect(slider).toHaveAttribute('aria-valuetext', 'Medio');
  expect(save).not.toHaveBeenCalled();
  await act(async () => { fireEvent.keyUp(slider, { key: 'ArrowLeft' }); });
  expect(save).toHaveBeenCalledWith(session.id, 'medium');
  expect(screen.getByRole('button', { name: 'Razonamiento: Medio' })).toBeEnabled();
  await act(async () => { fireEvent.click(screen.getByText('Segunda')); });
  expect(screen.queryByRole('button', { name: /^Razonamiento:/ })).not.toBeInTheDocument();
});

it('ofrece el nivel máximo cuando el modelo lo admite', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  const reasoning_levels = ['high', 'xhigh', 'max'] as const;
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [{ ...session, reasoning_levels: [...reasoning_levels], reasoning_effort: 'high' }] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const save = vi.spyOn(agentApi, 'agentSessionReasoningSet')
    .mockResolvedValueOnce({ session: { ...session, reasoning_levels: [...reasoning_levels], reasoning_effort: 'max' } });
  render(<AgentView />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Razonamiento: Alto' }));
  const slider = within(screen.getByRole('dialog', { name: 'Nivel de razonamiento' })).getByRole('slider', { name: 'Nivel de razonamiento' });
  fireEvent.change(slider, { target: { value: '2' } });
  expect(slider).toHaveAttribute('aria-valuetext', 'Máximo');
  await act(async () => { fireEvent.keyUp(slider, { key: 'ArrowRight' }); });
  expect(save).toHaveBeenCalledWith(session.id, 'max');
  expect(screen.getByRole('button', { name: 'Razonamiento: Máximo' })).toBeEnabled();
});

it('cambia los permisos por conversación y conserva el modo si falla el guardado', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  const second = { ...session, id: 's2', title: 'Segunda', permission_mode: 'ask' as const };
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [session, second] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const saving = deferred<{ session: AgentSession }>();
  const save = vi.spyOn(agentApi, 'agentSessionPermissionsSet')
    .mockReturnValueOnce(saving.promise)
    .mockRejectedValueOnce(new Error('No se pudieron guardar los permisos'));
  render(<AgentView />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Permisos: Aprobar por mí' }));
  const menu = screen.getByRole('menu', { name: 'Permisos del agente' });
  expect(within(menu).getByRole('menuitemradio', { name: /Aprobar por mí/ })).toHaveAttribute('aria-checked', 'true');
  expect(within(menu).getByRole('menuitemradio', { name: /Solicitar aprobación/ })).toHaveTextContent('Pregunta antes de acciones sensibles y webs');
  expect(within(menu).getByRole('menuitemradio', { name: /Aprobar por mí/ })).toHaveTextContent('la web va sola');
  expect(within(menu).getByRole('menuitemradio', { name: /Acceso completo/ })).toHaveTextContent('Sin preguntar, salvo el terminal');
  expect(within(menu).queryByRole('combobox')).not.toBeInTheDocument();
  fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Acceso completo/ }));
  expect(save).toHaveBeenLastCalledWith(session.id, 'full');
  expect(screen.getByRole('button', { name: 'Permisos: Aprobar por mí' })).toBeDisabled();
  await act(async () => { saving.resolve({ session: { ...session, permission_mode: 'full' } }); });
  expect(screen.getByRole('button', { name: 'Permisos: Acceso completo' })).toBeEnabled();
  await act(async () => { fireEvent.click(screen.getByText('Segunda')); });
  expect(screen.getByRole('button', { name: 'Permisos: Solicitar aprobación' })).toBeEnabled();
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  fireEvent.click(screen.getByRole('button', { name: 'Permisos: Acceso completo' }));
  await act(async () => { fireEvent.click(screen.getByRole('menuitemradio', { name: /^Solicitar aprobación/ })); });
  expect(screen.getByRole('button', { name: 'Permisos: Acceso completo' })).toBeEnabled();
  expect(addToast).toHaveBeenCalledWith({ message: 'No se pudieron guardar los permisos', type: 'error' });
});

it.each([
  { rule: 'allow', label: 'Permitir siempre este canal en esta conversación: Nube y conexiones', choice: 'allow' },
  { rule: 'deny', label: 'Bloquear este canal en esta conversación', choice: 'deny' },
] as const)('envía la regla rápida $rule junto con la decisión de la aprobación', async ({ rule, label, choice }) => {
  localStorage.setItem('antares-agent-session', session.id);
  const approval: AgentApproval = {
    id: 'a1', session_id: session.id, call_id: 'c1', method: 'gdrive_upload', params: {},
    status: 'pending', created_at: 1, decided_at: null, channel: 'cloud',
  };
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, pending_approvals: [approval] });
  const approve = vi.spyOn(agentApi, 'agentApprove')
    .mockResolvedValue({ approval: { ...approval, status: 'approved' } });
  const deny = vi.spyOn(agentApi, 'agentDeny')
    .mockResolvedValue({ approval: { ...approval, status: 'denied' } });
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: label })); });
  const decided = choice === 'allow' ? approve : deny;
  expect(decided).toHaveBeenCalledExactlyOnceWith('a1', { channel: 'cloud', rule });
  expect(choice === 'allow' ? deny : approve).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /1 regla por canal/ })).toBeInTheDocument();
});

it('no decide la aprobación si falla la decisión con regla rápida', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  const approval: AgentApproval = {
    id: 'a1', session_id: session.id, call_id: 'c1', method: 'gdrive_upload', params: {},
    status: 'pending', created_at: 1, decided_at: null, channel: 'cloud',
  };
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, pending_approvals: [approval] });
  const approve = vi.spyOn(agentApi, 'agentApprove');
  const deny = vi.spyOn(agentApi, 'agentDeny').mockRejectedValue(new Error('Sin conexión'));
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Bloquear este canal en esta conversación' })); });
  expect(approve).not.toHaveBeenCalled();
  expect(deny).toHaveBeenCalledWith('a1', { channel: 'cloud', rule: 'deny' });
  expect(addToast).toHaveBeenCalledWith({ message: 'Sin conexión', type: 'error' });
});

it('deshace una acción reversible y refresca su recibo', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  const call = {
    id: 'c1', dispatch_id: 'c1@task:t1', name: 'fs_write', params: {}, gated: true, status: 'done' as const,
    result: '{"saved_path":"a.txt"}', channel: 'files' as const, approval_source: 'manual' as const,
    undo: { available: true, kind: 'delete' as const },
  };
  const list = vi.spyOn(agentApi, 'agentMessagesList')
    .mockResolvedValue({ ...empty, messages: [{ role: 'assistant', content: '', ts: 1, tool_calls: [call] }] });
  const undo = vi.spyOn(agentApi, 'agentEffectUndo')
    .mockResolvedValue({ undone: true, path: 'C:\\a.txt', call_id: call.dispatch_id });
  render(<AgentView />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /Deshacer/ }));
  await waitFor(() => expect(undo).toHaveBeenCalledWith(session.id, 'c1@task:t1'));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(addToast).toHaveBeenCalledWith({ message: 'Acción deshecha.', type: 'success' });
});

it('permite navegar los permisos con el teclado y cierra con Escape o un clic fuera', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  render(<AgentView />);
  await act(async () => {});
  const trigger = screen.getByRole('button', { name: 'Permisos: Aprobar por mí' });
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  const selected = screen.getByRole('menuitemradio', { name: /Aprobar por mí/ });
  expect(selected).toHaveFocus();
  fireEvent.keyDown(selected, { key: 'ArrowDown' });
  const full = screen.getByRole('menuitemradio', { name: /Acceso completo/ });
  expect(full).toHaveFocus();
  fireEvent.keyDown(full, { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it.each(['running', 'approval'])('impide cambiar permisos durante un turno en %s', async (state) => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({
    ...empty, running: state === 'running',
    pending_approvals: state === 'approval' ? [{ id: 'a1', session_id: session.id, call_id: 'c1', method: 'db_clear', params: {}, status: 'pending', created_at: 1, decided_at: null }] : [],
  });
  render(<AgentView />);
  await act(async () => {});
  const trigger = screen.getByRole('button', { name: 'Permisos: Aprobar por mí' });
  expect(trigger).toBeDisabled();
  fireEvent.click(trigger);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  if (state === 'approval') expect(screen.getByLabelText('1 por aprobar')).toBeInTheDocument();
});

it.each<{ mode: AgentPermissionMode; label: string }>([
  { mode: 'ask', label: 'Solicitar aprobación' },
  { mode: 'auto', label: 'Aprobar por mí' },
  { mode: 'full', label: 'Acceso completo' },
])('muestra la decisión pendiente del motor sin autoaprobarla en $mode', async ({ mode, label }) => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [{ ...session, permission_mode: mode }] });
  const approval: AgentApproval = {
    id: 'a1', session_id: session.id, call_id: 'c1', method: 'gdrive_upload',
    params: { draft: 'resumen.pdf', folder_id: 'Informes' }, status: 'pending', created_at: 1, decided_at: null,
    context: { account: 'ana@example.com' },
  };
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, pending_approvals: [approval] });
  const approve = vi.spyOn(agentApi, 'agentApprove');
  const deny = vi.spyOn(agentApi, 'agentDeny').mockResolvedValue({ approval: { ...approval, status: 'denied' } });
  const saveMode = vi.spyOn(agentApi, 'agentSessionPermissionsSet');
  render(<AgentView />);
  await act(async () => {});
  expect(screen.getByRole('button', { name: `Permisos: ${label}` })).toBeDisabled();
  const card = within(screen.getByRole('group', { name: 'Confirmación de acción' }));
  expect(card.getByText('Subir un borrador a Google Drive')).toBeInTheDocument();
  expect(card.getByText('Carpeta remota: Informes')).toBeInTheDocument();
  expect(card.getByText('Cuenta: ana@example.com')).toBeInTheDocument();
  expect(card.getByText('Borrador: resumen.pdf')).toBeInTheDocument();
  expect(approve).not.toHaveBeenCalled();
  expect(deny).not.toHaveBeenCalled();
  expect(saveMode).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(card.getByRole('button', { name: 'Rechazar esta acción' })); });
  expect(deny).toHaveBeenCalledExactlyOnceWith('a1');
  expect(approve).not.toHaveBeenCalled();
  expect(saveMode).not.toHaveBeenCalled();
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
  fireEvent.click(screen.getByText('Acciones sensibles', { selector: 'summary' }));
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
  fireEvent.click(screen.getByText('Acciones sensibles', { selector: 'summary' }));
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
  fireEvent.click(screen.getByText('Acciones sensibles', { selector: 'summary' }));
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
  expect(within(screen.getByRole('region', { name: 'Atención del agente' })).getByText('El agente está trabajando')).toBeInTheDocument();
  await act(async () => {
    current.resolve({ ...empty, running: true, messages: [{ role: 'user', content: 'Mensaje nuevo', ts: 1 }] });
  });
  expect(screen.getByText('Mensaje nuevo')).toBeInTheDocument();
  await act(async () => { vi.advanceTimersByTime(1500); });
  expect(list).toHaveBeenCalledTimes(3);
  expect(screen.getByText('Respuesta final')).toBeInTheDocument();
  expect(screen.queryByText('El agente está trabajando')).not.toBeInTheDocument();
});

it('no repite el estado de trabajo mientras una herramienta en curso ya lo muestra', async () => {
  const call = (status: string) => ({ id: 'c', name: 'shell_run', params: { command: 'npm test' }, status, gated: true });
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true,
    messages: [{ role: 'assistant', content: '', ts: 1, tool_calls: [call('running')] }] } as never);
  const { unmount } = render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  expect(screen.getByText(/Ejecutando/)).toBeInTheDocument();
  expect(screen.queryByText('El agente está trabajando')).not.toBeInTheDocument();
  unmount();
  list.mockResolvedValue({ ...empty, running: true,
    messages: [{ role: 'assistant', content: '', ts: 1, tool_calls: [{ ...call('done'), result: '{"exit_code":0}' }] }] } as never);
  render(<AgentView />);
  await act(async () => {});
  expect(await screen.findByText(/Ejecutó/)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Atención del agente' })).getByText('El agente está trabajando')).toBeInTheDocument();
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
  expect(within(screen.getByRole('region', { name: 'Atención del agente' })).getByText('El agente está trabajando')).toBeInTheDocument();
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
  expect(within(screen.getByRole('region', { name: 'Atención del agente' })).getByText('El agente está trabajando')).toBeInTheDocument();
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
  const tiles = within(screen.getByLabelText('Adjuntos'));
  expect(tiles.getByText('xlsx')).toBeVisible();
  expect(tiles.getByText('carpeta')).toBeVisible();
  expect(tiles.getByRole('button', { name: 'Quitar clientes.xlsx' }).parentElement).toHaveClass('absolute');
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Genera el informe' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  expect(agentApi.agentMessageSend).toHaveBeenCalledWith('s1', 'Genera el informe', expect.any(String), ['a1', 'a2']);
  expect(screen.queryByText('clientes.xlsx')).not.toBeInTheDocument();
});

it('adjunta archivos soltados por ruta y capturas pegadas por contenido', async () => {
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const attach = vi.spyOn(agentApi, 'agentAttach')
    .mockResolvedValueOnce({ attachments: [{ id: 'a1', name: 'informe.pdf', kind: 'files' }] })
    .mockResolvedValueOnce({ attachments: [{ id: 'a2', name: 'x-captura.png', kind: 'files' }] });
  const previousApi = window.electronAPI;
  window.electronAPI = { ...window.electronAPI!, getPathForFile: (file: File) => (file.name === 'informe.pdf' ? 'C:\\docs\\informe.pdf' : '') };
  const createObjectURL = vi.fn(() => 'blob:captura');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL }));
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  const pdf = new File(['%PDF'], 'informe.pdf', { type: 'application/pdf' });
  await act(async () => { fireEvent.drop(screen.getByRole('group', { name: 'Redactar mensaje' }), { dataTransfer: { files: [pdf], types: ['Files'] } }); });
  const shot = new File(['png'], 'captura.png', { type: 'image/png' });
  await act(async () => { fireEvent.paste(screen.getByLabelText('Mensaje para el agente'), { clipboardData: { files: [shot] } }); });
  await waitFor(() => expect(screen.getByText('x-captura.png')).toBeInTheDocument());
  expect(attach.mock.calls).toEqual([
    ['files', { paths: ['C:\\docs\\informe.pdf'], data: [] }],
    ['files', { paths: [], data: [{ name: 'captura.png', data: btoa('png') }] }],
  ]);
  expect(screen.getByText('informe.pdf')).toBeInTheDocument();
  expect(createObjectURL).toHaveBeenCalledWith(shot);
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Revisa' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  expect(agentApi.agentMessageSend).toHaveBeenCalledWith('s1', 'Revisa', expect.any(String), ['a1', 'a2']);
  window.electronAPI = previousApi;
  vi.unstubAllGlobals();
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

it.each([false, true])('el reintento conserva la identidad solo con los mismos adjuntos: cambio=%s', async (changed) => {
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.spyOn(agentApi, 'agentAttach').mockResolvedValue({ attachments: [{ id: 'a1', name: 'datos.xlsx', kind: 'files' }] });
  vi.mocked(agentApi.agentMessageSend).mockRejectedValueOnce(new Error('Sin conexión')).mockResolvedValue({ accepted: true });
  localStorage.setItem('antares-agent-session', 's1');
  render(<AgentView />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Revisa los datos' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  expect(screen.getByLabelText('Mensaje para el agente')).toHaveValue('Revisa los datos');
  if (changed) await act(async () => { fireEvent.click(screen.getByLabelText('Adjuntar archivos')); });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  const [first, second] = vi.mocked(agentApi.agentMessageSend).mock.calls;
  expect(second[3]).toEqual(changed ? ['a1'] : []);
  if (changed) expect(second[2]).not.toBe(first[2]);
  else expect(second[2]).toBe(first[2]);
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

it('presenta la cola en orden y permite quitar un pendiente sin perder el borrador ni sus adjuntos', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true });
  vi.spyOn(agentApi, 'agentAttach').mockResolvedValue({ attachments: [{ id: 'a1', name: 'informe.pdf', kind: 'files' }] });
  render(<AgentView />);
  await act(async () => {});
  const composer = within(screen.getByRole('group', { name: 'Redactar mensaje' }));
  const input = composer.getByRole('textbox', { name: 'Mensaje para el agente' });
  fireEvent.change(input, { target: { value: 'Primero revisa las firmas' } });
  await act(async () => { fireEvent.click(composer.getByRole('button', { name: 'Dejar para después' })); });
  await act(async () => { fireEvent.click(composer.getByRole('button', { name: 'Adjuntar archivos' })); });
  fireEvent.change(input, { target: { value: 'Después compara el informe' } });
  await act(async () => { fireEvent.click(composer.getByRole('button', { name: 'Dejar para después' })); });
  fireEvent.change(input, { target: { value: 'Borrador que sigo escribiendo' } });
  await act(async () => { fireEvent.click(composer.getByRole('button', { name: 'Adjuntar archivos' })); });
  const queue = within(screen.getByRole('region', { name: 'Mensajes en cola' }));
  expect(queue.getByLabelText('2 mensajes pendientes')).toBeVisible();
  const items = within(queue.getByRole('list', { name: 'Orden de envío' })).getAllByRole('listitem');
  expect(within(items[0]).getByText('Primero revisa las firmas')).toBeVisible();
  expect(within(items[0]).getByText('A continuación')).toBeVisible();
  expect(within(items[1]).getByText('Después compara el informe')).toBeVisible();
  expect(within(items[1]).getByText('1 adjunto')).toBeVisible();
  fireEvent.click(within(items[0]).getByRole('button', { name: 'Quitar de la cola' }));
  expect(queue.getByLabelText('1 mensaje pendiente')).toBeVisible();
  expect(queue.queryByText('Primero revisa las firmas')).not.toBeInTheDocument();
  expect(queue.getByText('Después compara el informe')).toBeVisible();
  expect(queue.getByText('A continuación')).toBeVisible();
  expect(input).toHaveValue('Borrador que sigo escribiendo');
  expect(composer.getByLabelText('Adjuntos')).toHaveTextContent('informe.pdf');
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
});

it('permite desplegar un mensaje largo en cola sin enviarlo ni alterar el borrador', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true });
  render(<AgentView />);
  await act(async () => {});
  const text = 'Revisa el informe completo, conserva los nombres de archivo y compara cada tabla con su versión anterior.\nIncluye también los anexos y las observaciones de la última página.';
  const input = screen.getByRole('textbox', { name: 'Mensaje para el agente' });
  fireEvent.change(input, { target: { value: text } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dejar para después' })); });
  fireEvent.change(input, { target: { value: 'Sigo escribiendo' } });
  const queue = within(screen.getByRole('region', { name: 'Mensajes en cola' }));
  const summary = queue.getByTitle('Ver mensaje completo');
  const details = summary.closest('details');
  expect(details).not.toHaveAttribute('open');
  fireEvent.click(summary);
  expect(details).toHaveAttribute('open');
  expect(summary).toHaveTextContent(text.replace('\n', ' '));
  fireEvent.click(summary);
  expect(details).not.toHaveAttribute('open');
  expect(input).toHaveValue('Sigo escribiendo');
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
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
  expect(screen.getByText('Tarea pendiente')).toHaveAttribute('title', 'Reintentar el envío pendiente');
  expect(screen.getByText('Revisar envío')).toBeVisible();
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
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dejar para después' })); });
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
  expect(screen.getByRole('button', { name: 'Permitir esta acción' })).toBeInTheDocument();
  expect(approve).not.toHaveBeenCalled();
  expect(deny).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByLabelText('Detener')); });
  expect(screen.queryByRole('button', { name: 'Permitir esta acción' })).not.toBeInTheDocument();
  expect(approve).not.toHaveBeenCalled();
});

it.each([true, false])('muestra la decisión en curso y permite reintentar si falla: aprobar=%s', async (approved) => {
  localStorage.setItem('antares-agent-session', session.id);
  const approval = { id: 'a1', session_id: session.id, call_id: 'c1', method: 'shell_run', params: { command: 'npm test' },
    status: 'pending' as const, created_at: 1, decided_at: null };
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty,
    pending_approvals: [approval, { ...approval, id: 'a2', call_id: 'c2' }] });
  const attempt = deferred<Awaited<ReturnType<typeof agentApi.agentApprove>>>();
  const approve = vi.spyOn(agentApi, 'agentApprove').mockReturnValue(attempt.promise);
  const deny = vi.spyOn(agentApi, 'agentDeny').mockReturnValue(attempt.promise);
  render(<AgentView />);
  await act(async () => {});
  const [card, other] = screen.getAllByRole('group', { name: 'Confirmación de acción' });
  const action = within(card).getByRole('button', { name: approved ? 'Permitir esta acción' : 'Rechazar esta acción' });
  await act(async () => { fireEvent.click(action); fireEvent.click(action); });
  expect(screen.getByRole('status', { name: 'Estado de la aprobación' })).toHaveTextContent(approved ? 'Aprobando…' : 'Rechazando…');
  expect(approved ? approve : deny).toHaveBeenCalledTimes(1);
  expect(approved ? deny : approve).not.toHaveBeenCalled();
  expect(within(other).queryByRole('status')).not.toBeInTheDocument();
  expect(within(other).getByRole('button', { name: 'Permitir esta acción' })).toBeDisabled();
  await act(async () => { attempt.reject(new Error('Sin conexión')); });
  expect(within(card).getByRole('button', { name: 'Permitir esta acción' })).toBeEnabled();
  expect(within(card).getByRole('button', { name: 'Rechazar esta acción' })).toBeEnabled();
  expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Sin conexión', type: 'error' }));
  (approved ? approve : deny).mockResolvedValue({ approval: { ...approval, status: approved ? 'approved' : 'denied' } });
  list.mockResolvedValue(empty);
  await act(async () => { fireEvent.click(action); });
  expect(approved ? approve : deny).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('group', { name: 'Confirmación de acción' })).not.toBeInTheDocument();
});

it.each(['content', 'reasoning'] as const)('evita repetir el indicador general cuando ya transmite %s', async (field) => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true,
    messages: [{ role: 'assistant', content: '', [field]: 'Preparando el informe', partial: true, ts: 1 }] });
  render(<AgentView />);
  await act(async () => {});
  expect(screen.getByText('Preparando el informe')).toBeInTheDocument();
  expect(screen.queryByText('El agente está trabajando')).not.toBeInTheDocument();
});

it('envía un mensaje en cola como corrección del encargo en curso', async () => {
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true });
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Usa la plantilla B' } });
  fireEvent.click(screen.getByRole('button', { name: 'Dejar para después' }));
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar como corrección')); });
  expect(agentApi.agentMessageSend).toHaveBeenCalledExactlyOnceWith('s1', 'Usa la plantilla B', expect.any(String), [], true);
  expect(screen.queryByText('En cola')).not.toBeInTheDocument();
});

it('admite una indicación inmediata una sola vez y confirma recepción después de aceptarla', async () => {
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true });
  const admitted = deferred<{ accepted: boolean }>();
  vi.mocked(agentApi.agentMessageSend).mockReturnValue(admitted.promise);
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Usa la plantilla B' } });
  const indicate = screen.getByRole('button', { name: 'Indicar ahora' });
  fireEvent.click(indicate);
  fireEvent.click(indicate);
  expect(agentApi.agentMessageSend).toHaveBeenCalledExactlyOnceWith('s1', 'Usa la plantilla B', expect.any(String), [], true);
  expect(screen.queryByText(/Indicación recibida/)).not.toBeInTheDocument();
  await act(async () => { admitted.resolve({ accepted: true }); });
  expect(screen.getByText('Indicación recibida.')).toHaveAttribute('role', 'status');
  expect(screen.queryByText('En cola')).not.toBeInTheDocument();
});

it.each(['rechazo', 'sin aceptación'])('una indicación con %s conserva borrador, adjuntos e identidad y mantiene el turno anterior', async (failure) => {
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true });
  vi.spyOn(agentApi, 'agentAttach').mockResolvedValue({ attachments: [{ id: 'a1', name: 'plantilla.pdf', kind: 'files' }] });
  if (failure === 'rechazo') vi.mocked(agentApi.agentMessageSend).mockRejectedValueOnce(new Error('No se pudo registrar la indicación'));
  else vi.mocked(agentApi.agentMessageSend).mockResolvedValueOnce({ accepted: false });
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  await act(async () => { fireEvent.click(screen.getByLabelText('Adjuntar archivos')); });
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Usa esta plantilla' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Indicar ahora' })); });
  expect(screen.getByLabelText('Mensaje para el agente')).toHaveValue('Usa esta plantilla');
  expect(screen.getByText('plantilla.pdf')).toBeInTheDocument();
  expect(screen.getByLabelText('Detener')).toBeInTheDocument();
  expect(screen.queryByText(/Indicación recibida/)).not.toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Indicar ahora' })); });
  const [first, retry] = vi.mocked(agentApi.agentMessageSend).mock.calls;
  expect(retry).toEqual(['s1', 'Usa esta plantilla', first[2], ['a1'], true]);
  expect(screen.getByText('Indicación recibida.')).toHaveAttribute('role', 'status');
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
  fireEvent.click(within(screen.getByRole('group', { name: 'Vistas del agente' })).getByRole('button', { name: 'Agentes' }));
  await act(async () => { fireEvent.click(screen.getByTitle('Nueva conversación con Informe mensual')); });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ profile_id: 'p1' }));
  expect(screen.getByLabelText('Mensaje para el agente')).toHaveValue('Prepara el informe de este mes');
  const suggestions = within(screen.getByRole('group', { name: 'Sugerencias' }));
  expect(suggestions.getAllByRole('button')).toHaveLength(1);
  expect(suggestions.getByRole('button', { name: 'Prepara el informe de este mes' })).toBeEnabled();
});

it('envía el primer texto una sola vez ante doble Enter y conserva lo escrito durante la creación', async () => {
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [suggestionProvider] });
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const created = deferred<{ session: AgentSession }>();
  const create = vi.spyOn(agentApi, 'agentSessionCreate').mockReturnValue(created.promise);
  render(<AgentView />);
  await act(async () => {});
  const input = screen.getByLabelText('Mensaje para el agente');
  expect(input).toBeEnabled();
  fireEvent.change(input, { target: { value: 'Mi primer encargo' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(create).toHaveBeenCalledExactlyOnceWith({ provider: 'local', model: 'prueba' });
  expect(input).toHaveValue('Mi primer encargo');
  fireEvent.change(input, { target: { value: 'El siguiente encargo' } });
  await act(async () => { created.resolve({ session }); });
  expect(agentApi.agentMessageSend).toHaveBeenCalledExactlyOnceWith('s1', 'Mi primer encargo', expect.any(String), []);
  expect(input).toHaveValue('El siguiente encargo');
});

it('mantiene activo el primer turno mientras espera la aceptación del mensaje', async () => {
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [suggestionProvider] });
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [] });
  vi.spyOn(agentApi, 'agentSessionCreate').mockResolvedValue({ session });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const send = deferred<{ accepted: boolean }>();
  vi.mocked(agentApi.agentMessageSend).mockReturnValue(send.promise);
  render(<AgentView />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Primer encargo' } });
  await act(async () => { fireEvent.keyDown(screen.getByLabelText('Mensaje para el agente'), { key: 'Enter' }); });
  expect(within(screen.getByRole('region', { name: 'Atención del agente' })).getByText('El agente está trabajando')).toBeInTheDocument();
  await act(async () => { send.resolve({ accepted: true }); });
});

it('conserva el primer borrador sin proveedor y no crea ni envía una conversación', async () => {
  const create = vi.spyOn(agentApi, 'agentSessionCreate');
  render(<AgentView />);
  await act(async () => {});
  const input = screen.getByLabelText('Mensaje para el agente');
  fireEvent.change(input, { target: { value: 'Encargo pendiente' } });
  expect(input).toBeEnabled();
  expect(screen.getByLabelText('Enviar')).toBeDisabled();
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
  expect(input).toHaveValue('Encargo pendiente');
  expect(addToast).toHaveBeenCalledWith({ message: 'Elige un proveedor IA', type: 'error' });
  expect(create).not.toHaveBeenCalled();
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
});

it('conserva el primer borrador si falla la creación y permite volver a enviarlo', async () => {
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [suggestionProvider] });
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const create = vi.spyOn(agentApi, 'agentSessionCreate')
    .mockRejectedValueOnce(new Error('No se pudo crear')).mockResolvedValue({ session });
  render(<AgentView />);
  await act(async () => {});
  const input = screen.getByLabelText('Mensaje para el agente');
  fireEvent.change(input, { target: { value: 'Primer encargo' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  expect(input).toHaveValue('Primer encargo');
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
  expect(addToast).toHaveBeenCalledWith({ message: 'No se pudo crear', type: 'error' });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  expect(create).toHaveBeenCalledTimes(2);
  expect(agentApi.agentMessageSend).toHaveBeenCalledExactlyOnceWith('s1', 'Primer encargo', expect.any(String), []);
  expect(input).toHaveValue('');
});

it.each(['texto', 'sugerencia'])('reintenta %s con la misma identidad si se pierde la respuesta de aceptación', async (source) => {
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [suggestionProvider] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [] });
  const create = vi.spyOn(agentApi, 'agentSessionCreate').mockResolvedValue({ session });
  const accepted = new Set<string>();
  vi.mocked(agentApi.agentMessageSend).mockImplementation(async (_session, _content, requestId) => {
    if (accepted.has(requestId)) return { accepted: true, duplicate: true };
    accepted.add(requestId);
    throw new Error('Respuesta perdida');
  });
  localStorage.setItem('antares-agent-session', 's1');
  render(<AgentView />);
  await act(async () => {});
  const input = screen.getByLabelText('Mensaje para el agente');
  const submit = () => {
    if (source === 'texto') {
      fireEvent.change(input, { target: { value: 'Encargo aceptado' } });
      fireEvent.click(screen.getByLabelText('Enviar'));
    } else {
      fireEvent.click(within(screen.getByRole('group', { name: 'Sugerencias' })).getAllByRole('button')[0]);
    }
  };
  await act(async () => { submit(); });
  await act(async () => { submit(); });
  expect(agentApi.agentMessageSend).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenCalledTimes(1);
  expect(accepted.size).toBe(1);
});

it('marca el estado desactualizado si falla el sondeo y lo recupera sin perder el historial', async () => {
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true,
    messages: [{ role: 'assistant', content: 'Última respuesta recibida', ts: 1 }] });
  localStorage.setItem('antares-agent-session', 's1');
  vi.useFakeTimers();
  render(<AgentView />);
  await act(async () => {});
  expect(screen.getByText('Última respuesta recibida')).toBeVisible();
  list.mockRejectedValueOnce(new Error('Sin conexión'));
  await act(async () => { vi.advanceTimersByTime(1500); });
  expect(screen.getByRole('region', { name: 'Atención del agente' })).toHaveTextContent(/El estado mostrado puede estar desactualizado/);
  expect(screen.getByText('Última respuesta recibida')).toBeVisible();
  expect(screen.queryByText('El agente está trabajando')).not.toBeInTheDocument();
  list.mockResolvedValue({ ...empty, messages: [{ role: 'assistant', content: 'Respuesta confirmada', ts: 2 }] });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reintentar actualización' })); });
  expect(screen.queryByText(/El estado mostrado puede estar desactualizado/)).not.toBeInTheDocument();
  expect(screen.getByText('Respuesta confirmada')).toBeVisible();
});

it('envía una sugerencia del composer creando una única conversación si no hay ninguna', async () => {
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [suggestionProvider] });
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const created = deferred<{ session: AgentSession }>();
  const create = vi.spyOn(agentApi, 'agentSessionCreate').mockReturnValue(created.promise);
  render(<AgentView />);
  const group = await screen.findByRole('group', { name: 'Sugerencias' });
  expect(screen.getByText(/Cuéntame qué necesitas\. Puedo ayudarte/)).toBeVisible();
  expect(screen.getByLabelText('Mensaje para el agente')).toHaveAttribute('placeholder', 'Cuéntame qué necesitas…');
  const buttons = within(group).getAllByRole('button');
  expect(buttons).toHaveLength(3);
  expect(within(group).getAllByRole('button', { hidden: true })).toHaveLength(3);
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
  const [first, second] = vi.mocked(agentApi.agentMessageSend).mock.calls;
  expect(second[2]).toBe(first[2]);
  expect(screen.getByLabelText('Mensaje para el agente')).toHaveValue('Borrador sin enviar');
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
  const newChat = screen.getByRole('button', { name: 'Nueva conversación' });
  expect(newChat).toHaveTextContent('Nuevo chat');
  await act(async () => { fireEvent.click(newChat); });
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

it('recarga la conversación en cuanto el motor avisa de un cambio, sin esperar al sondeo', async () => {
  let notify: ((method: string, params: unknown) => void) | null = null;
  vi.spyOn(window.electronAPI, 'onNotify').mockImplementation((cb) => { notify = cb; return () => { notify = null; }; });
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  localStorage.setItem('antares-agent-session', 's1');
  render(<AgentView />);
  await waitFor(() => expect(list).toHaveBeenCalled());
  const before = list.mock.calls.length;
  await act(async () => { notify?.('agent.changed', { session_id: 'otra' }); });
  expect(list.mock.calls.length).toBe(before);
  list.mockResolvedValue({ ...empty, messages: [{ role: 'assistant', content: 'Respuesta en vivo', ts: 2 }] });
  await act(async () => { notify?.('agent.changed', { session_id: 's1' }); });
  expect(await screen.findByText('Respuesta en vivo')).toBeInTheDocument();
});

it('prioriza la aprobación y la pregunta, y anuncia cada pregunta una sola vez', async () => {
  const update = agentUpdates();
  const question = { id: 'q1', session_id: 's1', questions: [{ id: 'name', prompt: '¿Qué nombre uso?' }] };
  const approval = { id: 'a1', session_id: 's1', call_id: 'c1', method: 'fs_write', params: {}, status: 'pending' as const, created_at: 1, decided_at: null };
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, questions: [question], pending_approvals: [approval] });
  localStorage.setItem('antares-agent-session', 's1');
  render(<AgentView />);
  await act(async () => {});
  const attention = screen.getByRole('region', { name: 'Atención del agente' });
  expect(within(attention).getByRole('button', { name: 'Revisar acción' })).toBeVisible();
  fireEvent.click(within(attention).getByRole('button', { name: 'Revisar acción' }));
  expect(screen.getByLabelText('Ver detalles de la acción')).toHaveFocus();
  expect(within(attention).queryByRole('button', { name: 'Responder' })).not.toBeInTheDocument();
  list.mockResolvedValue({ ...empty, questions: [question] });
  await act(async () => { update(); });
  expect(within(attention).getByRole('button', { name: 'Responder' })).toBeVisible();
  const announcement = screen.getByRole('status', { name: 'Avisos del agente' });
  expect(announcement).toHaveTextContent('El agente necesita tu respuesta para continuar.');
  const mutations = vi.fn();
  const observer = new MutationObserver(mutations);
  observer.observe(announcement, { childList: true, subtree: true, characterData: true });
  await act(async () => { update(); });
  expect(mutations).not.toHaveBeenCalled();
  list.mockResolvedValue({ ...empty, questions: [{ ...question, id: 'q2' }] });
  await act(async () => { update(); });
  expect(mutations).toHaveBeenCalledTimes(1);
  observer.disconnect();
});

it('conserva el foco al llegar una pregunta y lo lleva a la respuesta solo al elegir Responder', async () => {
  const update = agentUpdates();
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  localStorage.setItem('antares-agent-session', 's1');
  render(<AgentView />);
  await act(async () => {});
  const composer = screen.getByLabelText('Mensaje para el agente');
  composer.focus();
  list.mockResolvedValue({ ...empty, questions: [{ id: 'q1', session_id: 's1', questions: [{ id: 'name', prompt: 'Nombre del informe' }] }] });
  await act(async () => { update(); });
  expect(composer).toHaveFocus();
  fireEvent.click(within(screen.getByRole('region', { name: 'Atención del agente' })).getByRole('button', { name: 'Responder' }));
  expect(screen.getByLabelText('Nombre del informe')).toHaveFocus();
});

it.each([false, true])('muestra el resultado sin arrastrar el historial cuando se lee arriba: %s', async (readingAbove) => {
  const update = agentUpdates();
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty,
    messages: [{ role: 'assistant', content: 'Respuesta anterior', ts: 1 }] });
  localStorage.setItem('antares-agent-session', 's1');
  render(<AgentView />);
  await act(async () => {});
  const transcript = screen.getByRole('region', { name: 'Mensajes' });
  Object.defineProperties(transcript, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } });
  transcript.scrollTop = readingAbove ? 0 : 800;
  fireEvent.scroll(transcript);
  vi.mocked(transcript.scrollTo).mockClear();
  list.mockResolvedValue({ ...empty, messages: [{ role: 'assistant', content: 'Respuesta anterior', ts: 1 }],
    artifacts: [{ id: 'result', family: 'canvas', template_id: 'doc', template_revision: 'r1',
      files: [{ name: 'informe.pdf', sha256: 'hash', pages: 1, mime: 'application/pdf', size: 20 }] }] });
  await act(async () => { update(); });
  expect(screen.getByRole('region', { name: 'Atención del agente' })).toHaveTextContent('Resultado disponible: informe.pdf');
  if (readingAbove) {
    expect(transcript.scrollTo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Ir al final/ })).toBeVisible();
  } else expect(transcript.scrollTo).toHaveBeenCalledWith({ top: 1000 });
  expect(screen.getByRole('region', { name: 'Documento informe.pdf' })).toBeInTheDocument();
});

it('explica la actividad sin anunciar de nuevo los segundos transcurridos', async () => {
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true,
    messages: [{ role: 'assistant', content: '', ts: 1, tool_calls: [{ id: 'read', name: 'fs_read', params: {}, gated: false, status: 'running' }] }] });
  localStorage.setItem('antares-agent-session', 's1');
  vi.useFakeTimers();
  render(<AgentView />);
  await act(async () => {});
  expect(screen.getByRole('region', { name: 'Atención del agente' })).toHaveTextContent('Estoy trabajando con tus archivos.');
  const announcement = screen.getByRole('status', { name: 'Avisos del agente' });
  const mutations = vi.fn();
  const observer = new MutationObserver(mutations);
  observer.observe(announcement, { childList: true, subtree: true, characterData: true });
  await act(async () => { vi.advanceTimersByTime(3000); });
  expect(list).toHaveBeenCalled();
  expect(mutations).not.toHaveBeenCalled();
  observer.disconnect();
});

it('respeta movimiento reducido al ir al final del historial', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query === '(prefers-reduced-motion: reduce)', media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  localStorage.setItem('antares-agent-session', 's1');
  render(<AgentView />);
  await act(async () => {});
  const transcript = screen.getByRole('region', { name: 'Mensajes' });
  Object.defineProperties(transcript, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } });
  fireEvent.scroll(transcript);
  vi.mocked(transcript.scrollTo).mockClear();
  fireEvent.click(screen.getByRole('button', { name: /Ir al final/ }));
  expect(transcript.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'instant' });
});

it('mantiene el razonamiento que el usuario abrió al terminar la respuesta progresiva', async () => {
  const update = agentUpdates();
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true,
    messages: [{ role: 'assistant', content: 'Respuesta parcial', reasoning: 'Comparando documentos', partial: true, ts: 1 }] });
  localStorage.setItem('antares-agent-session', 's1');
  render(<AgentView />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Pensó' }));
  expect(screen.getByRole('button', { name: 'Pensó' })).toHaveAttribute('aria-expanded', 'true');
  list.mockResolvedValue({ ...empty, messages: [{ role: 'assistant', content: 'Respuesta final', reasoning: 'Comparando documentos', ts: 2 }] });
  await act(async () => { update(); });
  expect(screen.getByRole('button', { name: 'Pensó' })).toHaveAttribute('aria-expanded', 'true');
});

it('no anuncia una pregunta del chat anterior al cambiar de conversación', async () => {
  const second = { ...session, id: 's2', title: 'Segunda' };
  const loading = deferred<Snapshot>();
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [session, second] });
  vi.spyOn(agentApi, 'agentMessagesList').mockImplementation((id) => id === 's2' ? loading.promise : Promise.resolve({
    ...empty, questions: [{ id: 'q1', session_id: 's1', questions: [{ id: 'name', prompt: 'Nombre' }] }],
  }));
  localStorage.setItem('antares-agent-session', 's1');
  render(<AgentView />);
  await act(async () => {});
  const announcements: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) announcements.push(node.textContent || '');
  });
  observer.observe(screen.getByRole('status', { name: 'Avisos del agente' }), { childList: true, subtree: true });
  await act(async () => { fireEvent.click(screen.getByText('Segunda')); });
  expect(announcements).not.toContain('El agente necesita tu respuesta para continuar.');
  expect(screen.queryByRole('region', { name: 'Atención del agente' })).not.toBeInTheDocument();
  observer.disconnect();
  await act(async () => { loading.resolve(empty); });
});

it('confirma la recepción solo tras la admisión y conserva ese recibo si falla el refresco', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const admitted = deferred<{ accepted: boolean }>();
  vi.mocked(agentApi.agentMessageSend).mockReturnValue(admitted.promise);
  render(<AgentView />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Prepara el informe' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  const receipts = within(screen.getByRole('region', { name: 'Estado de los envíos' }));
  expect(receipts.getByText('Enviando mensaje…')).toBeVisible();
  expect(receipts.queryByText('Mensaje recibido.')).not.toBeInTheDocument();
  list.mockRejectedValue(new Error('No se pudo leer el historial'));
  await act(async () => { admitted.resolve({ accepted: true }); });
  expect(receipts.getByText('Mensaje recibido.')).toBeVisible();
  expect(screen.getByRole('region', { name: 'Estado de los envíos' })).toHaveClass('sr-only');
  expect(within(screen.getByRole('region', { name: 'Atención del agente' })).getByText(/El estado mostrado puede estar desactualizado/)).toBeVisible();
});

it('el composer muestra los permisos en su barra y sin pista de teclado', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  render(<AgentView />);
  await act(async () => {});
  const composer = within(screen.getByRole('group', { name: 'Redactar mensaje' }));
  expect(composer.getByRole('button', { name: 'Permisos: Aprobar por mí' })).toBeVisible();
  expect(screen.queryByText('Mayús + Intro para una nueva línea')).not.toBeInTheDocument();
});

it('un mensaje sin aceptación conserva su borrador y ofrece recuperar la misma petición', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.mocked(agentApi.agentMessageSend).mockResolvedValueOnce({ accepted: false });
  render(<AgentView />);
  await act(async () => {});
  const input = screen.getByLabelText('Mensaje para el agente');
  fireEvent.change(input, { target: { value: 'Ordena este informe' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  expect(input).toHaveValue('Ordena este informe');
  expect(screen.getByText('Recepción sin confirmar.')).toBeVisible();
  const original = vi.mocked(agentApi.agentMessageSend).mock.calls[0];
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reintentar envío: Ordena este informe' })); });
  expect(vi.mocked(agentApi.agentMessageSend).mock.calls[1]).toEqual(original);
  expect(input).toHaveValue('');
  expect(screen.getByText('Mensaje recibido.')).toBeVisible();
});

it('ignora Intro repetido y composición IME sin impedir Shift+Intro', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  render(<AgentView />);
  await act(async () => {});
  const input = screen.getByLabelText('Mensaje para el agente');
  fireEvent.change(input, { target: { value: 'Un encargo' } });
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter', repeat: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  });
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
  expect(input).toHaveValue('Un encargo');
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
  expect(agentApi.agentMessageSend).toHaveBeenCalledExactlyOnceWith('s1', 'Un encargo', expect.any(String), []);
});

it.each(['texto nuevo', 'texto idéntico editado', 'adjunto nuevo', 'adjunto quitado'])('recupera el payload original y conserva un borrador con %s', async (change) => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.spyOn(agentApi, 'agentAttach')
    .mockResolvedValueOnce({ attachments: [{ id: 'a1', name: 'original.pdf', kind: 'files' }] })
    .mockResolvedValueOnce({ attachments: [{ id: 'a2', name: 'nuevo.pdf', kind: 'files' }] });
  const admitted = deferred<{ accepted: boolean; duplicate: boolean }>();
  vi.mocked(agentApi.agentMessageSend).mockRejectedValueOnce(new Error('Respuesta perdida')).mockReturnValueOnce(admitted.promise);
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByLabelText('Adjuntar archivos')); });
  const input = screen.getByLabelText('Mensaje para el agente');
  fireEvent.change(input, { target: { value: 'Encargo original' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  expect(input).toHaveValue('Encargo original');
  if (change === 'adjunto nuevo') await act(async () => { fireEvent.click(screen.getByLabelText('Adjuntar archivos')); });
  else if (change === 'adjunto quitado') fireEvent.click(screen.getByLabelText('Quitar original.pdf'));
  else {
    fireEvent.change(input, { target: { value: 'Borrador nuevo' } });
    if (change === 'texto idéntico editado') fireEvent.change(input, { target: { value: 'Encargo original' } });
  }
  const original = vi.mocked(agentApi.agentMessageSend).mock.calls[0];
  const retry = screen.getByRole('button', { name: 'Reintentar envío: Encargo original' });
  await act(async () => { fireEvent.click(retry); fireEvent.click(retry); });
  expect(vi.mocked(agentApi.agentMessageSend).mock.calls).toEqual([original, original]);
  expect(screen.getByText('Enviando mensaje…')).toBeVisible();
  await act(async () => { admitted.resolve({ accepted: true, duplicate: true }); });
  expect(input).toHaveValue(change === 'texto nuevo' ? 'Borrador nuevo' : 'Encargo original');
  expect(screen.queryByText('original.pdf')).not.toBeInTheDocument();
  if (change === 'adjunto nuevo') expect(screen.getByText('nuevo.pdf')).toBeVisible();
});

it.each(['aceptado', 'sin confirmar'])('conserva la edición y adjuntos hechos durante un envío %s', async (result) => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.spyOn(agentApi, 'agentAttach')
    .mockResolvedValueOnce({ attachments: [{ id: 'a1', name: 'original.pdf', kind: 'files' }] })
    .mockResolvedValueOnce({ attachments: [{ id: 'a2', name: 'nuevo.pdf', kind: 'files' }] });
  const admitted = deferred<{ accepted: boolean }>();
  vi.mocked(agentApi.agentMessageSend).mockReturnValue(admitted.promise);
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByLabelText('Adjuntar archivos')); });
  const input = screen.getByLabelText('Mensaje para el agente');
  fireEvent.change(input, { target: { value: 'Primero' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  fireEvent.change(input, { target: { value: 'Segundo' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Adjuntar archivos')); });
  await act(async () => { admitted.resolve({ accepted: result === 'aceptado' }); });
  expect(input).toHaveValue('Segundo');
  expect(screen.getByText('nuevo.pdf')).toBeVisible();
  expect(vi.mocked(agentApi.agentMessageSend).mock.calls[0]).toEqual(['s1', 'Primero', expect.any(String), ['a1']]);
});

it('captura el mensaje antes de esperar a que se cree el primer chat', async () => {
  vi.mocked(aiProvidersApi.aiProvidersList).mockResolvedValue({ providers: [suggestionProvider] });
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [] });
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const creation = deferred<{ session: AgentSession }>();
  vi.spyOn(agentApi, 'agentSessionCreate').mockReturnValue(creation.promise);
  render(<AgentView />);
  await act(async () => {});
  const input = screen.getByLabelText('Mensaje para el agente');
  fireEvent.change(input, { target: { value: 'Primer encargo' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  fireEvent.change(input, { target: { value: 'Encargo siguiente' } });
  await act(async () => { creation.resolve({ session }); });
  expect(agentApi.agentMessageSend).toHaveBeenCalledExactlyOnceWith('s1', 'Primer encargo', expect.any(String), []);
  expect(input).toHaveValue('Encargo siguiente');
});

it.each(['aceptado', 'sin confirmar'])('mantiene el recibo de un envío %s en su chat al navegar', async (result) => {
  const second = { ...session, id: 's2', title: 'Segunda' };
  vi.mocked(agentApi.agentSessionsList).mockResolvedValue({ sessions: [session, second] });
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const admitted = deferred<{ accepted: boolean }>();
  vi.mocked(agentApi.agentMessageSend).mockReturnValue(admitted.promise);
  vi.spyOn(agentApi, 'agentAttach')
    .mockResolvedValueOnce({ attachments: [{ id: 'a1', name: 'original.pdf', kind: 'files' }] })
    .mockResolvedValueOnce({ attachments: [{ id: 'a2', name: 'otro-chat.pdf', kind: 'files' }] });
  render(<AgentView />);
  await act(async () => {});
  const input = screen.getByLabelText('Mensaje para el agente');
  await act(async () => { fireEvent.click(screen.getByLabelText('Adjuntar archivos')); });
  fireEvent.change(input, { target: { value: 'Encargo del primer chat' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  await act(async () => { fireEvent.click(screen.getByText('Segunda')); });
  fireEvent.change(input, { target: { value: 'Borrador del segundo chat' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Adjuntar archivos')); });
  await act(async () => { admitted.resolve({ accepted: result === 'aceptado' }); });
  expect(input).toHaveValue('Borrador del segundo chat');
  expect(screen.getByText('otro-chat.pdf')).toBeVisible();
  if (result === 'aceptado') expect(screen.queryByText('original.pdf')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Estado de los envíos' })).not.toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByText('Primera')); });
  const receipts = screen.getByRole('region', { name: 'Estado de los envíos' });
  expect(receipts).toHaveTextContent('Encargo del primer chat');
  expect(receipts).toHaveTextContent(result === 'aceptado' ? 'Mensaje recibido.' : 'Recepción sin confirmar.');
  expect(input).toHaveValue('Borrador del segundo chat');
});

it('conserva varios envíos no confirmados y muestra la recepción del que se acaba de recuperar', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.mocked(agentApi.agentMessageSend).mockRejectedValueOnce(new Error('Respuesta A perdida')).mockRejectedValueOnce(new Error('Respuesta B perdida'));
  render(<AgentView />);
  await act(async () => {});
  const input = screen.getByLabelText('Mensaje para el agente');
  for (const text of ['Encargo A', 'Encargo B']) {
    fireEvent.change(input, { target: { value: text } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  }
  const receipts = within(screen.getByRole('region', { name: 'Estado de los envíos' }));
  expect(receipts.getByRole('button', { name: 'Reintentar envío: Encargo A' })).toBeVisible();
  expect(receipts.getByRole('button', { name: 'Reintentar envío: Encargo B' })).toBeVisible();
  const original = vi.mocked(agentApi.agentMessageSend).mock.calls[0];
  await act(async () => { fireEvent.click(receipts.getByRole('button', { name: 'Reintentar envío: Encargo A' })); });
  expect(vi.mocked(agentApi.agentMessageSend).mock.calls[2]).toEqual(original);
  expect(receipts.getByText('Mensaje recibido.')).toHaveTextContent('Encargo A');
  expect(receipts.getByRole('button', { name: 'Reintentar envío: Encargo B' })).toBeVisible();
  expect(input).toHaveValue('Encargo B');
});

it('conserva una indicación fallida de la cola y la recupera con su misma intención tras remontar', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true });
  vi.mocked(agentApi.agentMessageSend).mockResolvedValueOnce({ accepted: false });
  const first = render(<AgentView />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Usa la plantilla B' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dejar para después' })); });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar como corrección')); });
  const original = vi.mocked(agentApi.agentMessageSend).mock.calls[0];
  expect(JSON.parse(localStorage.getItem('antares-agent-queue') || '[]')).toEqual([
    { session: 's1', text: 'Usa la plantilla B', requestId: original[2], attachments: [], failed: true, correction: true },
  ]);
  first.unmount();
  list.mockResolvedValue(empty);
  render(<AgentView />);
  await act(async () => {});
  expect(agentApi.agentMessageSend).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByTitle('Reintentar el envío pendiente')); });
  expect(vi.mocked(agentApi.agentMessageSend).mock.calls[1]).toEqual(original);
  expect(screen.queryByText('En cola')).not.toBeInTheDocument();
  expect(screen.getByText('Indicación recibida.')).toBeVisible();
});

it.each([
  { correction: false, pending: false }, { correction: true, pending: false },
  { correction: false, pending: true }, { correction: true, pending: true },
])('recupera un envío directo tras remontar con correction=$correction y pending=$pending', async ({ correction, pending }) => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: correction });
  vi.spyOn(agentApi, 'agentAttach').mockResolvedValue({ attachments: [{ id: 'a1', name: 'original.pdf', kind: 'files' }] });
  const admitted = deferred<{ accepted: boolean }>();
  vi.mocked(agentApi.agentMessageSend).mockReturnValueOnce(admitted.promise);
  const first = render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByLabelText('Adjuntar archivos')); });
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Encargo original' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: correction ? 'Indicar ahora' : 'Enviar', exact: true })); });
  const original = vi.mocked(agentApi.agentMessageSend).mock.calls[0];
  expect(JSON.parse(localStorage.getItem('antares-agent-queue') || '[]')).toEqual([
    { session: 's1', text: 'Encargo original', requestId: original[2], attachments: ['a1'], failed: true, correction },
  ]);
  expect(screen.getByLabelText('Quitar de la cola')).toBeDisabled();
  if (!pending) await act(async () => { admitted.resolve({ accepted: false }); });
  first.unmount();
  if (pending) await act(async () => { admitted.resolve({ accepted: false }); });
  render(<AgentView />);
  await act(async () => {});
  expect(agentApi.agentMessageSend).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Borrador nuevo' } });
  await act(async () => { fireEvent.click(screen.getByTitle('Reintentar el envío pendiente')); });
  expect(vi.mocked(agentApi.agentMessageSend).mock.calls[1]).toEqual(original);
  expect(screen.getByLabelText('Mensaje para el agente')).toHaveValue('Borrador nuevo');
  expect(JSON.parse(localStorage.getItem('antares-agent-queue') || '[]')).toEqual([]);
  expect(screen.getByText(correction ? 'Indicación recibida.' : 'Mensaje recibido.')).toBeVisible();
});

it('no convierte un envío restaurado de intención desconocida en una indicación', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  localStorage.setItem('antares-agent-queue', JSON.stringify([{ session: 's1', text: 'Encargo anterior', requestId: 'previous' }]));
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true });
  render(<AgentView />);
  await act(async () => {});
  expect(screen.getByTitle('Reintentar el envío pendiente')).toBeVisible();
  expect(screen.queryByLabelText('Enviar como corrección')).not.toBeInTheDocument();
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
});

it.each(['web_open', 'web_read', 'web_click'])('muestra actividad web real durante %s', async (name) => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue({ ...empty, running: true, messages: [{
    role: 'assistant', content: '', ts: 1, tool_calls: [{ id: 'c', name, params: {}, gated: name === 'web_click', status: 'running' }],
  }] });
  render(<AgentView />);
  await act(async () => {});
  expect(within(screen.getByRole('region', { name: 'Atención del agente' })).getByText('Estoy trabajando en la página.')).toBeVisible();
});

it('un ACK anterior no sustituye el recibo de una indicación más reciente', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  localStorage.setItem('antares-agent-queue', JSON.stringify([{ session: 's1', text: 'Encargo A', requestId: 'queue-a' }]));
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  const first = deferred<{ accepted: boolean }>();
  vi.mocked(agentApi.agentMessageSend).mockReturnValueOnce(first.promise);
  render(<AgentView />);
  await act(async () => {});
  await act(async () => { fireEvent.click(screen.getByTitle('Reintentar el envío pendiente')); });
  expect(screen.getByText('Enviando mensaje…')).toBeVisible();
  list.mockResolvedValue({ ...empty, running: true });
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Indicación B' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Indicar ahora' })); });
  expect(screen.getByText('Indicación recibida.')).toBeVisible();
  await act(async () => { first.resolve({ accepted: true }); });
  expect(screen.getByText('Indicación recibida.')).toHaveTextContent('Indicación B');
  expect(screen.queryByText('Mensaje recibido.')).not.toBeInTheDocument();
});

it('el eco de un texto en el historial no confirma una respuesta de envío perdida', async () => {
  const update = agentUpdates();
  localStorage.setItem('antares-agent-session', session.id);
  const list = vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.mocked(agentApi.agentMessageSend).mockRejectedValueOnce(new Error('Respuesta perdida'));
  render(<AgentView />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('Mensaje para el agente'), { target: { value: 'Texto repetido' } });
  await act(async () => { fireEvent.click(screen.getByLabelText('Enviar')); });
  list.mockResolvedValue({ ...empty, messages: [{ role: 'user', content: 'Texto repetido', ts: 1 }] });
  await act(async () => { update(); });
  expect(screen.getByRole('button', { name: 'Reintentar envío: Texto repetido' })).toBeVisible();
  expect(screen.getByText('Recepción sin confirmar.')).toBeVisible();
  expect(screen.queryByText('Mensaje recibido.')).not.toBeInTheDocument();
});

it('invoca una skill con «/»: filtra el catálogo, elige con el teclado y envía su skill_id', async () => {
  localStorage.setItem('antares-agent-session', session.id);
  vi.spyOn(agentApi, 'agentMessagesList').mockResolvedValue(empty);
  vi.spyOn(agentApi, 'agentProfilesList').mockResolvedValue({ profiles: [] });
  const catalog = vi.spyOn(agentApi, 'agentSkillsList').mockResolvedValue({ skills: [
    { id: 'a'.repeat(24), name: 'pdf-review', description: 'Revisa PDFs' },
    { id: 'b'.repeat(24), name: 'informe-tecnico', description: 'Redacta informes' },
    { id: 'c'.repeat(24), name: 'firmas', description: 'Comprueba firmas' },
  ], library: '', warnings: [], truncated: false });
  render(<AgentView />);
  await act(async () => {});
  const box = screen.getByLabelText('Mensaje para el agente');
  fireEvent.change(box, { target: { value: 'Abre C:/datos' } });
  expect(screen.queryByRole('listbox', { name: 'Skills disponibles' })).not.toBeInTheDocument();
  expect(catalog).not.toHaveBeenCalled();
  fireEvent.change(box, { target: { value: 'Revisa /if' } });
  await act(async () => {});
  const listbox = screen.getByRole('listbox', { name: 'Skills disponibles' });
  expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['/informe-tecnicoRedacta informes']);
  fireEvent.keyDown(box, { key: 'Escape' });
  expect(screen.queryByRole('listbox', { name: 'Skills disponibles' })).not.toBeInTheDocument();
  fireEvent.change(box, { target: { value: 'Revisa /f' } });
  await act(async () => {});
  expect(within(screen.getByRole('listbox', { name: 'Skills disponibles' })).getAllByRole('option').map((option) => option.textContent?.split('/')[1]))
    .toEqual(['firmasComprueba firmas', 'pdf-reviewRevisa PDFs', 'informe-tecnicoRedacta informes']);
  fireEvent.keyDown(box, { key: 'ArrowDown' });
  expect(screen.getByRole('option', { name: /pdf-review/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('option', { name: /pdf-review/ }).querySelector('kbd')).not.toBeNull();
  expect(screen.getByRole('option', { name: /firmas/ }).querySelector('kbd')).toBeNull();
  expect(screen.getByRole('listbox', { name: 'Skills disponibles' }).closest('.agent-command-palette')).toHaveClass('absolute', 'bottom-full');
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(screen.queryByRole('listbox', { name: 'Skills disponibles' })).not.toBeInTheDocument();
  expect(box).toHaveValue('Revisa ');
  expect(within(screen.getByLabelText('Skill activa')).getByText('/pdf-review')).toBeVisible();
  expect(agentApi.agentMessageSend).not.toHaveBeenCalled();
  fireEvent.change(box, { target: { value: 'Revisa el contrato' } });
  await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
  expect(agentApi.agentMessageSend).toHaveBeenCalledExactlyOnceWith(session.id, 'Revisa el contrato', expect.any(String), [], false, 'a'.repeat(24));
  expect(screen.queryByLabelText('Skill activa')).not.toBeInTheDocument();
});
