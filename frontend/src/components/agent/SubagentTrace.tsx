import { useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Loader2, Waypoints } from 'lucide-react';
import type { AgentToolCall } from '../../api/agentApi';
import AgentAvatar from './AgentAvatar';
import { METHOD_LABELS } from './methodLabels';

export interface SubagentStep {
  name: string;
  status: string;
  detail?: string;
}

export interface SubagentReceipt {
  agent: { id?: string; name: string };
  status: string;
  text: string;
  steps: SubagentStep[];
  ms: number | null;
}

export function parseSubagentReceipt(result: string | null | undefined): SubagentReceipt | null {
  if (!result) return null;
  try {
    const parsed: unknown = JSON.parse(result);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    const agent = record.agent as Record<string, unknown> | undefined;
    if (!agent || typeof agent.name !== 'string') return null;
    const steps = Array.isArray(record.steps)
      ? record.steps
        .filter((step): step is Record<string, unknown> => !!step && typeof step === 'object' && typeof (step as Record<string, unknown>).name === 'string')
        .map((step) => ({
          name: String(step.name),
          status: typeof step.status === 'string' ? step.status : 'done',
          ...(typeof step.detail === 'string' && step.detail ? { detail: step.detail } : {}),
        }))
      : [];
    return {
      agent: { name: agent.name, ...(typeof agent.id === 'string' ? { id: agent.id } : {}) },
      status: typeof record.status === 'string' ? record.status : 'done',
      text: typeof record.text === 'string' ? record.text : '',
      steps,
      ms: typeof record.ms === 'number' ? record.ms : null,
    };
  } catch {
    return null;
  }
}

const STATUS_LABEL: Record<string, string> = {
  done: 'completado',
  empty: 'sin resultados',
  limit: 'límite de pasos',
  failed: 'falló',
  denied: 'rechazada',
  interrupted: 'interrumpida',
  queued: 'en cola',
  pending: 'pendiente',
};

function statusTone(status: string, live: boolean): string {
  if (live) return 'text-[var(--text-secondary)]';
  if (status === 'done') return 'text-[var(--accent-green)]';
  if (status === 'limit' || status === 'interrupted') return 'text-[var(--accent-yellow)]';
  if (status === 'failed' || status === 'denied' || status === 'error') return 'text-[var(--accent-red)]';
  return 'text-[var(--text-muted)]';
}

function duration(ms: number | null): string | null {
  if (ms === null) return null;
  return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

function rawError(result: string | null | undefined): string | null {
  if (!result) return null;
  try {
    const parsed: unknown = JSON.parse(result);
    if (parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).error === 'string') {
      return String((parsed as Record<string, unknown>).error);
    }
  } catch {
    return result;
  }
  return null;
}

export default function SubagentTrace({ call }: { call: AgentToolCall }) {
  const receipt = parseSubagentReceipt(call.result);
  const terminal = ['done', 'denied', 'failed', 'interrupted'].includes(call.status);
  const live = !terminal;
  const status = receipt?.status ?? call.status;
  const name = receipt?.agent.name
    || (typeof call.params.agent === 'string' && call.params.agent.trim() ? call.params.agent : 'Subagente');
  const task = typeof call.params.task === 'string' ? call.params.task : '';
  const steps = receipt?.steps ?? [];
  const error = receipt ? null : rawError(call.result);
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const elapsed = duration(receipt?.ms ?? null);
  const hasBody = steps.length > 0 || !!receipt?.text || !!error;
  const open = openOverride ?? (live || !['done', 'empty'].includes(status));

  return (
    <div className="agent-trace-in rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpenOverride(!open)}
        aria-expanded={open}
        aria-label={`Delegación en ${name}`}
      >
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)]">
          <AgentAvatar seed={receipt?.agent.id ?? name} name={name} size={14} />
          {live && <span className="absolute -right-0.5 -top-0.5 size-1.5 animate-pulse rounded-full bg-[var(--accent-primary)]" />}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-[12px] font-medium text-[var(--text-primary)]">{name}</span>
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">subagente</span>
        </span>
        <span className={`flex shrink-0 items-center gap-1 text-[11px] ${statusTone(status, live)}`}>
          {live
            ? <Loader2 size={11} className="animate-spin" />
            : status === 'done'
              ? <Check size={11} />
              : <AlertTriangle size={11} />}
          {live ? 'delegando' : STATUS_LABEL[status] ?? status}
        </span>
        {elapsed && <span className="shrink-0 tabular-nums text-[10px] text-[var(--text-muted)]">{elapsed}</span>}
        {hasBody && (
          <ChevronRight
            size={11}
            className={`shrink-0 text-[var(--text-muted)] transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
          />
        )}
      </button>

      {task && (
        <p className={`mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-muted)] ${open ? '' : 'truncate'}`}>
          {task}
        </p>
      )}

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          {steps.length > 0 && (
            <ol className="relative mt-2 space-y-1.5">
              <span aria-hidden="true" className="absolute bottom-1.5 left-[7px] top-1.5 w-px bg-[var(--border-medium)]" />
              {steps.map((step, index) => (
                <li
                  key={`${step.name}-${index}`}
                  className="agent-trace-in relative flex items-start gap-2 text-[11px] leading-4"
                  style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
                >
                  <span className={`relative z-10 mt-px flex size-[15px] shrink-0 items-center justify-center rounded-full border border-[var(--border-medium)] bg-[var(--bg-surface)] ${step.status === 'done' ? 'text-[var(--accent-green)]' : step.status === 'failed' ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'}`}>
                    {step.status === 'done' ? <Check size={8} /> : step.status === 'failed' ? <AlertTriangle size={8} /> : <Waypoints size={8} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[var(--text-secondary)]">{METHOD_LABELS[step.name] ?? step.name}</span>
                    {step.detail && (
                      <span className="block truncate text-[10.5px] text-[var(--text-muted)]" title={step.detail}>{step.detail}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {receipt?.text && (
            <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-base)] px-2 py-1.5 text-[11.5px] leading-[17px] text-[var(--text-secondary)] custom-scrollbar">
              {receipt.text}
            </p>
          )}
          {error && (
            <p className="mt-2 break-words rounded-lg bg-[color:color-mix(in_srgb,var(--accent-red)_10%,transparent)] px-2 py-1.5 text-[11px] leading-relaxed text-[var(--accent-red)]">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
