import { Loader2, Waypoints } from 'lucide-react';
import type { AgentDelegation } from '../../api/agentApi';
import { METHOD_LABELS } from './methodLabels';

function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 s';
  return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

export default function SubagentRoster({ items }: { items: AgentDelegation[] }) {
  if (items.length === 0) return null;
  return (
    <section
      aria-label="Delegaciones en curso"
      className="mb-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
    >
      <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-[var(--text-secondary)]">
        <Waypoints size={11} className="text-[var(--text-muted)]" />
        <span>Delegaciones</span>
        <span className="tabular-nums text-[var(--text-muted)]">{items.length}</span>
      </div>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item.session_id} className="flex min-w-0 items-baseline gap-2 text-[11px]">
            <span className="truncate font-medium text-[var(--text-primary)]">{item.agent}</span>
            {item.room && (
              <span
                className="shrink-0 rounded-full border border-[var(--border-subtle)] px-1.5 py-px text-[9.5px] text-[var(--text-muted)]"
                title={item.room.turn_agent ? `${item.room.topic} · turno de ${item.room.turn_agent}` : item.room.topic}
              >
                {item.room.status === 'open' ? `Sala ${item.room.round}/${item.room.rounds}` : 'Sala cerrada'}
              </span>
            )}
            <span className="shrink-0 text-[var(--text-muted)]">{item.state}</span>
            {item.delivery && (item.delivery.state === 'deferred' || item.delivery.state === 'unreachable') && (
              <span
                className="shrink-0 rounded-full border border-[var(--border-subtle)] px-1.5 py-px text-[9.5px] text-[var(--text-muted)]"
                title={`${item.delivery.state === 'unreachable' ? 'La entrega sigue fallando' : 'La entrega se reintentará'}`
                  + `${item.delivery.attempts ? ` (${item.delivery.attempts} intentos)` : ''}`
                  + `${item.delivery.error ? `: ${item.delivery.error}` : ''}`}
              >
                {item.delivery.state === 'unreachable' ? 'sin entrega' : 'reintento'}
                {item.delivery.attempts ? ` · ${item.delivery.attempts}` : ''}
              </span>
            )}
            {item.last_tool && (
              <span
                className="min-w-0 truncate text-[10.5px] text-[var(--text-muted)]"
                title={METHOD_LABELS[item.last_tool.name] ?? item.last_tool.name}
              >
                {METHOD_LABELS[item.last_tool.name] ?? item.last_tool.name}
                {item.last_tool.failed ? ' · error' : ''}
              </span>
            )}
            <span className="ml-auto shrink-0 tabular-nums text-[10px] text-[var(--text-muted)]">{duration(item.ms)}</span>
            {item.running && <Loader2 size={10} className="shrink-0 animate-spin text-[var(--text-muted)]" aria-hidden="true" />}
          </li>
        ))}
      </ul>
    </section>
  );
}
