import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { memo } from 'react';
import { NODE_KIND_DEFS, nodeOutputs } from './nodeDefs';
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
  if (kind === 'http_request') {
    const url = typeof config.url === 'string' ? config.url : '';
    return url ? `${String(config.method ?? 'GET')} ${url.slice(0, 40)}` : 'Sin URL';
  }
  if (kind === 'agent') {
    const model = typeof config.model === 'string' && config.model ? config.model : '';
    const provider = typeof config.provider === 'string' ? config.provider : '';
    return provider ? `${provider}${model ? ` · ${model}` : ''}` : 'Sin proveedor';
  }
  if (kind === 'switch') {
    const cases = Array.isArray(config.cases) ? config.cases.length : 0;
    return cases ? `${cases} casos` : 'Sin casos';
  }
  if (kind === 'mcp_call') {
    const server = typeof config.server === 'string' ? config.server : '';
    const tool = typeof config.tool === 'string' ? config.tool : '';
    return server ? `${server}/${tool || '…'}` : 'Sin servidor';
  }
  return '';
}

const STEP_STATUS_COLORS: Record<string, string> = {
  running: '#38bdf8',
  success: '#34d399',
  error: 'var(--accent-red, #ef4444)',
  skipped: 'var(--text-secondary)',
  cancelled: 'var(--text-secondary)',
};

function FlowNodeView({ data, selected }: NodeProps<FlowNodeType>) {
  const def = NODE_KIND_DEFS[data.flowNode.kind];
  const outputs = nodeOutputs(data.flowNode);
  const subtitle = nodeSubtitle(data);
  const stepColor = data.stepStatus ? STEP_STATUS_COLORS[data.stepStatus] : undefined;
  return (
    <div
      className={`rounded-lg border bg-[var(--bg-elevated)] px-3 py-2 shadow-md transition-shadow ${
        selected ? 'border-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]' : 'border-[var(--border-medium)]'
      }`}
      style={{
        minWidth: 168,
        maxWidth: 220,
        ...(stepColor ? { borderColor: stepColor, boxShadow: `0 0 0 1px ${stepColor}` } : {}),
      }}
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
      {outputs.map((out, i) => (
        <Handle
          key={out.port}
          type="source"
          position={Position.Right}
          id={out.port}
          style={{
            background: def.accent,
            width: 8,
            height: 8,
            top: outputs.length === 1 ? '50%' : `${30 + i * 24}%`,
          }}
        />
      ))}
      {outputs.length > 1 && (
        <div className="mt-1 flex flex-col items-end gap-0.5 text-[9px] uppercase tracking-wide text-[var(--text-secondary)]">
          {outputs.map((out) => (
            <span key={out.port}>{out.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(FlowNodeView);
