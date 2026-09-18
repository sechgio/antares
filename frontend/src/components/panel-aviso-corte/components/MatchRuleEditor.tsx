import { useMemo } from 'react';
import ThemedSelect from '../../ui/ThemedSelect';
import { ARIA_LABELS } from '../constants';
import type { MatchRule } from '../types';
import { errorMessage } from '@/utils/errors';

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
    } catch (e: unknown) {
      return `Expresión regular inválida: ${errorMessage(e, String(e))}`;
    }
  }, [rule]);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-secondary)]">Columna clave</label>
          <ThemedSelect
            aria-label={ARIA_LABELS.matchKeyColumn}
            triggerClassName="rounded-lg border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
            value={rule.keyColumn}
            onChange={(value) => onChange({ ...rule, keyColumn: value })}
            options={[
              { value: '', label: 'Seleccionar...' },
              ...columns.map((c) => ({ value: c, label: c })),
            ]}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-secondary)]">Estrategia</label>
          <ThemedSelect
            aria-label={ARIA_LABELS.matchStrategy}
            triggerClassName="rounded-lg border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
            value={rule.strategy}
            onChange={(value) => onChange({ ...rule, strategy: value as MatchRule['strategy'] })}
            options={[
              { value: 'prefix', label: 'Prefijo del nombre' },
              { value: 'contains', label: 'Contiene en el nombre' },
              { value: 'exact', label: 'Coincidencia exacta' },
              { value: 'regex', label: 'Expresión regular' },
            ]}
          />
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
          {regexInvalid && <span className="text-xs text-[var(--accent-red)]">{regexInvalid}</span>}
        </div>
      )}
    </div>
  );
}
