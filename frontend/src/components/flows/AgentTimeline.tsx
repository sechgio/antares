import { AlertTriangle, Check, ChevronRight, Clock3, Loader2, ShieldCheck, Wrench, X } from 'lucide-react';
import type { AgentApproval, AgentMessage, AgentToolCall } from '../../api/agentApi';
import Button from '../ui/Button';

const CALL_STATUS_LABEL: Record<string, string> = {
  queued: 'en cola',
  pending: 'esperando aprobación',
  done: 'ejecutada',
  denied: 'rechazada',
};

function CallStatusIcon({ status }: { status: string }) {
  if (status === 'done') return <Check size={12} className="text-[var(--accent-green)]" />;
  if (status === 'denied') return <X size={12} className="text-[var(--accent-red)]" />;
  if (status === 'pending') return <ShieldCheck size={12} className="text-[var(--accent-yellow)]" />;
  return <Loader2 size={12} className="animate-spin text-[var(--text-muted)]" />;
}

function ToolCallStep({ call }: { call: AgentToolCall }) {
  const detail = call.status === 'done' && call.result ? call.result : null;
  const params = call.params && Object.keys(call.params).length > 0 ? JSON.stringify(call.params) : null;
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
          <Wrench size={11} />
        </span>
        <code className="truncate font-mono text-[var(--text-primary)]">{call.name}</code>
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
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-[var(--accent-primary)] px-3.5 py-2 text-[13px] leading-relaxed text-[var(--text-on-accent)]">
        <p className="whitespace-pre-wrap">{msg.content}</p>
      </div>
    </div>
  );
}

function AssistantBlock({ msg }: { msg: AgentMessage }) {
  return (
    <div className="space-y-2">
      {msg.content && (
        <p className="max-w-[90%] whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-primary)]">
          {msg.content}
        </p>
      )}
      {(msg.tool_calls ?? []).length > 0 && (
        <div className="max-w-[90%] space-y-1.5">
          {(msg.tool_calls ?? []).map((c) => (
            <ToolCallStep key={c.id} call={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export function MessageRow({ msg }: { msg: AgentMessage }) {
  if (msg.role === 'tool_result') return null; // ya se muestra dentro de la llamada
  return msg.role === 'user' ? <UserBubble msg={msg} /> : <AssistantBlock msg={msg} />;
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
    <div className="max-w-[90%] overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent-yellow)_40%,transparent)] bg-[var(--bg-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--accent-yellow)_10%,transparent)] px-3 py-2 text-[12px] font-medium text-[var(--text-primary)]">
        <AlertTriangle size={13} className="text-[var(--accent-yellow)]" />
        El agente quiere ejecutar una acción
      </div>
      <div className="px-3 py-2.5">
        <code className="block truncate font-mono text-[12px] text-[var(--text-primary)]">
          {approval.method}
        </code>
        {approval.params && Object.keys(approval.params).length > 0 && (
          <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--bg-base)] p-2 text-[11px] text-[var(--text-secondary)]">
            {JSON.stringify(approval.params, null, 2)}
          </pre>
        )}
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

export function ThinkingRow({ elapsedSeconds }: { elapsedSeconds: number }) {
  const mm = Math.floor(elapsedSeconds / 60);
  const ss = elapsedSeconds % 60;
  const elapsed = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
  return (
    <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
      <Loader2 size={12} className="animate-spin" />
      El agente está trabajando
      <span className="inline-flex items-center gap-1 tabular-nums">
        <Clock3 size={11} />
        {elapsed}
      </span>
    </div>
  );
}
