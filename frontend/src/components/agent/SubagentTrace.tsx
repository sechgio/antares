import { useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Clock3, FileJson, Loader2, ShieldCheck, Waypoints } from 'lucide-react';
import type { AgentToolCall } from '../../api/agentApi';
import AgentAvatar from './AgentAvatar';
import { METHOD_LABELS } from './methodLabels';

interface SubagentStep {
  name: string;
  status: string;
  detail?: string;
}

interface SubagentResult {
  task?: string;
  role?: string;
  status: string;
  text: string;
  output?: unknown;
  schemaValid?: boolean;
  schemaError?: string;
  steps: SubagentStep[];
  ms: number | null;
}

interface SubagentReceipt extends SubagentResult {
  agent: { id?: string; name: string };
  results?: SubagentResult[];
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseSteps(value: unknown): SubagentStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((step) => {
    const record = recordOf(step);
    if (!record || typeof record.name !== 'string') return [];
    return [{
      name: record.name,
      status: typeof record.status === 'string' ? record.status : 'done',
      ...(typeof record.detail === 'string' && record.detail ? { detail: record.detail } : {}),
    }];
  });
}

function parseResult(record: Record<string, unknown>): SubagentResult {
  return {
    ...(typeof record.task === 'string' ? { task: record.task } : {}),
    ...(typeof record.role === 'string' ? { role: record.role } : {}),
    status: typeof record.status === 'string' ? record.status : 'done',
    text: typeof record.text === 'string' ? record.text : '',
    ...(record.output !== undefined ? { output: record.output } : {}),
    ...(typeof record.schema_valid === 'boolean' ? { schemaValid: record.schema_valid } : {}),
    ...(typeof record.schema_error === 'string' ? { schemaError: record.schema_error } : {}),
    steps: parseSteps(record.steps),
    ms: typeof record.ms === 'number' ? record.ms : null,
  };
}

function parseSubagentReceipt(result: string | null | undefined): SubagentReceipt | null {
  if (!result) return null;
  try {
    const parsed: unknown = JSON.parse(result);
    const record = recordOf(parsed);
    if (!record) return null;
    const agent = recordOf(record.agent);
    if (!agent || typeof agent.name !== 'string') return null;
    const results = Array.isArray(record.results)
      ? record.results.flatMap((item) => {
        const entry = recordOf(item);
        return entry ? [parseResult(entry)] : [];
      })
      : [];
    return {
      ...parseResult(record),
      agent: { name: agent.name, ...(typeof agent.id === 'string' ? { id: agent.id } : {}) },
      ...(results.length > 0 ? { results } : {}),
    };
  } catch {
    return null;
  }
}

const STATUS_LABEL: Record<string, string> = {
  done: 'completado',
  empty: 'sin resultados',
  limit: 'límite de pasos',
  token_budget: 'presupuesto agotado',
  invalid: 'contrato incumplido',
  partial: 'parcial',
  failed: 'falló',
  denied: 'rechazada',
  interrupted: 'interrumpida',
  queued: 'en cola',
  pending: 'pendiente',
  submitted: 'enviada',
};

const ROLE_LABEL: Record<string, string> = {
  explorer: 'explorador',
  reviewer: 'revisor',
  worker: 'worker',
};

function statusTone(status: string, live: boolean): string {
  if (live) return 'text-[var(--text-secondary)]';
  if (status === 'done') return 'text-[var(--accent-green)]';
  if (status === 'limit' || status === 'token_budget' || status === 'interrupted' || status === 'partial') return 'text-[var(--accent-yellow)]';
  if (status === 'failed' || status === 'denied' || status === 'invalid' || status === 'error') return 'text-[var(--accent-red)]';
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
    const record = recordOf(parsed);
    if (record && typeof record.error === 'string') return record.error;
  } catch {
    return result;
  }
  return null;
}

function RoleChip({ role }: { role?: string }) {
  if (!role) return null;
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-medium ${
        role === 'worker'
          ? 'bg-[color:color-mix(in_srgb,var(--accent-yellow)_16%,transparent)] text-[var(--accent-yellow)]'
          : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
      }`}
    >
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

function Steps({ steps }: { steps: SubagentStep[] }) {
  if (steps.length === 0) return null;
  return (
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
  );
}

function OutputContract({ result }: { result: Pick<SubagentResult, 'output' | 'schemaValid' | 'schemaError'> }) {
  if (result.schemaValid === undefined) return null;
  const valid = result.schemaValid;
  return (
    <div
      className={`mt-2 rounded-lg border px-2 py-1.5 ${
        valid
          ? 'border-[var(--border-subtle)] bg-[var(--bg-base)]'
          : 'border-[color:color-mix(in_srgb,var(--accent-red)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-red)_8%,transparent)]'
      }`}
    >
      <div className={`flex items-center gap-1 text-[10px] font-medium ${valid ? 'text-[var(--text-muted)]' : 'text-[var(--accent-red)]'}`}>
        <FileJson size={10} />
        <span>Contrato de salida</span>
        <span aria-hidden="true">·</span>
        <span>{valid ? 'validado' : 'incumplido'}</span>
      </div>
      {valid && result.output !== undefined && (
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[10.5px] leading-[15px] text-[var(--text-secondary)] custom-scrollbar">
          {JSON.stringify(result.output, null, 2)}
        </pre>
      )}
      {!valid && result.schemaError && (
        <p className="mt-1 break-words text-[10.5px] leading-relaxed text-[var(--accent-red)]">{result.schemaError}</p>
      )}
    </div>
  );
}

function ResultBody({ result }: { result: SubagentResult }) {
  return (
    <>
      <Steps steps={result.steps} />
      {result.text && (
        <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-base)] px-2 py-1.5 text-[11.5px] leading-[17px] text-[var(--text-secondary)] custom-scrollbar">
          {result.text}
        </p>
      )}
      <OutputContract result={result} />
    </>
  );
}

function GroupResult({ result, index }: { result: SubagentResult; index: number }) {
  const elapsed = duration(result.ms);
  return (
    <li
      className="agent-trace-in rounded-xl border border-[var(--border-subtle)] px-2 py-1.5"
      style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text-primary)]" title={result.task ?? `Encargo ${index + 1}`}>
          {result.task ?? `Encargo ${index + 1}`}
        </span>
        <RoleChip role={result.role} />
        <span className={`shrink-0 text-[10px] ${statusTone(result.status, false)}`}>
          {STATUS_LABEL[result.status] ?? result.status}
        </span>
        {elapsed && <span className="shrink-0 tabular-nums text-[9.5px] text-[var(--text-muted)]">{elapsed}</span>}
      </div>
      <ResultBody result={result} />
    </li>
  );
}

export default function SubagentTrace({ call }: { call: AgentToolCall }) {
  const receipt = parseSubagentReceipt(call.result);
  const live = call.status === 'running';
  const status = receipt?.status ?? call.status;
  const name = receipt?.agent.name
    || (typeof call.params.agent === 'string' && call.params.agent.trim() ? call.params.agent : 'Subagente');
  const task = typeof call.params.task === 'string' ? call.params.task : '';
  const steps = receipt?.steps ?? [];
  const grouped = receipt?.results ?? null;
  const error = receipt ? null : rawError(call.result);
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const elapsed = duration(receipt?.ms ?? null);
  const hasBody = grouped
    ? grouped.length > 0
    : steps.length > 0 || !!receipt?.text || receipt?.schemaValid !== undefined || !!error;
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
          <AgentAvatar seed={receipt?.agent.id ?? name} name={name} size={22} working={live} />
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-[12px] font-medium text-[var(--text-primary)]">{name}</span>
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">subagente</span>
          {!grouped && <RoleChip role={receipt?.role} />}
        </span>
        <span className={`flex shrink-0 items-center gap-1 text-[11px] ${statusTone(status, live)}`}>
          {live
            ? <Loader2 size={11} className="animate-spin" />
            : status === 'done'
              ? <Check size={11} />
              : status === 'pending'
                ? <ShieldCheck size={11} />
                : status === 'queued' || status === 'submitted'
                  ? <Clock3 size={11} />
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
        <div className="agent-subagent-body overflow-hidden" inert={!open} aria-hidden={!open}>
          {grouped ? (
            <ol className="mt-2 space-y-1.5">
              {grouped.map((result, index) => (
                <GroupResult key={`${result.task ?? 'encargo'}-${index}`} result={result} index={index} />
              ))}
            </ol>
          ) : (
            <>
              <Steps steps={steps} />
              {receipt?.text && (
                <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-base)] px-2 py-1.5 text-[11.5px] leading-[17px] text-[var(--text-secondary)] custom-scrollbar">
                  {receipt.text}
                </p>
              )}
              {receipt && <OutputContract result={receipt} />}
            </>
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
