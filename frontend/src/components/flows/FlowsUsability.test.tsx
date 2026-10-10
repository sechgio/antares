import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { flowsApi } from '../../api/flowsApi';
import { aiProvidersApi } from '../../api/aiProvidersApi';
import FlowList from './FlowList';
import { ApprovalCard, MessageRow } from '../agent/AgentTimeline';
import RunsView, { StepOutput } from './RunsView';
import ConnectionDetail from './ConnectionDetail';
import ProvidersView from './ProvidersView';
import { useState } from 'react';
import NodeConfigDrawer from './NodeConfigDrawer';
import type { FlowNode, FlowRun } from './types';

const { addToast, confirm } = vi.hoisted(() => ({ addToast: vi.fn(), confirm: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm }) }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(flowsApi, 'flowsList').mockResolvedValue({ flows: [] });
});

it('descubre ejecuciones nuevas y descarta respuestas anteriores que llegan tarde', async () => {
  vi.useFakeTimers();
  const run: FlowRun = { id: 'new', flow_id: 'flow', flow_name: 'Prueba', status: 'running', created_at: '2026-10-04T12:00:00Z', started_at: null, finished_at: null, steps: [], error: null, trigger_payload: {} };
  let resolveOld: (value: { runs: FlowRun[] }) => void = () => {};
  const list = vi.spyOn(flowsApi, 'flowsRunsList').mockResolvedValueOnce({ runs: [] })
    .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValue({ runs: [run] });
  const view = render(<RunsView />);
  try {
    await act(async () => {});
    expect(screen.getByText(/Sin ejecuciones todavía/)).toBeVisible();
    await act(async () => { vi.advanceTimersByTime(1500); });
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(list).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Ejecutando')).toBeVisible();
    await act(async () => { resolveOld({ runs: [] }); });
    expect(screen.getByText('Ejecutando')).toBeVisible();
    view.unmount();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(list).toHaveBeenCalledTimes(3);
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it('pide confirmación antes de reintentar una acción con resultado incierto', async () => {
  const step = { node_id: 'pdf', kind: 'tool_call', name: 'Imprimir', status: 'error' as const, started_at: null,
    finished_at: null, duration_ms: null, output: null, error: 'Acción con resultado incierto; comprueba su resultado' };
  const run: FlowRun = { id: 'r1', flow_id: 'flow-1', flow_name: 'Lote', status: 'error',
    created_at: '2026-10-04T12:00:00Z', started_at: null, finished_at: null, steps: [step],
    error: 'Uno o más nodos fallaron', trigger_payload: {} };
  vi.spyOn(flowsApi, 'flowsRunsList').mockResolvedValue({ runs: [run] });
  const runCall = vi.spyOn(flowsApi, 'flowsRun').mockResolvedValue({ run } as Awaited<ReturnType<typeof flowsApi.flowsRun>>);
  confirm.mockResolvedValue(true);
  render(<RunsView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ejecutar de nuevo' }));
  await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ type: 'destructive' })));
  await waitFor(() => expect(runCall).toHaveBeenCalledWith('flow-1', undefined, true));
});

it('ofrece reanudar una ejecución que quedó interrumpida', async () => {
  const run: FlowRun = { id: 'r1', flow_id: 'flow-1', flow_name: 'Lote', status: 'running', interrupted: true,
    created_at: '2026-10-04T12:00:00Z', started_at: null, finished_at: null, steps: [], error: null, trigger_payload: {} };
  vi.spyOn(flowsApi, 'flowsRunsList').mockResolvedValue({ runs: [run] });
  const resume = vi.spyOn(flowsApi, 'flowsRunResume').mockResolvedValue({ run });
  render(<RunsView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reanudar' }));
  await waitFor(() => expect(resume).toHaveBeenCalledWith('r1'));
});

it('permite aprobar una ejecución en espera desde su detalle', async () => {
  const run: FlowRun = { id: 'r1', flow_id: 'f1', flow_name: 'Lote', status: 'waiting',
    created_at: '2026-10-04T12:00:00Z', started_at: null, finished_at: null, steps: [],
    error: null, trigger_payload: {},
    checkpoint: { approvals: { a1: { id: 'a1', node_id: 'n1', node_name: 'Imprimir', method: 'flows_print_pdf', params: {}, decision: null } } } };
  vi.spyOn(flowsApi, 'flowsRunsList').mockResolvedValue({ runs: [run] });
  const decide = vi.spyOn(flowsApi, 'flowsApprovalDecide').mockResolvedValue({} as Awaited<ReturnType<typeof flowsApi.flowsApprovalDecide>>);
  render(<RunsView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Expandir' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Aprobar' }));
  await waitFor(() => expect(decide).toHaveBeenCalledWith({ run_id: 'r1', approval_id: 'a1', decision: 'approved' }));
});

it('muestra el texto parcial del agente con cursor de escritura', () => {
  render(<MessageRow msg={{ role: 'assistant', content: 'Escribiendo resp', partial: true, ts: 0 }} />);
  expect(screen.getByText(/Escribiendo resp/)).toBeVisible();
});

it('crea un ejemplo manual que funciona sin configurar IA ni servicios externos', async () => {
  const create = vi.spyOn(flowsApi, 'flowsCreate').mockResolvedValue({ flow: { id: 'example' } } as Awaited<ReturnType<typeof flowsApi.flowsCreate>>);
  const providers = vi.spyOn(aiProvidersApi, 'aiProvidersList');
  const open = vi.fn();
  render(<FlowList onOpen={open} onRun={vi.fn()} onShowRuns={vi.fn()} refreshKey={0} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Probar un ejemplo local' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('example'));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ graph: expect.objectContaining({ nodes: expect.arrayContaining([
    expect.objectContaining({ kind: 'trigger', config: { trigger_kind: 'manual' } }),
    expect.objectContaining({ kind: 'tool_call', config: { method: 'formats' } }),
  ]) }) }));
  expect(providers).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledWith('example');
});

it('explica los requisitos de las plantillas antes de crearlas', async () => {
  render(<FlowList onOpen={vi.fn()} onRun={vi.fn()} onShowRuns={vi.fn()} refreshKey={0} />);
  fireEvent.click(screen.getByRole('button', { name: 'Plantillas' }));
  expect(await screen.findAllByText('Requiere configurar un proveedor IA.')).toHaveLength(2);
  expect(screen.getByText('Requiere sustituir la dirección de ejemplo. Se ejecuta con Antares abierto.')).toBeVisible();
});

it('presenta texto sin JSON y mantiene los detalles técnicos disponibles', () => {
  render(<StepOutput value={{ text: 'Informe listo para revisar', usage: { total: 10 } }} />);
  expect(screen.getByText('Informe listo para revisar', { exact: true })).toBeVisible();
  expect(screen.getByText('Ver datos técnicos')).toBeVisible();
  expect(screen.getByText(/"usage"/)).not.toBeVisible();
});

it('identifica el flujo que se eliminará y conserva la decisión original', async () => {
  vi.spyOn(flowsApi, 'flowsGet').mockResolvedValue({ flow: { id: 'flow-123', name: 'Informe semanal' } } as Awaited<ReturnType<typeof flowsApi.flowsGet>>);
  const decide = vi.fn();
  render(<ApprovalCard approval={{ id: 'approval', session_id: 'session', call_id: 'call', method: 'flows_delete', params: { id: 'flow-123' }, status: 'pending', created_at: 0, decided_at: null }} busy={false} onDecide={decide} />);
  expect(screen.getByText('Eliminar un flujo y sus ejecuciones')).toBeVisible();
  expect(await screen.findByText('Informe semanal')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
  expect(decide).toHaveBeenCalledWith('approval', true);
});

it('guía la conexión de una cuenta y conserva el guardado de credenciales', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const provider = { id: 'demo', provider: 'demo', label: 'Servicio', description: 'Cuenta de prueba', docs: 'https://example.com', auth_type: 'oauth_secret' as const, requires_client_secret: true, scopes: [], redirect_hint: 'http://localhost:8765/callback', configured: false, connected: false };
  render(<ConnectionDetail provider={provider} connecting={false} onConnect={vi.fn()} onDisconnect={vi.fn()} onSaveCreds={save} onClose={vi.fn()} />);
  expect(screen.getByText('1. Prepara la conexión')).toBeVisible();
  expect(screen.getByText('2. Registra la dirección de retorno')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Client ID de Servicio'), { target: { value: 'client' } });
  fireEvent.change(screen.getByLabelText('Client Secret de Servicio'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar credenciales' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(provider, { clientId: 'client', clientSecret: 'secret' }));
});

it('abre la página para obtener la clave IA sin exponerla en el enlace', async () => {
  vi.spyOn(aiProvidersApi, 'aiProvidersList').mockResolvedValue({ providers: [{ id: 'demo', provider: 'demo', label: 'IA de prueba', description: 'Servicio IA', docs: 'https://example.com/keys', editable_base_url: false, default_base_url: 'https://example.com/api', base_url: 'https://example.com/api', default_model: 'demo', configured: false, has_key: false, key_masked: null, needs_key: true }] });
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  render(<ProvidersView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Obtener clave de IA de prueba' }));
  expect(open).toHaveBeenCalledWith('https://example.com/keys', '_blank');
});

it('permite comparar con Sí o No sin escribir booleanos en inglés', () => {
  const changed = vi.fn();
  function Condition() {
    const [node, setNode] = useState<FlowNode>({ id: 'condition', name: 'Comparar', kind: 'condition', config: { value: true }, position: { x: 0, y: 0 } });
    return <NodeConfigDrawer node={node} onChange={(next) => { changed(next); setNode(next); }} onDelete={vi.fn()} onClose={vi.fn()} />;
  }
  render(<Condition />);
  fireEvent.click(screen.getByLabelText('Valor de value'));
  fireEvent.click(screen.getByRole('option', { name: 'No' }));
  expect(changed.mock.lastCall?.[0].config.value).toBe(false);
});

it('permite guardar el servicio local con su dirección predeterminada', async () => {
  const provider = { id: 'local', provider: 'local', label: 'IA local', description: 'Servicio local', docs: '', editable_base_url: true, default_base_url: 'http://localhost:11434', base_url: 'http://localhost:11434', default_model: 'demo', configured: false, has_key: false, key_masked: null, needs_key: false };
  vi.spyOn(aiProvidersApi, 'aiProvidersList').mockResolvedValue({ providers: [provider] });
  const save = vi.spyOn(aiProvidersApi, 'aiProviderSave').mockResolvedValue({ provider });
  render(<ProvidersView />);
  fireEvent.click(await screen.findByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ provider: 'local', api_key: undefined, base_url: 'http://localhost:11434', model: 'demo' }));
});
