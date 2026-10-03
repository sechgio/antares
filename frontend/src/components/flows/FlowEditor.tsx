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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, LayoutGrid, Play, Redo2, Save, Undo2 } from 'lucide-react';
import { flowsApi } from '../../api/flowsApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Toggle from '../ui/Toggle';
import FlowNodeView from './FlowNodeView';
import NodeConfigDrawer from './NodeConfigDrawer';
import NodePalette, { NODE_DRAG_MIME } from './NodePalette';
import { graphToReactFlow, makeNodeId, reactFlowToGraph } from './graphAdapter';
import { createsCycle, layoutByDepth } from './flowLayout';
import { useFlowHistory } from './useFlowHistory';
import { NODE_KIND_DEFS } from './nodeDefs';
import type { Flow, FlowNode, FlowNodeKind, WorkflowGraph } from './types';
import type { FlowNodeData } from './graphAdapter';

const nodeTypes = { flowNode: FlowNodeView };

interface Props {
  flowId: string;
  onBack: () => void;
  onRunStarted: () => void;
}

function FlowEditorInner({ flowId, onBack, onRunStarted }: Props) {
  const { addToast } = useToast();
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
  const {
    push: pushHistory,
    undo,
    redo,
    size: historySize,
  } = useFlowHistory(nodes, edges, setNodes, setEdges, () => {
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
        setNodes(n.map((node) => ({ ...node, deletable: node.data.flowNode.kind !== 'trigger' })));
        setEdges(e);
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
      const structural = changes.some(
        (c) =>
          c.type === 'remove' ||
          c.type === 'add' ||
          (c.type === 'position' && c.dragging === false),
      );
      if (structural) pushHistory();
      setNodes((ns) => applyNodeChanges(changes, ns));
      if (changes.some((c) => c.type !== 'select' && c.type !== 'dimensions')) setDirty(true);
    },
    [pushHistory],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (changes.some((c) => c.type === 'remove' || c.type === 'add')) pushHistory();
      setEdges((es) => applyEdgeChanges(changes, es));
      if (changes.some((c) => c.type !== 'select')) setDirty(true);
    },
    [pushHistory],
  );

  const isValidConnection = useCallback(
    (conn: Connection | Edge) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return false;
      const targetNode = nodes.find((n) => n.id === conn.target);
      const sourceNode = nodes.find((n) => n.id === conn.source);
      if (!targetNode || !sourceNode) return false;
      if (targetNode.data.flowNode.kind === 'trigger') return false;
      if (createsCycle(edges, conn.source, conn.target)) return false;
      return true;
    },
    [nodes, edges],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!isValidConnection(conn)) return;
      pushHistory();
      setEdges((es) =>
        addEdge(
          {
            ...conn,
            id: `${conn.source}:${conn.sourceHandle ?? 'main'}->${conn.target}:${conn.targetHandle ?? 'main'}`,
            type: 'smoothstep',
          },
          es,
        ),
      );
      setDirty(true);
    },
    [isValidConnection],
  );

  const addNode = useCallback(
    (kind: FlowNodeKind, position: { x: number; y: number }) => {
      pushHistory();
      const id = makeNodeId(kind, nodes.map((n) => n.id));
      const flowNode: FlowNode = {
        id,
        kind,
        name: NODE_KIND_DEFS[kind].label,
        config: {},
        position,
      };
      setNodes((ns) => [
        ...ns,
        { id, type: 'flowNode', position, data: { flowNode }, selected: false } as Node<FlowNodeData>,
      ]);
      setDirty(true);
      setSelectedId(id);
    },
    [nodes, pushHistory],
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

  const updateNode = useCallback(
    (updated: FlowNode) => {
      const prev = nodes.find((n) => n.id === updated.id)?.data.flowNode;
      if (prev && JSON.stringify(prev.config) !== JSON.stringify(updated.config)) pushHistory();
      setNodes((ns) =>
        ns.map((n) =>
          n.id === updated.id ? { ...n, data: { ...n.data, flowNode: updated } } : n,
        ),
      );
      setDirty(true);
    },
    [nodes, pushHistory],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node || node.data.flowNode.kind === 'trigger') return;
      pushHistory();
      setNodes((ns) => ns.filter((n) => n.id !== nodeId));
      setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedId(null);
      setDirty(true);
    },
    [nodes, pushHistory],
  );

  const autoLayout = useCallback(() => {
    if (!nodes.length) return;
    pushHistory();
    const positions = layoutByDepth(nodes, edges);
    setNodes((ns) =>
      ns.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })),
    );
    setDirty(true);
  }, [nodes, edges, pushHistory]);

  const save = useCallback(async () => {
    if (!flow || !baseGraph) return;
    setSaving(true);
    try {
      const graph = reactFlowToGraph(nodes, edges, baseGraph);
      const res = await flowsApi.flowsUpdate({
        id: flow.id,
        graph,
        expected_updated_at: flow.updated_at,
      });
      setFlow(res.flow);
      setBaseGraph(res.flow.graph);
      setDirty(false);
      addToast({ message: 'Flujo guardado', type: 'success' });
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo guardar el flujo'), type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [flow, baseGraph, nodes, edges, addToast]);

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
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
      if (e.key === 'Escape') setSelectedId(null);
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
  }, [save, undo, redo]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border-medium)] px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="Volver">
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
            isValidConnection={isValidConnection}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background gap={18} size={1} color="var(--border-medium)" />
            <Controls position="bottom-left" />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              className="!bg-[var(--bg-elevated)]"
            />
          </ReactFlow>
        </div>
        <NodeConfigDrawer
          key={selectedId ?? 'none'}
          node={selectedNode}
          onChange={updateNode}
          onDelete={deleteNode}
          onClose={() => setSelectedId(null)}
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
