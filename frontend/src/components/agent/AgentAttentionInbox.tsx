import { useCallback, useEffect, useId, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { agentApi, type AgentSession, type AgentTask } from '../../api/agentApi';
import { useToast } from '../../hooks/useToast';
import { errorMessage } from '../../utils/errors';
import Button from '../ui/Button';
import { DialogSurface } from '../ui/Dialog';
import { TaskReplyBox } from './AgentQueuePanel';
import { STATUS_LABELS } from './ScheduledTaskHistory';

export default function AgentAttentionInbox({
  sessions,
  onClose,
  onOpenTask,
}: {
  sessions: AgentSession[];
  onClose: () => void;
  onOpenTask: (task: AgentTask) => void;
}) {
  const title = useId();
  const { addToast } = useToast();
  const [tasks, setTasks] = useState<AgentTask[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTasks((await agentApi.agentTasksList()).tasks);
    } catch (error) {
      setTasks((current) => current ?? []);
      addToast({ message: errorMessage(error, 'No se pudieron leer los encargos'), type: 'error' });
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const actOnTask = async (action?: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action?.();
      await load();
    } catch (error) {
      addToast({ message: errorMessage(error, 'No se pudo actualizar el encargo'), type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const attention = tasks
    ?.filter((task) => task.status === 'needs_input' || task.status === 'to_verify' || task.status === 'blocked')
    .sort((a, b) => (b.updated_at ?? b.created_at) - (a.updated_at ?? a.created_at));
  const sessionName = (id: string) => {
    const session = sessions.find((item) => item.id === id);
    return [session?.profile?.name, session?.title || 'Conversación'].filter(Boolean).join(' · ');
  };

  return (
    <DialogSurface portal labelledBy={title} onClose={onClose} className="max-w-2xl p-4">
      <header className="mb-3 flex items-center gap-2">
        <h2 id={title} className="flex-1 text-sm font-semibold">
          Encargos por atender
        </h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void actOnTask()}
          aria-label="Actualizar encargos"
          disabled={busy}
        >
          <RefreshCw size={14} />
        </Button>
        <Button size="sm" variant="ghost" aria-label="Cerrar encargos por atender" onClick={onClose}>
          <X size={14} />
        </Button>
      </header>
      {(!attention || !attention.length) && (
        <p role="status" className="text-sm text-[var(--text-secondary)]">
          {attention ? 'No hay encargos por atender.' : 'Cargando encargos…'}
        </p>
      )}
      <ul className="max-h-[65vh] space-y-2 overflow-y-auto">
        {attention?.map((task) => {
          const origin = tasks?.find((item) => item.id === task.origin_task_id);
          return (
            <li key={task.id} className="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3 text-sm">
              <p className="text-xs text-[var(--text-secondary)]">
                {sessionName(task.session_id)} · {STATUS_LABELS[task.status]}
              </p>
              <p className="break-words font-medium">{task.content}</p>
              {task.output && (
                <p className="whitespace-pre-wrap break-words text-[var(--text-secondary)]">{task.output}</p>
              )}
              {task.last_error && <p className="break-words text-[var(--accent-red)]">{task.last_error}</p>}
              {task.status === 'needs_input' && (
                <TaskReplyBox
                  question={task.question}
                  busy={busy}
                  onSubmit={(text) => void actOnTask(() => agentApi.agentTasksRespond(task.id, text))}
                />
              )}
              <div className="flex flex-wrap items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => onOpenTask(task)}>
                  Abrir conversación
                </Button>
                {origin && (
                  <Button variant="ghost" size="sm" onClick={() => onOpenTask(origin)}>
                    Ir a la solicitud
                  </Button>
                )}
                {task.status === 'to_verify' && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void actOnTask(() => agentApi.agentTasksVerify(task.id))}
                  >
                    Marcar verificado
                  </Button>
                )}
                {task.status === 'blocked' && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void actOnTask(() => agentApi.agentTasksRun(task.id))}
                  >
                    Volver a ejecutar
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </DialogSurface>
  );
}
