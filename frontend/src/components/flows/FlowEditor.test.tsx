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

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
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
  vi.spyOn(flowsApi, 'flowsOrchestratableMethods').mockResolvedValue({ methods: [] });
  vi.spyOn(connectionsApi, 'connectionsProviders').mockResolvedValue({ providers: [] });
  vi.spyOn(aiProvidersApi, 'aiProvidersList').mockResolvedValue({ providers: [] });
  vi.spyOn(mcpApi, 'mcpServersList').mockResolvedValue({ servers: [] });
});

describe('guardado del borrador activo', () => {
  it.each([
    ['transform', '{\n  "nombre": "=item.json.name",\n  "total": 0\n}', 'output', '{"total":10}', { total: 10 }],
    ['tool_call', '{ "id": "=nodes.trigger.json" }', 'args', '{"id":10}', { id: 10 }],
    ['http_request', '{ "Accept": "application/json" }', 'headers', '{"Accept":"text/plain"}', { Accept: 'text/plain' }],
    ['http_request', '{ "texto": "=nodes.n1.json.title" }', 'body', '{"texto":"nuevo"}', { texto: 'nuevo' }],
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

  it('Ctrl+S conserva el último JSON válido y muestra el error del borrador inválido', async () => {
    const initial = flow('transform', { output: { total: 1 } });
    vi.spyOn(flowsApi, 'flowsGet').mockResolvedValue({ flow: initial });
    const update = vi.spyOn(flowsApi, 'flowsUpdate').mockResolvedValue({ flow: initial });
    render(<FlowEditor flowId="f1" onBack={vi.fn()} onRunStarted={vi.fn()} />);
    fireEvent.click(await screen.findByText('Seleccionar n1'));
    const draft = screen.getByDisplayValue('{\n  "total": 1\n}', { normalizer: (value) => value });
    draft.focus();
    fireEvent.change(draft, { target: { value: '{invalid' } });
    fireEvent.keyDown(draft, { key: 's', ctrlKey: true });
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0].graph?.nodes[0].config.output).toEqual({ total: 1 });
    expect(addToast).toHaveBeenCalledWith({ message: 'Salida: JSON inválido, no se aplicó el cambio', type: 'error' });
  });
});
