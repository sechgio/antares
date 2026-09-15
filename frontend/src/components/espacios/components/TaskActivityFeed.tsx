import {
  ArrowRight,
  CalendarDays,
  CirclePlus,
  Flag,
  History,
  ListChecks,
  Loader2,
  MessageCircle,
  PencilLine,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import Button from '../../ui/Button';
import Textarea from '../../ui/Textarea';
import { useTaskActivity } from '../hooks/useTaskActivity';
import type { BoardColumn, TaskActivity, TeamMember } from '../types';
import { activityDescription } from '../utils/taskActivity';

const timeFormatter = new Intl.DateTimeFormat('es', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

interface TaskActivityFeedProps {
  tareaId: string;
  userId: string;
  members: TeamMember[];
  columns: BoardColumn[];
}

function personName(id: string | null, snapshot: string | null, members: TeamMember[]): string {
  if (!id) return snapshot ? `${snapshot} (usuario eliminado)` : 'Sistema';
  return members.find((member) => member.user_id === id)?.display_name ?? snapshot ?? 'Usuario eliminado';
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : timeFormatter.format(date);
}

function ActivityIcon({ activity }: { activity: TaskActivity }) {
  const className = 'mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]';
  if (activity.event_type === 'task_created') return <CirclePlus className={className} />;
  if (activity.field_name === 'status') return <ListChecks className={className} />;
  if (activity.field_name === 'priority') return <Flag className={className} />;
  if (activity.field_name === 'assignee_id') return <UserRound className={className} />;
  if (activity.field_name === 'start_date' || activity.field_name === 'due_date') {
    return <CalendarDays className={className} />;
  }
  return <PencilLine className={className} />;
}

export default function TaskActivityFeed({ tareaId, userId, members, columns }: TaskActivityFeedProps) {
  const feed = useTaskActivity(tareaId, userId);
  const [draft, setDraft] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || feed.sending) return;
    setLocalError(null);
    try {
      await feed.sendComment(body);
      setDraft('');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'No se pudo enviar el comentario');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <section className="mt-6 border-t border-[var(--border-subtle)] pt-5" aria-labelledby={`activity-${tareaId}`}>
      <div className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-[var(--text-muted)]" />
        <h3 id={`activity-${tareaId}`} className="text-sm font-semibold text-[var(--text-primary)]">Actividad</h3>
      </div>

      <form onSubmit={(event) => void submit(event)} className="mb-5">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribe un comentario…"
          rows={3}
          disabled={feed.sending}
          className="w-full resize-none bg-[var(--bg-surface)]"
        />
        {(localError || feed.sendError) && (
          <p role="alert" className="mb-2 text-xs text-[var(--accent-red)]">{localError || feed.sendError}</p>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] text-[var(--text-muted)]">Ctrl/Cmd + Enter</span>
          <Button type="submit" size="sm" disabled={feed.sending || !draft.trim()}>
            {feed.sending ? 'Enviando…' : 'Enviar'}
          </Button>
        </div>
      </form>

      {feed.loading && feed.timeline.length === 0 ? (
        <div className="flex items-center gap-2 py-3 text-xs text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando actividad…
        </div>
      ) : feed.error ? (
        <div className="rounded-xl border border-[var(--border-subtle)] p-3">
          <p role="alert" className="text-xs text-[var(--accent-red)]">{feed.error}</p>
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => void feed.retry()}>
            <RefreshCw className="h-3.5 w-3.5" /> Reintentar
          </Button>
        </div>
      ) : feed.timeline.length === 0 ? (
        <p className="py-3 text-xs text-[var(--text-muted)]">Aún no hay actividad en esta tarea.</p>
      ) : (
        <ol className="space-y-3">
          {feed.timeline.map((item) => {
            if (item.kind === 'comment') {
              return (
                <li key={`comment-${item.id}`} className="flex gap-3">
                  <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-primary)]" />
                  <div className="min-w-0 flex-1 rounded-xl bg-[var(--bg-surface)] px-3 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--text-primary)]">
                        {personName(item.comment.author_id, item.comment.author_name, members)}
                      </span>
                      <time className="text-[10px] text-[var(--text-muted)]">{formatTime(item.createdAt)}</time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--text-secondary)]">{item.comment.body}</p>
                  </div>
                </li>
              );
            }
            const description = activityDescription(item.activity, members, columns);
            return (
              <li key={`activity-${item.id}`} className="flex gap-3">
                <ActivityIcon activity={item.activity} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xs text-[var(--text-secondary)]">
                      <span className="font-semibold text-[var(--text-primary)]">
                        {personName(item.activity.actor_id, item.activity.actor_name, members)}
                      </span>{' '}
                      {description.label.toLocaleLowerCase('es')}
                    </p>
                    <time className="text-[10px] text-[var(--text-muted)]">{formatTime(item.createdAt)}</time>
                  </div>
                  {description.oldValue !== undefined && description.newValue !== undefined && (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                      <span className="truncate">{description.oldValue}</span>
                      <ArrowRight className="h-3 w-3 shrink-0" />
                      <span className="truncate text-[var(--text-secondary)]">{description.newValue}</span>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
