import { Background, Controls, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { useMemo } from 'react';
import '@xyflow/react/dist/style.css';
import FlowNodeView from './FlowNodeView';
import { graphToReactFlow } from './graphAdapter';
import type { FlowRunStep, WorkflowGraph } from './types';

const nodeTypes = { flowNode: FlowNodeView };

interface Props {
  graph: WorkflowGraph;
  steps: FlowRunStep[];
}

function RunGraph({ graph, steps }: Props) {
  const { nodes, edges } = useMemo(() => {
    const statusByNode = new Map(steps.map((s) => [s.node_id, s.status]));
    const rf = graphToReactFlow(graph);
    return {
      nodes: rf.nodes.map((n) => ({
        ...n,
        draggable: false,
        selectable: false,
        data: {
          ...n.data,
          stepStatus: statusByNode.get(n.id),
        },
      })),
      edges: rf.edges,
    };
  }, [graph, steps]);

  return (
    <div className="h-56 rounded-md border border-[var(--border-medium)] bg-[var(--bg-base)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll
        panOnDrag
        fitView
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background gap={16} size={1} color="var(--border-medium)" />
        <Background gap={16} size={1} offset={8} color="var(--border-medium)" />
        <Controls position="bottom-left" showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default function FlowRunGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <RunGraph {...props} />
    </ReactFlowProvider>
  );
}
