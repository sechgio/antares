import { useMemo } from 'react';
import { ARIA_LABELS } from '../constants';
import type { MatchRule } from '../types';

interface Props {
  rule: MatchRule;
  columns: string[];
  onChange: (rule: MatchRule) => void;
}

export default function MatchRuleEditor({ rule, columns, onChange }: Props) {
  const regexInvalid = useMemo(() => {
    if (rule.strategy !== 'regex' || !rule.regexPattern) return null;
    try {
      new RegExp(rule.regexPattern);
      if (!rule.regexPattern.includes('(?P<clave>')) return 'Falta el grupo nombrado (?P<clave>...)';
      return null;
    } catch (e: any) {
      return `Expresión regular inválida: ${e.message}`;
    }
  }, [rule]);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-secondary)]">Columna clave</label>
          <select
            aria-label={ARIA_LABELS.matchKeyColumn}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
            value={rule.keyColumn}
            onChange={(e) => onChange({ ...rule, keyColumn: e.target.value })}
          >
            <option value="">Seleccionar...</option>
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-secondary)]">Estrategia</label>
          <select
            aria-label={ARIA_LABELS.matchStrategy}
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
            value={rule.strategy}
            onChange={(e) => onChange({ ...rule, strategy: e.target.value as any })}
          >
            <option value="prefix">Prefijo del nombre</option>
            <option value="contains">Contiene en el nombre</option>
            <option value="exact">Coincidencia exacta</option>
            <option value="regex">Expresión regular</option>
          </select>
        </div>
      </div>
      {rule.strategy === 'regex' && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-secondary)]">Patrón regex</label>
          <input
            aria-label={ARIA_LABELS.regexPattern}
            type="text"
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] font-mono"
            value={rule.regexPattern || ''}
            onChange={(e) => onChange({ ...rule, regexPattern: e.target.value })}
            placeholder="(?P&lt;clave&gt;...)"
          />
          {regexInvalid && <span className="text-xs text-red-500">{regexInvalid}</span>}
        </div>
      )}
    </div>
  );
}
