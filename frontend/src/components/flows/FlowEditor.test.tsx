import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import { flowsApi } from '../../api/flowsApi';
import { connectionsApi } from '../../api/connectionsApi';
import { aiProvidersApi } from '../../api/aiProvidersApi';
import { mcpApi } from '../../api/mcpApi';
import type { FlowNodeData } from './graphAdapter';
import type { Flow, FlowNodeKind } from './types';
import FlowEditor from './FlowEditor';
import { toolsApi } from '../../api/toolsApi';

const { addToast, confirm } = vi.hoisted(() => ({ addToast: vi.fn(), confirm: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../hooks/useDialog', () => ({ useDialog: () => ({ confirm }) }));
vi.mock('@xyflow/react', async (original) => ({
  ...await original<typeof import('@xyflow/react')>(),
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
  useReactFlow: () => ({ screenToFlowPosition: (p: { x: number; y: number }) => p }),
  ReactFlow: ({ nodes, onNodeClick }: {
    nodes: Node<FlowNodeData>[];
    onNodeClick: (event: unknown, node: Node<FlowNodeData>) => void;
  }) => <>{nodes.map((n) => <button key={n.id} onClick={() => onNodeClick(null, n)}>Seleccionar {n.id}</button>)}</>,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
}));

function flow(kind: FlowNodeKind, config: Record<string, unknown> = {}): Flow {
  return {
    id: 'f1', name: 'Prueba', description: '', enabled: false,
    created_at: '2026-10-04', updated_at: '2026-10-04', last_run_at: null, last_run_status: null,
    graph: { nodes: [{ id: 'n1', name: 'Nodo', kind, config, position: { x: 0, y: 0 } }], edges: [] },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  addToast.mockClear();
  confirm.mockReset();
  vi.spyOn(flowsApi, 'flowsOrchestratableMethods').mockResolvedValue({ methods: [] });
  vi.spyOn(connectionsApi, 'connectionsProviders').mockResolvedValue({ providers: [] });
  vi.spyOn(aiProvidersApi, 'aiProvidersList').mockResolvedValue({ providers: [] });
  vi.spyOn(mcpApi, 'mcpServersList').mockResolvedValue({ servers: [] });
});

it('abre la guía de un PDF y guarda sus cambios en el grafo del editor', async () => {
  const initial = flow('tool_call', { method: 'flows_read_images', args: { guided_pdf: true, template_kind: 'html', template_id: 'report.html', output_folder: '' } });
  vi.spyOn(toolsApi, 'templatesList').mockResolvedValue({ templates: [] });
  vi.spyOn(flowsApi, 'flowsGet').mockResolvedValue({ flow: initial });
  const update = vi.spyOn(flowsApi, 'flowsUpdate').mockImplementation(async (params) => ({ flow: { ...initial, graph: params.graph! } }));
  render(<FlowEditor flowId="f1" onBack={vi.fn()} onRunStarted={vi.fn()} />);
  expect(await screen.findByLabelText('Guía de PDF personalizado')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '4. Salida' }));
  fireEvent.change(screen.getByLabelText('Nombre del PDF'), { target: { value: 'Personalizado_{OT}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  expect(update.mock.calls[0][0].graph?.nodes[0].config.args).toMatchObject({ filename_pattern: 'Personalizado_{OT}' });
  fireEvent.click(screen.getByRole('button', { name: 'Editor de nodos' }));
  expect(screen.getByText('Seleccionar n1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Guía de PDF' }));
  expect(screen.getByLabelText('Guía de PDF personalizado')).toBeInTheDocument();
});

it('permite seguir editando al cancelar la salida y guarda antes de volver', async () => {
  const initial = flow('transform', { output: { total: 1 } });
  vi.spyOn(flowsApi, 'flowsGet').mockResolvedValue({ flow: initial });
  const update = vi.spyOn(flowsApi, 'flowsUpdate').mockImplementation(async (p) => ({ flow: { ...initial, graph: p.graph! } }));
  const back = vi.fn();
  confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<FlowEditor flowId="f1" onBack={back} onRunStarted={vi.fn()} />);
  fireEvent.click(await screen.findByText('Seleccionar n1'));
  const draft = screen.getByDisplayValue('{\n  "total": 1\n}', { normalizer: (v) => v });
  draft.focus();
  fireEvent.change(draft, { target: { value: '{"total":2}' } });
  fireEvent.click(screen.getByLabelText('Volver'));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Volver'));
  await waitFor(() => expect(back).toHaveBeenCalledOnce());
  expect(update.mock.calls[0][0].graph?.nodes[0].config.output).toEqual({ total: 2 });
});

it('permite elegir un dato anterior para una condición sin escribir una expresión', async () => {
  const initial = flow('condition', { op: 'gt', value: 5 });
  initial.graph.nodes.unshift({ id: 'datos', name: 'Datos', kind: 'transform', config: { output: { total: 10 } }, position: { x: 0, y: 0 } });
  initial.graph.edges.push({ from_node: 'datos', to_node: 'n1', from_port: 'main', to_port: 'main' });
  vi.spyOn(flowsApi, 'flowsGet').mockResolvedValue({ flow: initial });
  const update = vi.spyOn(flowsApi, 'flowsUpdate').mockImplementation(async (p) => ({ flow: { ...initial, graph: p.graph! } }));
  render(<FlowEditor flowId="f1" onBack={vi.fn()} onRunStarted={vi.fn()} />);
  fireEvent.click(await screen.findByText('Seleccionar n1'));
  fireEvent.click(screen.getByLabelText('Dato a evaluar'));
  fireEvent.click(screen.getByRole('option', { name: 'Datos: total' }));
  fireEvent.click(screen.getByText('Guardar'));
  await waitFor(() => expect(update).toHaveBeenCalled());
  expect(update.mock.calls[0][0].graph?.nodes.find((n) => n.id === 'n1')?.config.field).toBe('=nodes.datos.json.total');
});

describe('guardado del borrador activo', () => {
  it.each([
    ['transform', '{\n  "nombre": "=item.json.name",\n  "total": 0\n}', 'output', '{"total":10}', { total: 10 }],
    ['tool_call', '{ "id": "=nodes.trigger.json" }', 'args', '{"id":10}', { id: 10 }],
    ['http_request', '{ "Accept": "application/json" }', 'headers', '{"Accept":"text/plain"}', { Accept: 'text/plain' }],
    ['http_request', '{ "texto": "=nodes.n1.json.title" }', 'body', '{"texto":"nuevo"}', { texto: 'nuevo' }],
    ['http_request', '{ "texto": "=nodes.n1.json.title" }', 'body', '"Texto sin JSON"', 'Texto sin JSON'],
    ['agent', 'Resume: {{ =nodes.n1.json.text }}', 'prompt', 'Prompt nuevo', 'Prompt nuevo'],
    ['agent', 'Responde en JSON con…', 'system', 'Sistema nuevo', 'Sistema nuevo'],
    ['mcp_call', '{"param": "{{ =item.json.valor }}"}', 'args', '{"param":10}', { param: 10 }],
  ] as const)('Ctrl+S incluye %s.%s sin salir del campo', async (kind, placeholder, key, raw, expected) => {
    const initial = flow(kind);
    vi.spyOn(flowsApi, 'flowsGet').mockResolvedValue({ flow: initial });
    const update = vi.spyOn(flowsApi, 'flowsUpdate').mockImplementation(async (p) => ({
      flow: { ...initial, graph: p.graph ?? initial.graph },
    }));
    render(<FlowEditor flowId="f1" onBack={vi.fn()} onRunStarted={vi.fn()} />);
    fireEvent.click(await screen.findByText('Seleccionar n1'));
    const field = screen.getByPlaceholderText(placeholder, { normalizer: (value) => value });
    field.focus();
    fireEvent.change(field, { target: { value: raw } });
    fireEvent.keyDown(field, { key: 's', ctrlKey: true });
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0].graph?.nodes[0].config[key]).toEqual(expected);
  });

  it('Ctrl+S bloquea el guardado cuando el borrador contiene JSON inválido', async () => {
    const initial = flow('transform', { output: { total: 1 } });
    vi.spyOn(flowsApi, 'flowsGet').mockResolvedValue({ flow: initial });
    const update = vi.spyOn(flowsApi, 'flowsUpdate').mockResolvedValue({ flow: initial });
    render(<FlowEditor flowId="f1" onBack={vi.fn()} onRunStarted={vi.fn()} />);
    fireEvent.click(await screen.findByText('Seleccionar n1'));
    const draft = screen.getByDisplayValue('{\n  "total": 1\n}', { normalizer: (value) => value });
    draft.focus();
    fireEvent.change(draft, { target: { value: '{invalid' } });
    fireEvent.keyDown(draft, { key: 's', ctrlKey: true });
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(update).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalledWith({ message: 'Flujo guardado', type: 'success' });
    expect(draft).toBeInvalid();
    fireEvent.click(screen.getByRole('button', { name: /Acción.*Genera documentos/ }));
    expect(screen.queryByText(/Seleccionar tool_call/)).not.toBeInTheDocument();
    expect(draft).toHaveValue('{invalid');
    fireEvent.change(draft, { target: { value: '{"total":2}' } });
    fireEvent.keyDown(draft, { key: 's', ctrlKey: true });
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0][0].graph?.nodes[0].config.output).toEqual({ total: 2 });
  });
});
