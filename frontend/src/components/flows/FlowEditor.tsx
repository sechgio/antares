import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { ArrowLeft, Bot, LayoutGrid, Play, Redo2, Save, Undo2 } from 'lucide-react';
import { flowsApi } from '../../api/flowsApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import { useDialog } from '../../hooks/useDialog';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Toggle from '../ui/Toggle';
import FlowNodeView from './FlowNodeView';
import EmptyCanvasHint from './EmptyCanvasHint';
import NodeConfigDrawer from './NodeConfigDrawer';
import NodePalette, { NODE_DRAG_MIME } from './NodePalette';
import { FLOW_EDGE_STYLE, edgeConnectionValid, graphToReactFlow, makeNodeId, reactFlowToGraph, reconnectEdge, type FlowNodeData } from './graphAdapter';
import { layoutByDepth } from './flowLayout';
import { useFlowHistory } from './useFlowHistory';
import { NODE_KIND_DEFS, nodeOutputs } from './nodeDefs';
import type { Flow, FlowNode, FlowNodeKind, WorkflowGraph } from './types';

const nodeTypes = { flowNode: FlowNodeView };

interface Props {
  flowId: string;
  onBack: () => void;
  onRunStarted: () => void;
  onAskAgent?: (flowName: string) => void;
  active?: boolean;
  registerLeaveGuard?: (guard: (() => Promise<boolean>) | null) => void;
}

function FlowEditorInner({ flowId, onBack, onRunStarted, onAskAgent, active = true, registerLeaveGuard }: Props) {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const { screenToFlowPosition } = useReactFlow();
  const [flow, setFlow] = useState<Flow | null>(null);
  const [baseGraph, setBaseGraph] = useState<WorkflowGraph | null>(null);
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  // Guardado imperativo (Ctrl+S) necesita el grafo más reciente aunque React
  // aún no haya renderizado la edición en curso.
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const nodeDragRef = useRef(false);
  const setNodesTracked = useCallback((next: SetStateAction<Node<FlowNodeData>[]>) => {
    const resolved = typeof next === 'function' ? next(nodesRef.current) : next;
    nodesRef.current = resolved;
    setNodes(resolved);
  }, []);
  const setEdgesTracked = useCallback((next: SetStateAction<Edge[]>) => {
    const resolved = typeof next === 'function' ? next(edgesRef.current) : next;
    edgesRef.current = resolved;
    setEdges(resolved);
  }, []);
  const {
    push: pushHistory,
    undo,
    redo,
    size: historySize,
  } = useFlowHistory(nodes, edges, setNodesTracked, setEdgesTracked, () => {
    setSelectedId(null);
    setDirty(true);
  });

  useEffect(() => {
    let alive = true;
    flowsApi
      .flowsGet(flowId)
      .then((res) => {
        if (!alive) return;
        setFlow(res.flow);
        setBaseGraph(res.flow.graph);
        setNameDraft(res.flow.name);
        const { nodes: n, edges: e } = graphToReactFlow(res.flow.graph);
        setNodesTracked(n.map((node) => ({ ...node, deletable: node.data.flowNode.kind !== 'trigger' })));
        setEdgesTracked(e);
        setDirty(false);
      })
      .catch((err) =>
        addToast({ message: errorMessage(err, 'No se pudo cargar el flujo'), type: 'error' }),
      );
    return () => {
      alive = false;
    };
  }, [flowId, addToast]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<FlowNodeData>>[]) => {
      const startsDrag = changes.some((c) => c.type === 'position' && c.dragging === true);
      const endsDrag = changes.some((c) => c.type === 'position' && c.dragging === false);
      const structural = changes.some((c) => c.type === 'remove' || c.type === 'add');
      // Una entrada por arrastre: la instantánea se toma antes del primer
      // cambio de posición del gesto, no al soltar el nodo.
      if (structural || (!nodeDragRef.current && (startsDrag || endsDrag))) pushHistory();
      if (startsDrag) nodeDragRef.current = true;
      if (endsDrag) nodeDragRef.current = false;
      setNodesTracked((ns) => applyNodeChanges(changes, ns));
      if (changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')) setDirty(true);
    },
    [pushHistory],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (changes.some((c) => c.type === 'remove' || c.type === 'add')) pushHistory();
      setEdgesTracked((es) => applyEdgeChanges(changes, es));
      if (changes.some((c) => c.type !== 'select')) setDirty(true);
    },
    [pushHistory],
  );

  const isValidConnection = useCallback(
    (conn: Connection | Edge) => edgeConnectionValid(conn, edgesRef.current, nodesRef.current),
    [],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!isValidConnection(conn)) return;
      pushHistory();
      setEdgesTracked((es) =>
        addEdge(
          {
            ...conn,
            id: `${conn.source}:${conn.sourceHandle ?? 'main'}->${conn.target}:${conn.targetHandle ?? 'main'}`,
            style: { ...FLOW_EDGE_STYLE },
          },
          es,
        ),
      );
      setDirty(true);
    },
    [isValidConnection],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, conn: Connection) => {
      const next = reconnectEdge(oldEdge, conn, edgesRef.current, nodesRef.current);
      if (!next) return;
      pushHistory();
      setEdgesTracked(next);
      setDirty(true);
    },
    [pushHistory],
  );

  const changeSelection = useCallback((id: string | null) => {
    const invalid = editorRef.current?.querySelector<HTMLTextAreaElement>('textarea:invalid');
    if (invalid) {
      addToast({ message: 'Corrige el campo marcado antes de cerrar su configuración.', type: 'error' });
      invalid.closest('details')?.setAttribute('open', '');
      invalid.focus();
      return false;
    }
    const field = document.activeElement;
    if (field instanceof HTMLTextAreaElement && editorRef.current?.contains(field)) field.blur();
    setSelectedId(id);
    return true;
  }, [addToast]);

  const addNode = useCallback(
    (kind: FlowNodeKind, position: { x: number; y: number }) => {
      const id = makeNodeId(kind, nodesRef.current.map((n) => n.id));
      if (!changeSelection(id)) return;
      pushHistory();
      const flowNode: FlowNode = {
        id,
        kind,
        name: NODE_KIND_DEFS[kind].label,
        config: {},
        position,
      };
      setNodesTracked((ns) => [
        ...ns,
        { id, type: 'flowNode', position, data: { flowNode }, selected: false } as Node<FlowNodeData>,
      ]);
      setDirty(true);
    },
    [pushHistory, changeSelection],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData(NODE_DRAG_MIME) as FlowNodeKind | '';
      if (!kind || !NODE_KIND_DEFS[kind]?.implemented) return;
      addNode(kind, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [addNode, screenToFlowPosition],
  );

  const addNodeAtCenter = useCallback(
    (kind: FlowNodeKind) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      const center = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: 0, y: 0 };
      addNode(kind, screenToFlowPosition(center));
    },
    [addNode, screenToFlowPosition],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const selectedNode = useMemo(() => {
    if (!selectedId) return null;
    return nodes.find((n) => n.id === selectedId)?.data.flowNode ?? null;
  }, [selectedId, nodes]);

  const dataSources = useMemo(() => {
    if (!selectedId) return [];
    const upstream = new Set<string>();
    const visit = (id: string) => {
      for (const edge of edges.filter((e) => e.target === id)) {
        if (upstream.has(edge.source)) continue;
        upstream.add(edge.source);
        visit(edge.source);
      }
    };
    visit(selectedId);
    return nodes.filter((n) => upstream.has(n.id)).flatMap(({ id, data }) => {
      const n = data.flowNode;
      const fields = n.kind === 'agent' ? ['text'] : n.kind === 'http_request' ? ['ok', 'status', 'text', 'json']
        : n.kind === 'transform' && n.config.output && typeof n.config.output === 'object' ? Object.keys(n.config.output)
        : n.kind === 'tool_call' ? ({ formats: ['formats'], canvas_get: ['document'],
          flows_read_images: ['contexts', 'files', 'image_names', 'image_paths', 'localImagePaths', 'rows', 'key_column', 'output_path', 'stamped_output_path', 'output_folder'],
          panel_aviso_corte_compute_match: ['panels', 'summary'],
          technical_reports_render_html: ['html', 'filename'], informes_v2_render_html: ['html', 'filename'], fichas_tecnicas_render_html: ['html', 'filename'],
          flows_render_pdf: ['saved_path', 'filename'], canvas_export_cmyk_pdf: ['saved_path', 'filename'],
          sellador_apply: ['saved_path', 'filename'], formatos_generate: ['saved_path', 'filename'],
          flows_print_pdf: ['queued', 'job_id', 'printer_name'],
        } as Record<string, string[]>)[String(n.config.method)] ?? [] : [];
      return [{ value: `=nodes.${id}.json`, label: `Todos los datos de ${n.name}` },
        ...fields.filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)).map((key) => ({
          value: `=nodes.${id}.json.${key}`, label: `${n.name}: ${({ text: 'Texto', formats: 'Formatos', document: 'Plantilla', contexts: 'Datos e imágenes de los paneles', files: 'Archivos', image_names: 'Nombres de las imágenes', image_paths: 'Archivos de las imágenes', localImagePaths: 'Archivos de las imágenes para Canvas', rows: 'Filas del Excel', key_column: 'Columna ID', output_path: 'Archivo de salida', stamped_output_path: 'Archivo sellado de salida', output_folder: 'Carpeta de salida', panels: 'Paneles preparados', saved_path: 'Archivo guardado', html: 'Contenido del documento', filename: 'Nombre del archivo', queued: 'Enviado a impresión', job_id: 'Trabajo de impresión', printer_name: 'Impresora' } as Record<string, string>)[key] ?? key}`,
        }))];
    });
  }, [selectedId, nodes, edges]);

  const updateNode = useCallback(
    (updated: FlowNode) => {
      const prev = nodesRef.current.find((n) => n.id === updated.id)?.data.flowNode;
      if (prev && JSON.stringify(prev.config) !== JSON.stringify(updated.config)) pushHistory();
      setNodesTracked((ns) =>
        ns.map((n) =>
          n.id === updated.id ? { ...n, data: { ...n.data, flowNode: updated } } : n,
        ),
      );
      // Un cambio de config puede retirar puertos (p. ej. casos de switch):
      // las aristas que salían de esos puertos quedan huérfanas y se podan.
      const ports = new Set(nodeOutputs(updated).map((o) => o.port));
      setEdgesTracked((es) => {
        const kept = es.filter((e) => e.source !== updated.id || ports.has(e.sourceHandle ?? 'main'));
        return kept.length === es.length ? es : kept;
      });
      setDirty(true);
    },
    [pushHistory],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (!node || node.data.flowNode.kind === 'trigger') return;
      pushHistory();
      setNodesTracked((ns) => ns.filter((n) => n.id !== nodeId));
      setEdgesTracked((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedId(null);
      setDirty(true);
    },
    [pushHistory],
  );

  const autoLayout = useCallback(() => {
    if (!nodesRef.current.length) return;
    pushHistory();
    const positions = layoutByDepth(nodesRef.current, edgesRef.current);
    setNodesTracked((ns) =>
      ns.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })),
    );
    setDirty(true);
  }, [pushHistory]);

  const save = useCallback(async () => {
    if (!flow || !baseGraph) return;
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement && canvasRef.current?.parentElement?.contains(active)) {
      active.blur();
    }
    const invalid = editorRef.current?.querySelector<HTMLTextAreaElement>('textarea:invalid');
    if (invalid) {
      addToast({ message: 'No se guardó el flujo. Corrige el campo marcado antes de continuar.', type: 'error' });
      invalid.closest('details')?.setAttribute('open', '');
      invalid.focus();
      return false;
    }
    setSaving(true);
    try {
      const sentNodes = nodesRef.current;
      const sentEdges = edgesRef.current;
      const graph = reactFlowToGraph(sentNodes, sentEdges, baseGraph);
      const res = await flowsApi.flowsUpdate({
        id: flow.id,
        graph,
        expected_updated_at: flow.updated_at,
      });
      setFlow(res.flow);
      setBaseGraph(res.flow.graph);
      // Una edición durante el guardado sustituye los arrays: sigue sin guardar.
      setDirty(nodesRef.current !== sentNodes || edgesRef.current !== sentEdges);
      addToast({ message: 'Flujo guardado', type: 'success' });
      return nodesRef.current === sentNodes && edgesRef.current === sentEdges;
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo guardar el flujo'), type: 'error' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [flow, baseGraph, addToast]);

  const prepareLeave = useCallback(async () => {
    const field = document.activeElement;
    if (field instanceof HTMLTextAreaElement && editorRef.current?.contains(field)) field.blur();
    if (editorRef.current?.querySelector('textarea:invalid')) {
      await save();
      return false;
    }
    if (!dirty) return true;
    const accepted = await confirm({
      title: 'Guardar cambios antes de salir',
      description: 'Tu flujo tiene cambios pendientes. Puedes guardarlos y continuar o seguir editando.',
      confirmLabel: 'Guardar y continuar',
      cancelLabel: 'Seguir editando',
    });
    return accepted && await save() === true;
  }, [dirty, confirm, save]);

  useEffect(() => {
    registerLeaveGuard?.(prepareLeave);
    return () => registerLeaveGuard?.(null);
  }, [registerLeaveGuard, prepareLeave]);

  const rename = useCallback(
    async (name: string) => {
      if (!flow) return;
      const trimmed = name.trim();
      if (!trimmed || trimmed === flow.name) return;
      try {
        const res = await flowsApi.flowsUpdate({
          id: flow.id,
          name: trimmed,
          expected_updated_at: flow.updated_at,
        });
        setFlow(res.flow);
        setBaseGraph(res.flow.graph);
        setNameDraft(res.flow.name);
      } catch (err) {
        addToast({ message: errorMessage(err, 'No se pudo renombrar'), type: 'error' });
      }
    },
    [flow, addToast],
  );

  const toggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (!flow) return;
      try {
        const res = await flowsApi.flowsUpdate({
          id: flow.id,
          enabled,
          expected_updated_at: flow.updated_at,
        });
        setFlow(res.flow);
        setBaseGraph(res.flow.graph);
      } catch (err) {
        addToast({ message: errorMessage(err, 'No se pudo actualizar el estado'), type: 'error' });
      }
    },
    [flow, addToast],
  );

  const run = useCallback(async () => {
    if (!flow) return;
    if (dirty) {
      addToast({ message: 'Guarda el flujo antes de ejecutarlo (Ctrl+S)', type: 'info' });
      return;
    }
    setRunning(true);
    try {
      await flowsApi.flowsRun(flow.id);
      addToast({ message: 'Ejecución iniciada', type: 'success' });
      onRunStarted();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo ejecutar'), type: 'error' });
    } finally {
      setRunning(false);
    }
  }, [flow, dirty, addToast, onRunStarted]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
      if (e.key === 'Escape') changeSelection(null);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, undo, redo, active, changeSelection]);

  return (
    <div ref={editorRef} className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border-medium)] px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={() => void prepareLeave().then((ok) => { if (ok) onBack(); })} aria-label="Volver">
          <ArrowLeft size={16} />
        </Button>
        <Input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={(e) => {
            if (e.target.value.trim()) void rename(e.target.value);
            else setNameDraft(flow?.name ?? '');
          }}
          className="w-56 text-sm font-semibold"
          placeholder="Nombre del flujo"
        />
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={undo}
          disabled={historySize.past === 0}
          aria-label="Deshacer"
          title="Deshacer (Ctrl+Z)"
        >
          <Undo2 size={15} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={redo}
          disabled={historySize.future === 0}
          aria-label="Rehacer"
          title="Rehacer (Ctrl+Mayús+Z)"
        >
          <Redo2 size={15} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={autoLayout}
          aria-label="Organizar nodos"
          title="Organizar nodos por niveles"
        >
          <LayoutGrid size={15} />
        </Button>
        {onAskAgent && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void prepareLeave().then((ok) => { if (ok) onAskAgent(flow?.name ?? ''); })}
            aria-label="Pedir ayuda a IA"
            title="Pide al agente que revise este flujo"
          >
            <Bot size={15} />
          </Button>
        )}
        {flow && (
          <label
            className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]"
            title="Cuando está activo, un disparador Programado puede ejecutarlo solo"
          >
            <Toggle
              checked={flow.enabled}
              onChange={toggleEnabled}
              id="flow-enabled"
              aria-label="Flujo activo"
            />
            Activo
          </label>
        )}
        {dirty && (
          <span className="text-[11px] text-[var(--text-secondary)]">Cambios sin guardar</span>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void save()}
          disabled={!dirty || saving}
        >
          <Save size={14} className="mr-1" />
          {saving ? 'Guardando…' : 'Guardar'}
        </Button>
        <Button variant="primary" size="sm" onClick={() => void run()} disabled={running || !flow}>
          <Play size={14} className="mr-1" />
          Ejecutar
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <NodePalette onAdd={addNodeAtCenter} />
        <div ref={canvasRef} className="relative flex-1" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            reconnectRadius={14}
            connectionLineStyle={{ ...FLOW_EDGE_STYLE }}
            isValidConnection={isValidConnection}
            onNodeClick={(_, node) => changeSelection(node.id)}
            onPaneClick={() => changeSelection(null)}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background gap={16} size={1} color="var(--border-medium)" />
            <Background gap={16} size={1} offset={8} color="var(--border-medium)" />
            <Controls position="bottom-left" />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              className="!bg-[var(--bg-elevated)]"
              nodeColor="var(--border-medium)"
              maskColor="rgba(0, 0, 0, 0.45)"
            />
          </ReactFlow>
          {flow && nodes.length === 0 && <EmptyCanvasHint />}
        </div>
        <NodeConfigDrawer
          key={selectedId ?? 'none'}
          node={selectedNode}
          onChange={updateNode}
          onDelete={deleteNode}
          onClose={() => changeSelection(null)}
          onDraftChange={() => setDirty(true)}
          sources={dataSources}
        />
      </div>
    </div>
  );
}

export default function FlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
