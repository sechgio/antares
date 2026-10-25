import { Pause, Play, X } from 'lucide-react';
import type {
  AgentQueuePauseReason, AgentQueueState, AgentSession, AgentTask, AgentTaskStatus,
} from '../../api/agentApi';
import Button from '../ui/Button';

export interface AgentQueueGroup {
  sessionId: string;
  state?: AgentQueueState;
  tasks: AgentTask[];
}

const QUEUE_STATUS_CLASSES: Record<AgentTaskStatus, string> = {
  pending: 'bg-[color-mix(in_srgb,var(--accent-primary)_10%,transparent)] text-[var(--accent-primary)]',
  delivering: 'bg-[color-mix(in_srgb,var(--accent-yellow)_14%,transparent)] text-[var(--accent-yellow)]',
  delivered: 'bg-[color-mix(in_srgb,var(--accent-green)_12%,transparent)] text-[var(--accent-green)]',
  cancelled: 'bg-[var(--bg-input)] text-[var(--text-muted)]',
  uncertain: 'bg-[color-mix(in_srgb,var(--accent-red)_10%,transparent)] text-[var(--accent-red)]',
};

function queueReasonText(reason: AgentQueuePauseReason | undefined): string {
  if (reason === 'continuation') return 'En pausa porque el turno anterior necesita reanudarse.';
  if (reason === 'failed') return 'En pausa tras un encargo fallido; revísalo antes de reanudar.';
  if (reason === 'cancelled') return 'En pausa porque se detuvo el turno en curso.';
  return 'La cola está pausada; los encargos pendientes esperan a que la reanudes.';
}

function taskStatusLabel(task: AgentTask, queue: AgentQueueState | undefined): string {
  if (task.kind !== 'queue') return '';
  if (task.status === 'pending') return queue?.paused ? 'En pausa' : 'En cola';
  if (task.status === 'delivering') return 'Ejecutando';
  if (task.status === 'delivered') return 'Completado';
  if (task.status === 'cancelled') return 'Cancelado';
  return 'Incierto';
}

export default function AgentQueuePanel({ groups, sessions, busy, onToggle, onCancel, onStop }: {
  groups: AgentQueueGroup[];
  sessions: AgentSession[];
  busy: string | null;
  onToggle: (queue: AgentQueueState) => void;
  onCancel: (task: AgentTask) => void;
  onStop: (sessionId: string) => void;
}) {
  return (
    <section className="mb-4 space-y-2" aria-label="Cola de trabajo">
      {groups.map((group) => {
        const sessionTitle = sessions.find((session) => session.id === group.sessionId)?.title || group.sessionId;
        const pendingCount = group.tasks.filter((task) => task.status === 'pending').length;
        const runningCount = group.tasks.filter((task) => task.status === 'delivering').length;
        const paused = !!group.state?.paused;
        return (
          <div key={group.sessionId} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
              <h3 className="min-w-0 flex-1 break-words text-[13px] font-semibold text-[var(--text-primary)]">
                Cola de {sessionTitle}
              </h3>
              <span className="text-[11px] text-[var(--text-secondary)]">
                {pendingCount} en cola{runningCount ? ' · 1 ejecutando' : ''}
              </span>
              <Button variant="ghost" size="sm" disabled={busy !== null}
                aria-label={`${paused ? 'Reanudar' : 'Pausar'} cola de ${sessionTitle}`}
                onClick={() => onToggle(group.state || {
                  session_id: group.sessionId, paused: false, pending: pendingCount, running: runningCount,
                })}>
                {paused ? <Play size={12} /> : <Pause size={12} />} {paused ? 'Reanudar' : 'Pausar'}
              </Button>
            </div>
            {paused && (
              <p className="border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] text-[var(--accent-yellow)]">
                {queueReasonText(group.state?.paused_reason)}
              </p>
            )}
            {group.tasks.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-[var(--text-secondary)]">La cola está vacía.</p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {group.tasks.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${QUEUE_STATUS_CLASSES[task.status]}`}>
                      {taskStatusLabel(task, group.state)}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-[13px] text-[var(--text-primary)]">{task.content}</span>
                    {task.last_error && <span className="w-full break-all text-[11px] text-[var(--accent-red)]">{task.last_error}</span>}
                    {task.status === 'pending' && (
                      <Button variant="ghost" size="sm" disabled={busy !== null}
                        aria-label={`Cancelar de la cola: ${task.content.slice(0, 60)}`}
                        onClick={() => onCancel(task)}>
                        <X size={11} /> Cancelar
                      </Button>
                    )}
                    {task.status === 'delivering' && (
                      <Button variant="ghost" size="sm" disabled={busy !== null}
                        aria-label={`Detener turno de la cola: ${task.content.slice(0, 60)}`}
                        onClick={() => onStop(task.session_id)}>
                        <Pause size={11} /> Detener
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
