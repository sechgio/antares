import { useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Clock3, Copy, Loader2, ShieldCheck, Wrench, X } from 'lucide-react';
import type { AgentApproval, AgentMessage, AgentToolCall } from '../../api/agentApi';
import Button from '../ui/Button';
import Toggle from '../ui/Toggle';
import AgentAvatar from './AgentAvatar';
import MessageMarkdown from './MessageMarkdown';
import Reasoning from './Reasoning';
import SubagentTrace from './SubagentTrace';
import { METHOD_LABELS } from './methodLabels';

export interface AgentIdentity {
  seed: string;
  name: string;
}

const DAY_FORMAT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long' });

export function dayLabel(ts: number, now = Date.now()): string {
  const day = new Date(ts);
  const today = new Date(now);
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(today) - start(day)) / 86_400_000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return DAY_FORMAT.format(day);
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-1" role="separator" aria-label={label}>
      <span className="rounded-full bg-[var(--bg-input)] px-[7px] py-1 text-[13px] font-medium leading-[18px] text-[var(--text-secondary)]">
        {label}
      </span>
    </div>
  );
}

const CALL_STATUS_LABEL: Record<string, string> = {
  queued: 'en cola',
  pending: 'esperando aprobación',
  done: 'ejecutada',
  denied: 'rechazada',
  running: 'ejecutando',
  failed: 'fallida',
  submitted: 'enviada · comprueba el resultado',
  interrupted: 'interrumpida · comprueba el resultado',
};

function CallStatusIcon({ status }: { status: string }) {
  if (status === 'submitted' || status === 'queued') return <Clock3 size={12} className="text-[var(--text-muted)]" />;
  if (status === 'done') return <Check size={12} className="text-[var(--accent-green)]" />;
  if (status === 'denied' || status === 'failed') return <X size={12} className="text-[var(--accent-red)]" />;
  if (status === 'interrupted') return <AlertTriangle size={12} className="text-[var(--accent-yellow)]" />;
  if (status === 'pending') return <ShieldCheck size={12} className="text-[var(--accent-yellow)]" />;
  return <Loader2 size={12} className="animate-spin text-[var(--text-muted)]" />;
}

function ToolCallStep({ call }: { call: AgentToolCall }) {
  if (call.name === 'subagent_run') return <SubagentTrace call={call} />;
  const detail = call.result || null;
  const params = Object.keys(call.params).length > 0 ? JSON.stringify(call.params) : null;
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
          <Wrench size={11} />
        </span>
        <span className="truncate text-[var(--text-primary)]">{METHOD_LABELS[call.name] ?? call.name}</span>
        {call.gated && <ShieldCheck size={12} className="shrink-0 text-[var(--accent-yellow)]" aria-label="Requiere aprobación" />}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-[var(--text-muted)]">
          <CallStatusIcon status={call.status} />
          {CALL_STATUS_LABEL[call.status] ?? call.status}
        </span>
      </div>
      {(params || detail) && (
        <details className="group mt-1.5">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]">
            <ChevronRight size={11} className="transition-transform group-open:rotate-90" />
            {detail ? 'resultado' : 'parámetros'}
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--bg-base)] p-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            {detail ?? params}
          </pre>
        </details>
      )}
    </div>
  );
}

function UserBubble({ msg }: { msg: AgentMessage }) {
  return (
    <div className="agent-trace-in flex justify-end">
      <div className="agent-message-user max-w-[min(600px,85%)] rounded-[18px] bg-[var(--bg-input)] px-4 py-2.5 text-[14px] leading-[21px] text-[var(--text-primary)]">
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="flex size-5 items-center justify-center rounded-md text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
      aria-label={copied ? 'Copiado' : 'Copiar respuesta'}
      title={copied ? 'Copiado' : 'Copiar'}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
    >
      {copied ? <Check size={13} className="text-[var(--accent-green)]" /> : <Copy size={13} />}
    </button>
  );
}

function ToolSteps({ calls }: { calls: AgentToolCall[] }) {
  const attention = calls.some((c) => !['done', 'submitted'].includes(c.status));
  if (calls.length <= 2) return <>{calls.map((c) => <ToolCallStep key={c.id} call={c} />)}</>;
  const done = calls.filter((c) => c.status === 'done').length;
  return (
    <details className="group/steps rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2" open={attention}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
        <ChevronRight size={12} className="shrink-0 transition-transform group-open/steps:rotate-90" />
        <Wrench size={12} className="shrink-0" />
        {calls.length} pasos · {done} completados
      </summary>
      <div className="mt-2 space-y-1.5">{calls.map((c) => <ToolCallStep key={c.id} call={c} />)}</div>
    </details>
  );
}

function AssistantBlock({ msg, agent }: { msg: AgentMessage; agent?: AgentIdentity }) {
  const calls = msg.tool_calls ?? [];
  return (
    <div className="agent-trace-in group flex items-start gap-2.5">
      <div className="min-w-0 flex-1 space-y-1.5">
        {(msg.content || msg.reasoning) && (
          <div className="flex items-center gap-1.5">
            {agent && <AgentAvatar seed={agent.seed} name={agent.name} size={18} working={!!msg.partial} />}
            <span className="text-[12px] font-medium leading-5 text-[var(--text-secondary)]">
              {agent?.name ?? 'Agente'}
            </span>
            {!msg.partial && msg.content && <CopyButton text={msg.content} />}
          </div>
        )}
        {msg.reasoning && <Reasoning text={msg.reasoning} streaming={!!msg.partial && !msg.content} ms={msg.reasoning_ms} />}
        {msg.content && (
          <div className="agent-message-answer w-fit max-w-[min(620px,100%)] rounded-[18px] bg-[var(--bg-input)] px-4 py-3 text-[14px] leading-[22px] text-[var(--text-primary)]">
            <MessageMarkdown text={msg.content} streaming={!!msg.partial} />
          </div>
        )}
        {calls.length > 0 && (
          <div className="w-full max-w-[min(620px,100%)] space-y-1.5">
            <ToolSteps calls={calls} />
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageRow({ msg, agent }: { msg: AgentMessage; agent?: AgentIdentity }) {
  if (msg.role === 'tool_result') return null;
  return msg.role === 'user' ? <UserBubble msg={msg} /> : <AssistantBlock msg={msg} agent={agent} />;
}

export function ApprovalCard({
  approval,
  busy,
  onDecide,
}: {
  approval: AgentApproval;
  busy: boolean;
  onDecide: (id: string, ok: boolean) => void;
}) {
  return (
    <div className="max-w-[min(560px,90%)] overflow-hidden rounded-[20px] border border-[color:color-mix(in_srgb,var(--accent-yellow)_40%,transparent)] bg-[var(--bg-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--accent-yellow)_10%,transparent)] px-3 py-2 text-[12px] font-medium text-[var(--text-primary)]">
        <AlertTriangle size={13} className="text-[var(--accent-yellow)]" />
        El agente quiere ejecutar una acción
      </div>
      <div className="px-3 py-2.5">
        <p className="text-[12px] font-medium text-[var(--text-primary)]">
          {METHOD_LABELS[approval.method] ?? 'Acción avanzada: revisa sus detalles antes de aprobar'}
        </p>
        {typeof approval.params.id === 'string' && <p className="mt-1 text-xs text-[var(--text-secondary)]">Elemento: <span>{approval.params.id}</span></p>}
        {typeof approval.params.name === 'string' && <p className="mt-1 text-xs text-[var(--text-secondary)]">Nombre: {approval.params.name}</p>}
        {typeof approval.context?.filename === 'string' && <p className="mt-1 text-xs text-[var(--text-secondary)]">PDF: {approval.context.filename}</p>}
        {typeof approval.params.printer_name === 'string' && <p className="mt-1 text-xs text-[var(--text-secondary)]">Impresora: {approval.params.printer_name}</p>}
        {typeof approval.params.copies === 'number' && <p className="mt-1 text-xs text-[var(--text-secondary)]">Copias: {approval.params.copies} · Páginas: {String(approval.params.pages || 'Todas')}</p>}
        {typeof approval.params.destination_folder === 'string' && <p className="mt-1 break-all text-xs text-[var(--text-secondary)]">Destino: {approval.params.destination_folder}\{String(approval.params.filename || approval.params.name || '')}</p>}
        {approval.context?.account && <p className="mt-1 text-xs text-[var(--text-secondary)]">Cuenta: {approval.context.account}</p>}
        {approval.context?.sheet_id && <p className="mt-1 break-all text-xs text-[var(--text-secondary)]">Hoja: {approval.context.sheet_id}</p>}
        {approval.resources?.map((resource) => (
          <p key={resource.path} className="mt-1 break-all text-xs text-[var(--text-secondary)]">Archivo: {resource.path}</p>
        ))}
        <details className="mt-2 text-xs text-[var(--text-secondary)]">
          <summary className="cursor-pointer">Ver detalles de la acción</summary>
          <code>{approval.method}</code>
          {Object.keys(approval.params).length > 0 && (
            <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--bg-base)] p-2 text-[11px] text-[var(--text-secondary)]">
              {JSON.stringify(approval.params, null, 2)}
            </pre>
          )}
        </details>
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => onDecide(approval.id, true)}>
            <Check size={13} className="mr-1" />
            Aprobar
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(approval.id, false)}>
            <X size={13} className="mr-1" />
            Rechazar
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ThinkingRow({ elapsedSeconds, agent }: { elapsedSeconds: number; agent?: AgentIdentity }) {
  const mm = Math.floor(elapsedSeconds / 60);
  const ss = elapsedSeconds % 60;
  const elapsed = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
  return (
    <div role="status" className="flex items-center gap-2 px-3 text-[12px] leading-[18px] text-[var(--text-secondary)]">
      {agent ? <AgentAvatar seed={agent.seed} name={agent.name} size={24} working /> : <Loader2 size={12} className="animate-spin" />}
      El agente está trabajando
      <span className="agent-thinking-dots inline-flex items-center gap-1" aria-hidden="true"><span /><span /><span /></span>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <Clock3 size={11} />
        {elapsed}
      </span>
    </div>
  );
}

export interface AgentToolGroups {
  direct: string[];
  gated: string[];
  mcp: string[];
}

export function ToolGroup({ label, names, enabledNames, onToggle, disabled }: {
  label: string;
  names: string[];
  enabledNames?: Set<string>;
  onToggle?: (name: string, enabled: boolean) => void;
  disabled?: boolean;
}) {
  if (names.length === 0) return null;
  return (
    <details className="group rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
        <ChevronRight size={11} className="shrink-0 transition-transform group-open:rotate-90" />
        {label}
        <span className="ml-auto tabular-nums text-[var(--text-muted)]">{names.length}</span>
      </summary>
      <ul className="mt-1.5 max-h-44 space-y-1 overflow-auto">
        {names.map((n) => (
          <li key={n} className="flex items-center gap-2 font-mono text-[11px] text-[var(--text-muted)]" title={n}>
            <span className="min-w-0 flex-1 truncate">{METHOD_LABELS[n] ?? n}</span>
            {onToggle && <Toggle checked={enabledNames?.has(n) ?? true} onChange={(enabled) => onToggle(n, enabled)} disabled={disabled} aria-label={`Habilitar ${n}`} />}
          </li>
        ))}
      </ul>
    </details>
  );
}
