import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { memo, useState } from 'react';
import {
  Bell,
  Bot,
  Braces,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  GitFork,
  Globe,
  Info,
  KeyRound,
  MessageSquare,
  MousePointerClick,
  Plug,
  Repeat,
  RotateCcw,
  Shuffle,
  Split,
  Webhook,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { CONDITION_OPS, METHOD_LABELS, NODE_KIND_DEFS, nodeOutputs } from './nodeDefs';
import type { FlowNodeData } from './graphAdapter';
import type { FlowNode } from './types';

type FlowNodeType = Node<FlowNodeData, 'flowNode'>;

interface SummaryRow {
  icon: LucideIcon;
  text: string;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function entryCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

function summaryRows(flowNode: FlowNode): SummaryRow[] {
  const { kind, config } = flowNode;
  switch (kind) {
    case 'trigger': {
      const triggerKind = str(config.trigger_kind) || 'manual';
      if (triggerKind === 'schedule') {
        const minutes = Number(config.interval_minutes ?? 60);
        return [
          { icon: Clock, text: `Cada ${Number.isFinite(minutes) ? minutes : 60} min` },
          { icon: Info, text: 'Con la app abierta' },
        ];
      }
      if (triggerKind === 'app_event') {
        return [{ icon: Bell, text: 'Evento de la app · próximamente' }];
      }
      if (triggerKind === 'webhook') {
        return [{ icon: Webhook, text: 'Webhook · próximamente' }];
      }
      return [{ icon: MousePointerClick, text: 'Disparo manual' }];
    }
    case 'tool_call': {
      const rows: SummaryRow[] = [
        { icon: Wrench, text: METHOD_LABELS[str(config.method)] ?? (str(config.method) || 'Elige una acción') },
      ];
      const args = entryCount(config.args);
      if (args) rows.push({ icon: Braces, text: `${args} argumento${args === 1 ? '' : 's'}` });
      if (config.method === 'flows_read_images') rows.push({ icon: Clock, text: 'Espera imágenes completas · evita repetir el lote' });
      return rows;
    }
    case 'condition': {
      const op = CONDITION_OPS.find((o) => o.value === str(config.op))?.label ?? str(config.op);
      const field = str(config.field) || 'campo';
      const value = config.value == null ? '' : ` ${String(config.value)}`;
      return [{ icon: GitFork, text: `${field} ${op}${value}`.trim() }];
    }
    case 'transform': {
      const keys = config.output && typeof config.output === 'object' && !Array.isArray(config.output)
        ? Object.keys(config.output)
        : [];
      if (!keys.length) return [{ icon: Shuffle, text: 'Sin salida' }];
      const preview = keys.slice(0, 3).join(', ');
      return [
        {
          icon: Shuffle,
          text: `${keys.length} campo${keys.length === 1 ? '' : 's'}: ${preview}${keys.length > 3 ? '…' : ''}`,
        },
      ];
    }
    case 'http_request': {
      const rows: SummaryRow[] = [
        {
          icon: Globe,
          text: `${str(config.method) || 'GET'} ${str(config.url) || 'Sin URL'}`,
        },
      ];
      const conn = str(config.connection_ref);
      if (conn) rows.push({ icon: KeyRound, text: `Firma: ${conn}` });
      return rows;
    }
    case 'agent': {
      const provider = str(config.provider);
      const model = str(config.model);
      const rows: SummaryRow[] = [
        {
          icon: Bot,
          text: provider ? `${provider}${model ? ` · ${model}` : ''}` : 'Sin proveedor',
        },
      ];
      const prompt = str(config.prompt).split('\n')[0];
      if (prompt) rows.push({ icon: MessageSquare, text: prompt });
      return rows;
    }
    case 'switch': {
      const cases = Array.isArray(config.cases) ? config.cases.length : 0;
      return [
        {
          icon: Split,
          text: cases ? `${cases} caso${cases === 1 ? '' : 's'} + Defecto` : 'Sin casos',
        },
      ];
    }
    case 'mcp_call': {
      const server = str(config.server);
      const tool = str(config.tool);
      return [{ icon: Plug, text: server ? `${server}/${tool || '…'}` : 'Sin servidor' }];
    }
    case 'loop':
      return [{ icon: Repeat, text: 'Bucle' }];
    case 'code':
      return [{ icon: Code2, text: 'Código' }];
    default:
      return [];
  }
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
  const stepColor = data.stepStatus ? STEP_STATUS_COLORS[data.stepStatus] : undefined;
  const [expanded, setExpanded] = useState(true);
  const rows = summaryRows(data.flowNode);
  const retry = data.flowNode.config.retry as { attempts?: number } | undefined;
  if (retry) {
    rows.push({ icon: RotateCcw, text: `Reintenta ${retry.attempts ?? 1}×` });
  }
  const KindIcon = def.icon;

  return (
    <div
      className={`w-[224px] rounded-xl border bg-[var(--bg-elevated)] shadow-md transition-shadow ${
        selected
          ? 'border-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]'
          : 'border-[var(--border-medium)]'
      }`}
      style={
        stepColor ? { borderColor: stepColor, boxShadow: `0 0 0 1px ${stepColor}` } : undefined
      }
    >
      {def.inputs.length > 0 && (
        <Handle
          type="target"
          position={Position.Left}
          id="main"
          style={{ background: 'var(--text-secondary)', width: 7, height: 7 }}
        />
      )}
      <div className="flex items-center gap-1.5 px-2.5 py-2.5">
        <button
          type="button"
          className="nodrag -ml-1 shrink-0 rounded p-0.5 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={expanded ? 'Contraer nodo' : 'Expandir nodo'}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          style={{
            background: `color-mix(in srgb, ${def.accent} 16%, transparent)`,
            color: def.accent,
          }}
        >
          <KindIcon size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
            {data.flowNode.name}
          </div>
          <div className="truncate text-[10px] text-[var(--text-secondary)]">{def.label}</div>
        </div>
        {!def.implemented && (
          <span className="shrink-0 rounded-[6px] border border-[var(--border-medium)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--text-secondary)]">
            Pronto
          </span>
        )}
        {stepColor && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: stepColor }}
            title={data.stepStatus}
          />
        )}
      </div>
      {expanded && rows.length > 0 && (
        <div className="flex flex-col gap-1 px-2.5 pb-2.5">
          {rows.map((row, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md border border-[var(--border-medium)] bg-[var(--bg-base)] px-2 py-1.5"
            >
              <row.icon size={11} className="shrink-0 text-[var(--text-secondary)]" />
              <span className="truncate font-mono text-[10.5px] text-[var(--text-secondary)]">
                {row.text}
              </span>
            </div>
          ))}
        </div>
      )}
      {outputs.map((out, i) => (
        <Handle
          key={out.port}
          type="source"
          position={Position.Right}
          id={out.port}
          style={{
            background: def.accent,
            width: 7,
            height: 7,
            top: outputs.length === 1 ? '50%' : `${32 + i * 26}%`,
          }}
        />
      ))}
      {outputs.length > 1 && (
        <div className="flex flex-col items-end gap-0.5 px-2.5 pb-2 text-[9px] uppercase tracking-wide text-[var(--text-secondary)]">
          {outputs.map((out) => (
            <span key={out.port}>{out.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(FlowNodeView);
