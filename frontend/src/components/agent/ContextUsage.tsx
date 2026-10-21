import { useId, useState } from 'react';

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

function Ring({ ratio }: { ratio: number }) {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="-rotate-90 shrink-0">
      <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - ratio)}
      />
    </svg>
  );
}

export default function ContextUsage({ usage, model }: {
  usage: { input: number; output: number; context?: number; cached?: number; prompt?: number } | null;
  model: string;
}) {
  const [open, setOpen] = useState(false);
  const cardId = useId();
  if (!usage) return null;
  const used = usage.context ?? usage.input + usage.output;
  const max = contextWindowFor(model);
  const ratio = max ? Math.min(1, used / max) : 0;
  const percent = `${new Intl.NumberFormat('es', { maximumFractionDigits: 1 }).format(ratio * 100)}%`;

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
        className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] tabular-nums text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
      >
        {max && <Ring ratio={ratio} />}
        {max ? percent : formatTokens(used)}
      </button>
      {open && (
        <div
          id={cardId}
          role="tooltip"
          className="agent-popover-in absolute bottom-full right-0 z-[300] mb-2 w-60 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[12px] shadow-md"
        >
          <div className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-3 tabular-nums">
              <span className="font-medium text-[var(--text-primary)]">{max ? percent : 'Tokens'}</span>
              <span className="text-[var(--text-muted)]">
                {formatTokens(used)}{max ? ` / ${formatTokens(max)}` : ''}
              </span>
            </div>
            {max && (
              <div
                role="progressbar"
                aria-label="Proporción del contexto usada"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(ratio * 100)}
                className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-input)]"
              >
                <div className="h-full rounded-full bg-[var(--text-primary)] transition-[width]" style={{ width: `${ratio * 100}%` }} />
              </div>
            )}
          </div>
          <div className="space-y-1.5 border-t border-[var(--border-subtle)] p-3 tabular-nums">
            <div className="flex justify-between"><span className="text-[var(--text-muted)]">Entrada</span><span className="text-[var(--text-primary)]">{formatTokens(usage.input)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--text-muted)]">Salida</span><span className="text-[var(--text-primary)]">{formatTokens(usage.output)}</span></div>
            {!!usage.cached && !!usage.prompt && (
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">En caché</span>
                <span className="text-[var(--text-primary)]">
                  {formatTokens(usage.cached ?? 0)} · {new Intl.NumberFormat('es', { maximumFractionDigits: 0 }).format(((usage.cached ?? 0) / usage.prompt) * 100)}%
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
