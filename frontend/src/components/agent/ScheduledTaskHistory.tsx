import type { AgentTask, AgentTaskRun, AgentTaskStatus } from '../../api/agentApi';
import { formatMoment } from '../../utils/dates';

export const STATUS_LABELS: Record<AgentTaskStatus, string> = {
  pending: 'Programado',
  delivering: 'Entregando',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  uncertain: 'Incierto',
  needs_input: 'Espera respuesta',
  blocked: 'Bloqueado',
  to_verify: 'Por verificar',
};

const RUN_LABELS: Record<AgentTaskRun['status'], string> = {
  delivered: 'Entregado',
  failed: 'Falló',
  uncertain: 'Incierto',
  needs_input: 'Espera respuesta',
  blocked: 'Bloqueado',
};

export default function ScheduledTaskHistory({ task }: { task: AgentTask }) {
  const runs = [...(task.runs || [])].reverse();
  const events = [...(task.events || [])].reverse();
  return (
    <div className="border-t border-[var(--border-subtle)] px-3 py-2">
      {runs.length === 0 ? (
        <p className="text-[12px] text-[var(--text-secondary)]">Todavía no se ejecutó.</p>
      ) : (
        <ul className="space-y-1">
          {runs.map((run, index) => (
            <li
              key={`${run.at}-${index}`}
              className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]"
            >
              <span
                className={
                  run.status === 'delivered'
                    ? 'text-[var(--accent-green)]'
                    : run.status === 'uncertain' || run.status === 'blocked'
                      ? 'text-[var(--accent-red)]'
                      : 'text-[var(--accent-yellow)]'
                }
              >
                {RUN_LABELS[run.status]}
              </span>
              <span>{formatMoment(run.at, task.timezone)}</span>
              {run.error && <span className="min-w-0 flex-1 break-all">{run.error}</span>}
            </li>
          ))}
        </ul>
      )}
      {events.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-[var(--border-subtle)] pt-2" aria-label="Eventos del encargo">
          {events.map((event, index) => (
            <li
              key={`${event.at}-${index}`}
              className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]"
            >
              <span className="text-[var(--text-muted)]">{formatMoment(event.at, task.timezone)}</span>
              <span>{STATUS_LABELS[event.to] || event.to}</span>
              {event.reason && <span className="min-w-0 flex-1 break-all">{event.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
