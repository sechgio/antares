import { useCallback, useEffect, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { FlowNodeData } from './graphAdapter';

interface Snapshot {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

/**
 * Historial deshacer/rehacer del editor: guarda una instantánea del grafo
 * antes de cada cambio estructural (el llamador invoca `push` justo antes
 * de mutar nodos o aristas).
 */
export function useFlowHistory(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  setNodes: (nodes: Node<FlowNodeData>[]) => void,
  setEdges: (edges: Edge[]) => void,
  onRestore: () => void,
) {
  const pastRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const [size, setSize] = useState({ past: 0, future: 0 });
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  const push = useCallback(() => {
    pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), { nodes: nodesRef.current, edges: edgesRef.current }];
    futureRef.current = [];
    setSize({ past: pastRef.current.length, future: 0 });
  }, []);

  const restore = useCallback(
    (snapshot: Snapshot) => {
      // Los refs solo se sincronizaban por efecto: dos undos en la misma tarea
      // leían el mismo snapshot previo y corrompían la pila de redo.
      nodesRef.current = snapshot.nodes;
      edgesRef.current = snapshot.edges;
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
      onRestore();
      setSize({ past: pastRef.current.length, future: futureRef.current.length });
    },
    [setNodes, setEdges, onRestore],
  );

  const undo = useCallback(() => {
    const past = pastRef.current;
    if (!past.length) return;
    futureRef.current = [...futureRef.current, { nodes: nodesRef.current, edges: edgesRef.current }];
    const prev = past[past.length - 1];
    pastRef.current = past.slice(0, -1);
    restore(prev);
  }, [restore]);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (!future.length) return;
    pastRef.current = [...pastRef.current, { nodes: nodesRef.current, edges: edgesRef.current }];
    const next = future[future.length - 1];
    futureRef.current = future.slice(0, -1);
    restore(next);
  }, [restore]);

  return { push, undo, redo, size };
}
