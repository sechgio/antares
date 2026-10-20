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
  const action = METHOD_LABELS[approval.method];
  const { params, context } = approval;
  const facts = [
    typeof params.id === 'string' && `Elemento: ${params.id}`,
    typeof params.name === 'string' && `Nombre: ${params.name}`,
    typeof context?.filename === 'string' && `PDF: ${context.filename}`,
    typeof params.printer_name === 'string' && `Impresora: ${params.printer_name}`,
    typeof params.copies === 'number' && `Copias: ${params.copies} · Páginas: ${String(params.pages || 'Todas')}`,
    typeof params.destination_folder === 'string' && `Destino: ${params.destination_folder}\\${String(params.filename || params.name || '')}`,
    context?.account && `Cuenta: ${context.account}`,
    context?.sheet_id && `Hoja: ${context.sheet_id}`,
    ...(approval.resources ?? []).map((resource) => `Archivo: ${resource.path}`),
  ].filter((fact): fact is string => !!fact);
  return (
    <div role="group" aria-label="Confirmación de acción" className="agent-trace-in max-w-[min(560px,92%)] rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[color:color-mix(in_srgb,var(--accent-yellow)_14%,transparent)] text-[var(--accent-yellow)]">
          <ShieldCheck size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-5 text-[var(--text-primary)]">
            {action ? `¿Ejecutar «${action}»?` : '¿Permitir una acción avanzada?'}
          </p>
          <p className="text-[12px] leading-[18px] text-[var(--text-muted)]">
            {action ? 'El turno sigue en pausa hasta que decidas.' : 'Revisa sus detalles antes de aprobar; el turno sigue en pausa.'}
          </p>
          {facts.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-[var(--text-secondary)]">
              {facts.map((fact) => <li key={fact} className="break-all">{fact}</li>)}
            </ul>
          )}
          <details className="group mt-2 text-xs text-[var(--text-muted)]">
            <summary className="flex cursor-pointer list-none items-center gap-1 transition-colors hover:text-[var(--text-secondary)]">
              <ChevronRight size={11} className="transition-transform group-open:rotate-90" />
              Ver detalles de la acción
            </summary>
            <code className="mt-1 block text-[11px]">{approval.method}</code>
            {Object.keys(params).length > 0 && (
              <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--bg-base)] p-2 text-[11px] text-[var(--text-secondary)]">
                {JSON.stringify(params, null, 2)}
              </pre>
            )}
          </details>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide(approval.id, false)}>
          <X size={13} aria-hidden="true" />
          Rechazar
        </Button>
        <Button size="sm" disabled={busy} onClick={() => onDecide(approval.id, true)}>
          <Check size={13} aria-hidden="true" />
          Aprobar
        </Button>
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
