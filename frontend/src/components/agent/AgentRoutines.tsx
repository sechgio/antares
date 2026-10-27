import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { agentApi, type AgentSession, type AgentTask } from '../../api/agentApi';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import Input from '../ui/Input';

const MAX_ROUTINES = 3;

function everyText(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes % 1440 === 0) return minutes === 1440 ? 'cada día' : `cada ${minutes / 1440} días`;
  if (minutes % 60 === 0) return minutes === 60 ? 'cada hora' : `cada ${minutes / 60} h`;
  return `cada ${minutes} min`;
}

export default function AgentRoutines({ profileId }: { profileId: string }) {
  const { addToast } = useToast();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [routines, setRoutines] = useState<AgentTask[]>([]);
  const [content, setContent] = useState('');
  const [minutes, setMinutes] = useState('1440');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ sessions: all }, { tasks }] = await Promise.all([agentApi.agentSessionsList(), agentApi.agentTasksList()]);
    const own = all.filter((session) => session.profile?.id === profileId).sort((a, b) => b.updated_at - a.updated_at);
    const ids = new Set(own.map((session) => session.id));
    setSessions(own);
    setRoutines(tasks.filter((task) => task.kind !== 'queue' && task.interval_ms > 0 && ids.has(task.session_id)
      && (task.status === 'pending' || task.status === 'delivering')));
  }, [profileId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const add = async () => {
    const every = Number(minutes);
    if (busy || !content.trim() || !sessions.length || !Number.isInteger(every) || every < 1) return;
    setBusy(true);
    try {
      await agentApi.agentTasksSave({
        session_id: sessions[0].id, content: content.trim(), every_minutes: every,
        due_at: new Date(Date.now() + every * 60000).toISOString(),
      });
      setContent('');
      await load();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo crear la rutina'), type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    try {
      await agentApi.agentTasksCancel(id);
      await load();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo cancelar la rutina'), type: 'error' });
    }
  };

  const full = routines.length >= MAX_ROUTINES;
  return (
    <div className="mt-3 space-y-2 rounded-2xl bg-[var(--bg-base)] px-3 py-2.5">
      <p className="text-[13px] text-[var(--text-primary)]">Rutinas</p>
      {routines.length > 0 && (
        <ul className="space-y-1" aria-label="Rutinas del agente">
          {routines.map((task) => (
            <li key={task.id} className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <span className="min-w-0 flex-1 truncate" title={task.content}>{task.content}</span>
              <span className="shrink-0 text-[var(--text-muted)]">{everyText(task.interval_ms)}</span>
              <Button variant="ghost" size="sm" aria-label={`Cancelar rutina: ${task.content.slice(0, 60)}`} onClick={() => void cancel(task.id)}>
                <X size={12} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!sessions.length ? (
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">Abre una conversación con este agente para programarle rutinas.</p>
      ) : full ? (
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">El agente ya tiene {MAX_ROUTINES} rutinas; cancela alguna para crear otra.</p>
      ) : (
        <div className="flex items-center gap-2">
          <Input value={content} onChange={(e) => setContent(e.target.value)} maxLength={12000} aria-label="Encargo de la rutina"
            placeholder="Por ejemplo, resume los correos del día" className="min-w-0 flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} />
          <Input type="number" inputMode="numeric" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)}
            aria-label="Repetir cada (minutos)" className="w-20" />
          <Button variant="ghost" size="sm" disabled={busy || !content.trim()} onClick={() => void add()}>Añadir</Button>
        </div>
      )}
      <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
        Se ejecutan en su conversación más reciente, con su presupuesto y sus permisos. Máximo {MAX_ROUTINES}; las que programe el propio agente se repiten como mucho cada 30 minutos.
      </p>
    </div>
  );
}
