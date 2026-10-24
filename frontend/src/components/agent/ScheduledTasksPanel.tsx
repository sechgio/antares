import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Pause, Pencil, Play, Plus, RefreshCw, X } from 'lucide-react';
import {
  agentApi, type AgentSession, type AgentTask, type AgentTaskRun, type AgentTaskStatus,
} from '../../api/agentApi';
import { errorMessage } from '../../utils/errors';
import { useDialog } from '../../hooks/useDialog';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import ThemedSelect from '../ui/ThemedSelect';

const STATUS_LABELS: Record<AgentTaskStatus, string> = {
  pending: 'Programado',
  delivering: 'Entregando',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  uncertain: 'Incierto',
};

const STATUS_CLASSES: Record<AgentTaskStatus, string> = {
  pending: 'bg-[color-mix(in_srgb,var(--accent-primary)_10%,transparent)] text-[var(--accent-primary)]',
  delivering: 'bg-[color-mix(in_srgb,var(--accent-yellow)_14%,transparent)] text-[var(--accent-yellow)]',
  delivered: 'bg-[color-mix(in_srgb,var(--accent-green)_12%,transparent)] text-[var(--accent-green)]',
  cancelled: 'bg-[var(--bg-input)] text-[var(--text-muted)]',
  uncertain: 'bg-[color-mix(in_srgb,var(--accent-red)_10%,transparent)] text-[var(--accent-red)]',
};

const RUN_LABELS: Record<AgentTaskRun['status'], string> = {
  delivered: 'Entregado',
  failed: 'Falló',
  uncertain: 'Incierto',
};

type TaskForm = {
  id?: string;
  sessionId: string;
  content: string;
  due: string;
  every: string;
  silent: boolean;
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function toLocalInput(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function formatMoment(ms: number | undefined, timezone?: string): string {
  if (!ms) return '—';
  try {
    return new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(ms);
  } catch {
    return new Date(ms).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
  }
}

function repeatText(ms: number): string {
  if (!ms) return 'Una vez';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `Cada ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `Cada ${hours} h` : `Cada ${Math.round(hours / 24)} días`;
}

export default function ScheduledTasksPanel({ sessions, sessionId, onClose }: {
  sessions: AgentSession[];
  sessionId?: string;
  onClose: () => void;
}) {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState(sessionId || '');
  const [form, setForm] = useState<TaskForm | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTasks((await agentApi.agentTasksList()).tasks);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron leer los encargos programados'), type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const sessionOptions = useMemo(() => [
    { value: '', label: 'Todas las conversaciones' },
    ...sessions.map((session) => ({ value: session.id, label: session.title || 'Conversación' })),
  ], [sessions]);

  const visible = useMemo(() => tasks
    .filter((task) => !sessionFilter || task.session_id === sessionFilter)
    .sort((a, b) => Number(a.due_at) - Number(b.due_at)), [tasks, sessionFilter]);

  const createTask = () => {
    const target = sessionFilter || sessionId || sessions[0]?.id || '';
    setForm({ sessionId: target, content: '', due: toLocalInput(Date.now() + 10 * 60000), every: '', silent: false });
  };

  const editTask = (task: AgentTask) => {
    setForm({
      id: task.id,
      sessionId: task.session_id,
      content: task.content,
      due: toLocalInput(task.due_at),
      every: task.interval_ms ? String(Math.round(task.interval_ms / 60000)) : '',
      silent: !!task.silent,
    });
  };

  const save = async () => {
    if (!form) return;
    const content = form.content.trim();
    const due = new Date(form.due);
    const every = form.every.trim() ? Number(form.every.trim()) : null;
    if (!form.sessionId || !content || Number.isNaN(due.getTime())) {
      addToast({ message: 'Indica la conversación, el encargo y una fecha válida', type: 'error' });
      return;
    }
    if (every !== null && (!Number.isInteger(every) || every < 1 || every > 525600)) {
      addToast({ message: 'La repetición debe estar entre 1 y 525600 minutos', type: 'error' });
      return;
    }
    setBusy('save');
    try {
      await agentApi.agentTasksSave({
        session_id: form.sessionId,
        ...(form.id ? { id: form.id } : {}),
        content,
        due_at: due.toISOString(),
        every_minutes: every,
        silent: form.silent,
        timezone: localTimezone(),
      });
      setForm(null);
      await load();
      addToast({ message: form.id ? 'Encargo actualizado' : 'Encargo programado', type: 'success' });
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo guardar el encargo'), type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const run = async (task: AgentTask) => {
    setBusy(task.id);
    try {
      await agentApi.agentTasksRun(task.id);
      await load();
      addToast({ message: 'Encargo enviado a ejecutar', type: 'success' });
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo ejecutar el encargo'), type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (task: AgentTask) => {
    const ok = await confirm({
      title: 'Cancelar encargo',
      description: `Se cancelará «${task.content.slice(0, 120)}». No se enviará de nuevo.`,
      confirmLabel: 'Cancelar encargo',
      cancelLabel: 'Conservar',
      type: 'destructive',
    });
    if (!ok) return;
    setBusy(task.id);
    try {
      await agentApi.agentTasksCancel(task.id);
      await load();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo cancelar el encargo'), type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      data-testid="agent-tasks-overlay"
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-base)_88%,transparent)] p-4 backdrop-blur-sm"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Encargos programados"
        className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-base)] shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
      >
        <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
          <div className="flex size-9 items-center justify-center rounded-lg border border-[var(--accent-primary)] text-[var(--accent-primary)]">
            <CalendarClock size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Encargos programados</h2>
            <p className="text-[12px] text-[var(--text-secondary)]">
              Se ejecutan mientras Antares siga abierto, incluso en la bandeja. Al volver a abrir, los atrasados se entregan una sola vez;
              si el cierre interrumpió una entrega, no se repite y queda como incierta.
            </p>
          </div>
          <Button variant="ghost" size="none" className="flex size-7 items-center justify-center" aria-label="Cerrar encargos programados" onClick={onClose}>
            <X size={15} />
          </Button>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-5 py-3">
          <div className="w-56"><ThemedSelect aria-label="Filtrar encargos por conversación" value={sessionFilter}
            onChange={setSessionFilter} options={sessionOptions} /></div>
          <span className="min-w-0 flex-1 text-[12px] text-[var(--text-secondary)]">{visible.length} encargo{visible.length === 1 ? '' : 's'}</span>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} aria-label="Actualizar encargos">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualizar
          </Button>
          <Button size="sm" onClick={createTask} disabled={!sessions.length}>
            <Plus size={13} /> Nuevo encargo
          </Button>
        </div>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {form && (
            <form
              className="mb-3 space-y-3 rounded-xl border border-[var(--accent-primary)] bg-[var(--bg-surface)] p-3"
              onSubmit={(event) => { event.preventDefault(); void save(); }}
            >
              <div className="flex items-center gap-2">
                <h3 className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--text-primary)]">
                  {form.id ? 'Editar encargo' : 'Nuevo encargo'}
                </h3>
                <Button variant="ghost" size="none" className="flex size-6 items-center justify-center"
                  aria-label="Descartar borrador" onClick={() => setForm(null)}><X size={13} /></Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-[12px] text-[var(--text-secondary)]">
                  Conversación
                  <ThemedSelect aria-label="Conversación del encargo" value={form.sessionId} disabled={!!form.id}
                    onChange={(value) => setForm({ ...form, sessionId: value })} options={sessions.map((session) => ({
                      value: session.id, label: session.title || 'Conversación',
                    }))} />
                </label>
                <label className="space-y-1 text-[12px] text-[var(--text-secondary)]">
                  Fecha y hora
                  <Input type="datetime-local" aria-label="Fecha y hora" required value={form.due}
                    onChange={(event) => setForm({ ...form, due: event.target.value })} className="w-full" />
                </label>
              </div>
              <label className="block space-y-1 text-[12px] text-[var(--text-secondary)]">
                Contenido
                <Textarea aria-label="Contenido del encargo" required rows={3} maxLength={12000} value={form.content}
                  onChange={(event) => setForm({ ...form, content: event.target.value })} className="w-full" />
              </label>
              <div className="grid items-end gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-[12px] text-[var(--text-secondary)]">
                  Repetir cada (minutos)
                  <Input type="number" min={1} max={525600} aria-label="Repetición en minutos" value={form.every}
                    onChange={(event) => setForm({ ...form, every: event.target.value })} placeholder="Una sola vez" className="w-full" />
                </label>
                <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                  <input type="checkbox" aria-label="Sin aviso al iniciar" checked={form.silent}
                    onChange={(event) => setForm({ ...form, silent: event.target.checked })} />
                  Sin aviso al iniciar (token de silencio)
                </label>
              </div>
              <p className="text-[11px] text-[var(--text-muted)]">Zona horaria: {localTimezone()}</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" type="button" onClick={() => setForm(null)}>Cancelar</Button>
                <Button size="sm" type="submit" disabled={busy !== null}>{form.id ? 'Guardar cambios' : 'Programar encargo'}</Button>
              </div>
            </form>
          )}

          {loading ? (
            <p className="py-8 text-center text-[13px] text-[var(--text-secondary)]">Cargando encargos…</p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-[var(--text-secondary)]">No hay encargos programados.</p>
          ) : (
            <ul className="space-y-2" aria-label="Lista de encargos programados">
              {visible.map((task) => {
                const runs = [...(task.runs || [])].reverse();
                return (
                  <li key={task.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_CLASSES[task.status]}`}>
                        {STATUS_LABELS[task.status]}
                      </span>
                      <span className="min-w-0 flex-1 break-words text-[13px] font-medium text-[var(--text-primary)]">{task.content}</span>
                      <span className="max-w-48 truncate text-[11px] text-[var(--text-muted)]">
                        {sessions.find((session) => session.id === task.session_id)?.title || task.session_id}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 text-[11px] text-[var(--text-secondary)]">
                      <span>{formatMoment(task.due_at, task.timezone)} · {task.timezone || localTimezone()}</span>
                      <span>{repeatText(task.interval_ms)}</span>
                      {task.silent && <span className="text-[var(--accent-yellow)]">Silencioso</span>}
                      {task.last_error && <span className="break-all text-[var(--accent-red)]">{task.last_error}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1 border-t border-[var(--border-subtle)] px-2 py-1.5">
                      {task.status !== 'delivering' && task.status !== 'cancelled' && task.status !== 'delivered' && (
                        <Button variant="ghost" size="sm" aria-label={`Ejecutar ahora: ${task.content.slice(0, 60)}`}
                          disabled={busy !== null} onClick={() => void run(task)}>
                          <Play size={12} /> Ejecutar ahora
                        </Button>
                      )}
                      {task.status === 'pending' && (
                        <Button variant="ghost" size="sm" aria-label={`Editar encargo: ${task.content.slice(0, 60)}`}
                          disabled={busy !== null} onClick={() => editTask(task)}>
                          <Pencil size={12} /> Editar
                        </Button>
                      )}
                      {task.status !== 'cancelled' && task.status !== 'delivered' && (
                        <Button variant="ghost" size="sm" aria-label={`Cancelar encargo: ${task.content.slice(0, 60)}`}
                          disabled={busy !== null} onClick={() => void cancel(task)}>
                          <Pause size={12} /> Cancelar
                        </Button>
                      )}
                      <span className="flex-1" />
                      <Button variant="ghost" size="sm" aria-label={`Historial de ejecuciones: ${task.content.slice(0, 60)}`}
                        onClick={() => setExpanded((current) => current === task.id ? null : task.id)}>
                        {expanded === task.id ? 'Ocultar historial' : `Historial (${runs.length})`}
                      </Button>
                    </div>
                    {expanded === task.id && (
                      <div className="border-t border-[var(--border-subtle)] px-3 py-2">
                        {runs.length === 0 ? <p className="text-[12px] text-[var(--text-secondary)]">Todavía no se ejecutó.</p> : (
                          <ul className="space-y-1">
                            {runs.map((run, index) => (
                              <li key={`${run.at}-${index}`} className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                                <span className={run.status === 'delivered' ? 'text-[var(--accent-green)]'
                                  : run.status === 'uncertain' ? 'text-[var(--accent-red)]' : 'text-[var(--accent-yellow)]'}>
                                  {RUN_LABELS[run.status]}
                                </span>
                                <span>{formatMoment(run.at, task.timezone)}</span>
                                {run.error && <span className="min-w-0 flex-1 break-all">{run.error}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
