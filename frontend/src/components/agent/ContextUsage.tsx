import { useId, useState, type ReactNode } from 'react';
import type { AgentUsage } from '../../api/agentApi';

const CONTEXT_WINDOWS: [RegExp, number][] = [
  [/gemini/i, 1_048_576],
  [/gpt-4\.1/i, 1_047_576],
  [/gpt-5/i, 400_000],
  [/claude/i, 200_000],
  [/gpt-4o|^o[134](-|$)/i, 128_000],
  [/llama-?3\.[1-3]|deepseek/i, 128_000],
  [/qwen|mistral|mixtral/i, 32_768],
];

export function contextWindowFor(model: string): number | null {
  return CONTEXT_WINDOWS.find(([pattern]) => pattern.test(model))?.[1] ?? null;
}

export function formatTokens(value: number): string {
  const compact = (n: number) => n.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  if (value >= 1_000_000) return `${compact(value / 1_000_000)} M`;
  if (value >= 1000) return `${compact(value / 1000)} k`;
  return String(value);
}

export function formatCost(value: number): string {
  if (value > 0 && value < 0.0001) return '<$0,0001';
  const decimals = value > 0 && value < 1 ? 4 : 2;
  return `$${new Intl.NumberFormat('es', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)}`;
}

function Ring({ ratio, level, spinning }: { ratio: number; level: 'ok' | 'warn' | 'critical'; spinning?: boolean }) {
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const color = level === 'critical' ? 'var(--accent-red)' : level === 'warn' ? 'var(--accent-yellow)' : 'var(--text-secondary)';
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className={`-rotate-90 shrink-0 ${spinning ? 'animate-spin motion-reduce:animate-none' : ''}`}>
      <circle cx="9" cy="9" r={radius} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.18" />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - (spinning ? 0.25 : Math.max(ratio, 0.02)))}
        className="transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="text-[var(--text-primary)]">{children}</span>
    </div>
  );
}

export default function ContextUsage({ usage, model, contextWindow, thresholds, compacting }: {
  usage: AgentUsage | null;
  model: string;
  contextWindow?: number | null;
  thresholds?: { warn: number; compact: number } | null;
  compacting?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cardId = useId();
  if (!usage && !compacting) return null;
  const used = usage ? (usage.context ?? usage.input + usage.output) : 0;
  const max = (usage?.window && usage.window > 0 ? usage.window : 0)
    || (contextWindow && contextWindow > 0 ? contextWindow : 0)
    || contextWindowFor(model);
  const ratio = max ? Math.min(1, used / max) : 0;
  const percent = `${new Intl.NumberFormat('es', { maximumFractionDigits: 1 }).format(ratio * 100)}%`;
  const level: 'ok' | 'warn' | 'critical' = thresholds && max && used >= thresholds.compact
    ? 'critical'
    : thresholds && max && used >= thresholds.warn ? 'warn' : 'ok';
  const turn = usage?.turn;
  const cost = usage?.cost ?? 0;
  const showCost = cost > 0 || (turn?.cost ?? 0) > 0;
  const compactions = usage?.compactions ?? 0;

  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="Contexto usado"
        aria-describedby={open ? cardId : undefined}
        className={`inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-full px-1.5 text-[12px] tabular-nums transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] ${level === 'warn' ? 'text-[var(--accent-yellow)]' : level === 'critical' ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'}`}
      >
        {(max || compacting) && <Ring ratio={ratio} level={level} spinning={compacting} />}
        {compacting ? <span className="sr-only">Compactando…</span> : max ? <span className="sr-only">{percent}</span> : formatTokens(used)}
      </button>
      {open && (
        <div
          id={cardId}
          role="tooltip"
          className="agent-popover-in absolute bottom-full right-0 z-[300] mb-2 w-64 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[12px] shadow-[0_16px_40px_rgba(0,0,0,0.18),0_2px_6px_rgba(0,0,0,0.06)]"
        >
          <div className="p-3.5">
            {compacting && <p className="mb-1 text-[11px] text-[var(--text-muted)]">Compactando el contexto…</p>}
            <div className="flex items-baseline justify-between gap-3 tabular-nums">
              <span className={`text-[22px] font-semibold leading-7 ${level === 'critical' ? 'text-[var(--accent-red)]' : level === 'warn' ? 'text-[var(--accent-yellow)]' : 'text-[var(--text-primary)]'}`}>{max ? percent : 'Tokens'}</span>
              <span className="text-[var(--text-muted)]">
                {formatTokens(used)}{max ? ` / ${formatTokens(max)}` : ''}
              </span>
            </div>
            {max && (
              <div className="relative mt-2.5">
                <div
                  role="progressbar"
                  aria-label="Proporción del contexto usada"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(ratio * 100)}
                  className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-input)]"
                >
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${level === 'critical' ? 'bg-[var(--accent-red)]' : level === 'warn' ? 'bg-[var(--accent-yellow)]' : 'bg-[var(--accent-primary)]'}`}
                    style={{ width: `${ratio * 100}%` }}
                  />
                </div>
                {thresholds && [thresholds.warn, thresholds.compact].map((mark, i) => mark < max && (
                  <span key={i} title={`${i ? 'Compactación' : 'Aviso'}: ${formatTokens(mark)}`} className={`absolute -top-0.5 h-2.5 w-px ${i ? 'bg-[var(--accent-red)]' : 'bg-[var(--accent-yellow)]'} opacity-70`} style={{ left: `${(mark / max) * 100}%` }} />
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1.5 border-t border-[var(--border-subtle)] px-3.5 py-3 tabular-nums">
            <Row label="Entrada">{formatTokens(usage?.input ?? 0)}</Row>
            <Row label="Salida">{formatTokens(usage?.output ?? 0)}</Row>
            {!!usage?.cached && !!usage?.prompt && (
              <Row label="En caché">
                {formatTokens(usage.cached ?? 0)} · {new Intl.NumberFormat('es', { maximumFractionDigits: 0 }).format(((usage.cached ?? 0) / usage.prompt) * 100)}%
              </Row>
            )}
          </div>
          {(turn || showCost || compactions > 0) && (
            <div className="space-y-1.5 border-t border-[var(--border-subtle)] px-3.5 py-3 tabular-nums">
              {turn && <Row label="Último turno">{formatTokens(turn.input)} ent. · {formatTokens(turn.output)} sal.</Row>}
              {showCost && <Row label="Coste del turno">{formatCost(turn?.cost ?? 0)}</Row>}
              {showCost && <Row label="Coste de la sesión">{formatCost(cost)}</Row>}
              {compactions > 0 && <Row label="Compactaciones">{compactions}</Row>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
