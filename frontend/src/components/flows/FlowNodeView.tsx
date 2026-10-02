import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { memo } from 'react';
import { NODE_KIND_DEFS } from './nodeDefs';
import type { FlowNodeData } from './graphAdapter';

type FlowNodeType = Node<FlowNodeData, 'flowNode'>;

function nodeSubtitle(data: FlowNodeData): string {
  const { kind, config } = data.flowNode;
  if (kind === 'trigger') {
    return config.trigger_kind === 'manual' ? 'Manual' : String(config.trigger_kind ?? 'Manual');
  }
  if (kind === 'tool_call') {
    return typeof config.method === 'string' && config.method ? config.method : 'Sin método';
  }
  if (kind === 'condition') {
    return 'Condición';
  }
  if (kind === 'transform') {
    return 'Transformación';
  }
  return '';
}

function FlowNodeView({ data, selected }: NodeProps<FlowNodeType>) {
  const def = NODE_KIND_DEFS[data.flowNode.kind];
  const subtitle = nodeSubtitle(data);
  return (
    <div
      className={`rounded-lg border bg-[var(--bg-elevated)] px-3 py-2 shadow-md transition-shadow ${
        selected ? 'border-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]' : 'border-[var(--border-medium)]'
      }`}
      style={{ minWidth: 168, maxWidth: 220 }}
    >
      {def.inputs.length > 0 && (
        <Handle
          type="target"
          position={Position.Left}
          id="main"
          style={{ background: 'var(--text-secondary)', width: 8, height: 8 }}
        />
      )}
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: def.accent }}
        />
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
            {data.flowNode.name}
          </div>
          <div className="truncate text-[10px] text-[var(--text-secondary)]">
            {def.label}
            {subtitle ? ` · ${subtitle}` : ''}
          </div>
        </div>
      </div>
      {def.outputs.map((out, i) => (
        <Handle
          key={out.port}
          type="source"
          position={Position.Right}
          id={out.port}
          style={{
            background: def.accent,
            width: 8,
            height: 8,
            top: def.outputs.length === 1 ? '50%' : `${30 + i * 24}%`,
          }}
        />
      ))}
      {def.outputs.length > 1 && (
        <div className="mt-1 flex flex-col items-end gap-0.5 text-[9px] uppercase tracking-wide text-[var(--text-secondary)]">
          {def.outputs.map((out) => (
            <span key={out.port}>{out.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(FlowNodeView);
