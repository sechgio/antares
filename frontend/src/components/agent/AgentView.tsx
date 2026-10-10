import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Square, Wrench, X } from 'lucide-react';
import { agentApi, type AgentApproval, type AgentMessage, type AgentSession, type AgentToolSpec } from '../../api/agentApi';
import { aiProvidersApi, type AiProviderSpec } from '../../api/aiProvidersApi';
import { errorMessage } from '../../utils/errors';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ThemedSelect from '../ui/ThemedSelect';
import AgentAvatar from './AgentAvatar';
import { ApprovalCard, MessageRow, ThinkingRow, ToolGroup } from './AgentTimeline';

const POLL_MS = 1500;
const SESSION_KEY = 'antares-agent-session';
const QUEUE_KEY = 'antares-agent-queue';

const SUGGESTIONS = [
  '¿Qué flujos tengo configurados y cuáles están activos?',
  'Resume el estado de mis conexiones externas.',
  '¿Qué ejecuciones recientes fallaron y por qué?',
];

function relTime(ms?: number): string {
  if (!ms) return '';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'ahora';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

function SessionRow({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: AgentSession;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group flex h-[54px] shrink-0 items-center gap-2.5 rounded-xl p-1.5 transition-colors ${
        active
          ? 'bg-[var(--bg-elevated)]'
          : 'hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)]'
      }`}
    >
      <AgentAvatar seed={session.id} name={session.title || 'Conversación'} size={40} className="shrink-0" />
      <button type="button" className="flex min-w-0 flex-1 flex-col gap-0.5 text-left" onClick={onSelect}>
        <span className="flex min-w-0 items-center gap-1.5">
          {session.last_error && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-yellow)]"
              title={session.last_error}
            />
          )}
          <span className={`truncate text-[13px] text-[var(--text-primary)] ${active ? 'font-medium' : ''}`}>
            {session.title || 'Conversación'}
          </span>
        </span>
        <span className="truncate text-[11px] text-[var(--text-muted)]">
          {session.provider} · {session.model} · {relTime(session.updated_at)}
        </span>
      </button>
      <button
        type="button"
        className="invisible shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--accent-red)] group-hover:visible"
        aria-label="Eliminar conversación"
        title="Eliminar"
        onClick={onDelete}
      >
        <X size={13} />
      </button>
    </div>
  );
}

export default function AgentView({ initialDraft, onConfigureProvider }: { active?: boolean; initialDraft?: string; onConfigureProvider?: () => void }) {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [providers, setProviders] = useState<AiProviderSpec[]>([]);
  const [tools, setTools] = useState<AgentToolSpec[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [pending, setPending] = useState<AgentApproval[]>([]);
  const [running, setRunning] = useState(false);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [queued, setQueued] = useState<{ session: string; text: string; failed?: boolean }[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      return Array.isArray(saved) ? saved.filter((item) => item && typeof item.session === 'string' && typeof item.text === 'string')
        .map((item) => ({ session: item.session, text: item.text, failed: true })) : [];
    } catch { return []; }
  });
  const [stopping, setStopping] = useState(false);
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const wantedRef = useRef<{ id: string; silent: boolean } | null>(null);
  const messagesVersionRef = useRef(new Map<string, { version: number; pending: number }>());
  const sessionIdRef = useRef('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const toolsMenu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    align: 'end',
    estimatedWidth: 300,
    estimatedHeight: 320,
    maxHeightCap: 400,
    stopEscapePropagation: true,
  });

  useEffect(() => {
    if (initialDraft) setDraft(initialDraft);
  }, [initialDraft]);

  useEffect(() => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queued));
  }, [queued]);

  const loadMessages = useCallback(
    async (id: string, silent = true) => {
      const request = { id, silent };
      wantedRef.current = request;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const version = messagesVersionRef.current.get(id)?.version ?? 0;
      try {
        const res = await agentApi.agentMessagesList(id);
        const current = messagesVersionRef.current.get(id);
        if (id === sessionIdRef.current && version === (current?.version ?? 0) && !current?.pending) {
          setMessages(res.messages);
          setPending(res.pending_approvals);
          setRunning(res.running);
        }
      } catch (err) {
        if (!silent) {
          addToast({ message: errorMessage(err, 'No se pudieron cargar los mensajes'), type: 'error' });
        }
      } finally {
        inFlightRef.current = false;
        const wanted = wantedRef.current;
        if (wanted && wanted !== request) void loadMessages(wanted.id, wanted.silent);
      }
    },
    [addToast],
  );

  const refreshSessions = useCallback(async () => {
    try {
      const res = await agentApi.agentSessionsList();
      setSessions(res.sessions);
      return res.sessions;
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron cargar las conversaciones'), type: 'error' });
      return [];
    }
  }, [addToast]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await aiProvidersApi.aiProvidersList();
        setProviders(res.providers);
        const ready = res.providers.find((p) => p.configured && !p.needs_key) ?? res.providers.find((p) => p.has_key);
        if (ready) {
          setProvider(ready.id);
          setModel(ready.default_model);
        }
      } catch (err) {
        addToast({ message: errorMessage(err, 'No se pudieron cargar los proveedores'), type: 'error' });
      }
      try {
        const res = await agentApi.agentToolsList();
        setTools(res.tools);
      } catch {
        setTools([]); // la tarjeta de herramientas es informativa; no bloquea el chat
      }
      const restored = await refreshSessions();
      const saved = localStorage.getItem(SESSION_KEY);
      if (restored.some((s) => s.id === saved)) setSessionId(saved || '');
    })();
  }, [addToast, refreshSessions]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    if (sessionId) localStorage.setItem(SESSION_KEY, sessionId);
    setMessages([]);
    setPending([]);
    if (sessionId) void loadMessages(sessionId, false);
    else setRunning(false);
  }, [sessionId, loadMessages]);

  useEffect(() => {
    const active = Boolean(sessionId) && (running || pending.length > 0);
    if (active && timerRef.current == null) {
      timerRef.current = window.setInterval(() => {
        void loadMessages(sessionId);
      }, POLL_MS);
    }
    if (!active && timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessionId, running, pending.length, loadMessages]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, messages[messages.length - 1]?.content, pending.length]);

  useEffect(() => {
    if (!running) {
      setRunningSince(null);
      setElapsed(0);
      return;
    }
    setRunningSince((prev) => prev ?? Date.now());
  }, [running]);

  useEffect(() => {
    if (runningSince == null) return;
    const tick = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - runningSince) / 1000)));
    }, 1000);
    return () => window.clearInterval(tick);
  }, [runningSince]);

  useEffect(() => {
    const ta = draftRef.current;
    if (ta) {
      ta.style.height = '0px';
      ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
    }
  }, [draft]);

  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const queuedForSession = queued.filter((i) => i.session === sessionId);
  const readyProviders = providers.filter((p) => p.configured && (!p.needs_key || p.has_key));
  const providerLabel = providers.find((p) => p.id === provider)?.label ?? provider;
  const sessionProviderLabel = session
    ? (providers.find((p) => p.id === session.provider)?.label ?? session.provider)
    : '';
  const toolGroups = useMemo(
    () => ({
      direct: tools.filter((t) => !t.gated).map((t) => t.name),
      gated: tools.filter((t) => t.gated && t.kind !== 'mcp').map((t) => t.name),
      mcp: tools.filter((t) => t.kind === 'mcp').map((t) => t.name),
    }),
    [tools],
  );
  const toolCount = toolGroups.direct.length + toolGroups.gated.length + toolGroups.mcp.length;
  const visibleSessions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((s) => (s.title || 'Conversación').toLowerCase().includes(query));
  }, [sessions, search]);

  const newSession = async () => {
    if (!provider) {
      addToast({ message: 'Elige un proveedor IA', type: 'error' });
      return null;
    }
    try {
      const res = await agentApi.agentSessionCreate({ provider, model: model || undefined });
      await refreshSessions();
      setSessionId(res.session.id);
      return res.session.id;
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo crear la conversación'), type: 'error' });
      return null;
    }
  };

  const removeSession = async (id: string) => {
    const target = sessions.find((s) => s.id === id);
    const ok = await confirm({
      title: 'Eliminar conversación',
      description: `Se eliminará "${target?.title || 'Conversación'}" y todo su historial. Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
      type: 'destructive',
    });
    if (!ok) return;
    try {
      await agentApi.agentSessionDelete(id);
      setQueued((q) => q.filter((i) => i.session !== id));
      if (sessionId === id) {
        setSessionId('');
        localStorage.removeItem(SESSION_KEY);
      }
      addToast({ message: 'Conversación eliminada', type: 'success' });
      await refreshSessions();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo eliminar la conversación'), type: 'error' });
    }
  };

  const sendToSession = async (id: string, content: string): Promise<boolean> => {
    const state = messagesVersionRef.current.get(id) ?? { version: 0, pending: 0 };
    messagesVersionRef.current.set(id, state);
    state.version += 1;
    state.pending += 1;
    if (id === sessionIdRef.current) setRunning(true);
    try {
      await agentApi.agentMessageSend(id, content).finally(() => { state.pending -= 1; });
      state.version += 1;
      void refreshSessions();
      await loadMessages(id);
      return true;
    } catch (err) {
      if (id === sessionIdRef.current) setRunning(false);
      addToast({ message: errorMessage(err, 'No se pudo enviar el mensaje'), type: 'error' });
      return false;
    }
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || !sessionId) return;
    setDraft('');
    if (running || pending.length > 0) {
      setQueued((q) => [...q, { session: sessionId, text: content }]);
      return;
    }
    const ok = await sendToSession(sessionId, content);
    if (!ok) setDraft((prev) => (prev.trim() ? prev : content));
  };

  // Envía el siguiente mensaje en cola cuando el turno termina y no quedan aprobaciones.
  useEffect(() => {
    if (!sessionId || running || stopping || pending.length > 0) return;
    const next = queued.find((i) => i.session === sessionId && !i.failed);
    if (!next) return;
    const sending = { ...next, failed: true };
    setQueued((q) => q.map((i) => i === next ? sending : i));
    void (async () => {
      const ok = await sendToSession(sessionId, next.text);
      if (ok) setQueued((q) => q.filter((i) => i !== sending));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, running, stopping, pending.length, queued]);

  const sendSuggestion = async (text: string) => {
    const id = sessionId || (await newSession());
    if (id) void sendToSession(id, text);
  };

  const cancelTurn = async () => {
    if (!sessionId) return;
    setStopping(true);
    setQueued((q) => q.map((item) => item.session === sessionId ? { ...item, failed: true } : item));
    try {
      await agentApi.agentTurnCancel(sessionId);
      await loadMessages(sessionId);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo detener el turno'), type: 'error' });
    } finally {
      setStopping(false);
    }
  };

  const decide = async (id: string, ok: boolean) => {
    setDeciding(true);
    try {
      if (ok) await agentApi.agentApprove(id);
      else await agentApi.agentDeny(id);
      await loadMessages(sessionId);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo aplicar la decisión'), type: 'error' });
    } finally {
      setDeciding(false);
    }
  };

  const showHero = !sessionId || messages.length === 0;

  return (
    <div className="flex h-full min-h-0 gap-2.5 bg-[var(--bg-base)] p-2.5">
      <aside className="flex h-full w-[252px] shrink-0 flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
        <div className="flex shrink-0 items-center gap-1.5 px-0.5 pt-0.5">
          <Button
            variant="primary"
            size="none"
            className="flex size-9 shrink-0 items-center justify-center rounded-full"
            onClick={() => void newSession()}
            aria-label="Nueva conversación"
            title="Nueva conversación"
          >
            <Plus size={16} />
          </Button>
          <label className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 transition-colors focus-within:border-[var(--border-medium)]">
            <Search size={13} className="shrink-0 text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversaciones…"
              aria-label="Buscar conversaciones"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
            {search && (
              <button
                type="button"
                className="shrink-0 rounded-full p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                aria-label="Limpiar búsqueda"
                onClick={() => setSearch('')}
              >
                <X size={12} />
              </button>
            )}
          </label>
        </div>

        <div className="custom-scrollbar mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {sessions.length === 0 && (
            <p className="px-2.5 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
              Sin conversaciones. Pulsa + para empezar.
            </p>
          )}
          {sessions.length > 0 && visibleSessions.length === 0 && (
            <p className="px-2.5 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
              Sin resultados para «{search.trim()}».
            </p>
          )}
          {visibleSessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              active={s.id === sessionId}
              onSelect={() => setSessionId(s.id)}
              onDelete={() => void removeSession(s.id)}
            />
          ))}
        </div>

        {onConfigureProvider && (
          <footer className="mt-1.5 shrink-0 border-t border-[var(--border-subtle)] pt-1.5">
            <button
              type="button"
              onClick={onConfigureProvider}
              className="flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)] hover:text-[var(--text-primary)]"
            >
              <Settings2 size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">Proveedores de IA</span>
            </button>
          </footer>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {session && (
          <header className="flex shrink-0 items-center gap-2 px-3 pt-3">
            <div className="flex h-[31px] min-w-0 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] pl-1 pr-3">
              <AgentAvatar seed={session.id} name={session.title || 'Conversación'} size={22} className="shrink-0" />
              <span className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                {session.title || 'Conversación'}
              </span>
            </div>
            <span className="min-w-0 flex-1" />
            <Button
              ref={toolsMenu.triggerRef}
              variant="none"
              size="none"
              aria-label="Herramientas del agente"
              aria-haspopup="dialog"
              aria-expanded={toolsMenu.isOpen}
              title="Herramientas del agente"
              onClick={toolsMenu.toggle}
              className="relative flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <Wrench size={14} />
              {toolCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--accent-primary)] px-0.5 text-[8px] font-semibold text-[var(--text-on-accent)]">
                  {toolCount}
                </span>
              )}
            </Button>
          </header>
        )}

        <div ref={listRef} className="custom-scrollbar flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {showHero ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
              <AgentAvatar
                seed={session?.id ?? 'antares-agent'}
                name={session?.title || 'Agente de Antares'}
                size={88}
              />
              <div>
                <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                  {sessionId ? '¿En qué trabajamos hoy?' : 'Agente de Antares'}
                </h2>
                <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  {readyProviders.length === 0
                    ? 'Configura un proveedor en «Proveedores IA» para empezar.'
                    : 'Conversa con la app: consulta su estado con herramientas de lectura y aprueba cada acción con efectos antes de que se ejecute.'}
                </p>
              </div>
              {readyProviders.length === 0 && onConfigureProvider && (
                <Button size="sm" onClick={onConfigureProvider}>Configurar IA</Button>
              )}
              {readyProviders.length > 0 && !sessionId && (
                <div className="w-full max-w-sm space-y-1.5 text-left">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    Proveedor para la conversación
                  </p>
                  <ThemedSelect
                    value={provider}
                    onChange={(v) => {
                      setProvider(v);
                      const p = providers.find((x) => x.id === v);
                      if (p?.default_model) setModel(p.default_model);
                    }}
                    options={providers.map((p) => ({ value: p.id, label: p.label }))}
                    aria-label="Proveedor IA"
                    placeholder="Proveedor…"
                  />
                  <Input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Modelo (opcional)"
                    spellCheck={false}
                    aria-label="Modelo"
                    className="w-full"
                  />
                  <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
                    Se aplican a la próxima conversación. Las claves se guardan cifradas en este equipo.
                  </p>
                </div>
              )}
              {readyProviders.length > 0 && (
                <div className="w-full max-w-sm space-y-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    Sugerencias
                  </p>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      className="flex w-full items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
                      onClick={() => void sendSuggestion(s)}
                    >
                      <Sparkles size={12} className="shrink-0 text-[var(--accent-primary-hover)]" />
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            messages.map((m, i) => <MessageRow key={`${m.ts}-${i}`} msg={m} />)
          )}
          {pending.map((a) => (
            <ApprovalCard key={a.id} approval={a} busy={deciding} onDecide={(id, ok) => void decide(id, ok)} />
          ))}
          {running && <ThinkingRow elapsedSeconds={elapsed} />}
        </div>

        <div className="shrink-0 p-3">
          {queuedForSession.length > 0 && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                En cola
              </span>
              {queuedForSession.map((item, idx) => (
                <span
                  key={`${idx}-${item.text}`}
                  className="flex max-w-[70%] items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-0.5 pl-2.5 pr-1 text-[11px] text-[var(--text-secondary)]"
                >
                  {item.failed ? (
                    <button
                      type="button"
                      className="truncate text-[var(--accent-yellow)]"
                      title="Mensaje pendiente — clic para enviar"
                      onClick={() =>
                        setQueued((q) => q.map((i) => (i === item ? { ...i, failed: false } : i)))
                      }
                    >
                      {item.text}
                    </button>
                  ) : (
                    <span className="truncate">{item.text}</span>
                  )}
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                    aria-label="Quitar de la cola"
                    title="Quitar de la cola"
                    onClick={() => setQueued((q) => q.filter((i) => i !== item))}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="rounded-[22px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2.5 shadow-[0_1px_0.5px_rgba(0,0,0,0.02),0_4px_2px_rgba(0,0,0,0.02)] transition-colors focus-within:border-[var(--border-medium)]">
            <textarea
              ref={draftRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={
                !sessionId
                  ? 'Crea una conversación primero'
                  : running || pending.length > 0
                    ? 'Escribe para cuando termine…'
                    : 'Escribe un mensaje…'
              }
              disabled={!sessionId}
              aria-label="Mensaje para el agente"
              className="max-h-36 w-full resize-none bg-transparent px-1.5 pt-1 text-[13px] leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] disabled:opacity-50"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {session && (
                  <span
                    className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-[var(--bg-input)] px-2.5 text-[11px] text-[var(--text-secondary)]"
                    title="Las acciones que modifican datos se pausan hasta que las apruebes"
                  >
                    <ShieldCheck
                      size={12}
                      className={pending.length > 0 ? 'text-[var(--accent-yellow)]' : 'text-[var(--text-muted)]'}
                    />
                    {pending.length > 0 ? `${pending.length} por aprobar` : 'Con aprobación'}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden max-w-56 truncate rounded-full bg-[var(--bg-input)] px-2.5 py-1 text-[11px] text-[var(--text-muted)] sm:block">
                  {session
                    ? `${sessionProviderLabel}${session.model ? ` · ${session.model}` : ''}`
                    : `${providerLabel || 'Proveedor IA'}${model ? ` · ${model}` : ''}`}
                </span>
                {(running || pending.length > 0) && (
                  <button
                    type="button"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-red)] hover:text-[var(--accent-red)]"
                    onClick={() => void cancelTurn()}
                    aria-label="Detener"
                    disabled={stopping}
                    title="Detener el turno"
                  >
                    <Square size={11} />
                  </button>
                )}
                <button
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--text-on-accent)] transition-all duration-150 hover:bg-[var(--accent-primary-hover)] active:scale-[0.96] disabled:bg-[var(--bg-input)] disabled:text-[var(--text-muted)]"
                  onClick={() => void send()}
                  disabled={!sessionId || !draft.trim()}
                  aria-label="Enviar"
                >
                  <Send size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {toolsMenu.isOpen && createPortal(
        <div
          ref={toolsMenu.popupRef}
          role="dialog"
          aria-label="Herramientas del agente"
          className="fixed z-[300] flex flex-col gap-2 rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.22),0_2px_6px_rgba(0,0,0,0.08)]"
          style={{
            top: toolsMenu.position?.top ?? -9999,
            left: toolsMenu.position?.left ?? -9999,
            width: 300,
            maxHeight: toolsMenu.position?.maxHeight ?? 400,
            visibility: toolsMenu.position ? 'visible' : 'hidden',
          }}
        >
          <p className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Herramientas del agente
          </p>
          <div className="custom-scrollbar min-h-0 space-y-2 overflow-y-auto">
            <ToolGroup label="Lectura directa" names={toolGroups.direct} />
            <ToolGroup label="Con aprobación" names={toolGroups.gated} />
            <ToolGroup label="MCP" names={toolGroups.mcp} />
            {toolCount === 0 && (
              <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                Las herramientas disponibles aparecen al cargar la vista.
              </p>
            )}
          </div>
          <p className="shrink-0 text-[10px] leading-relaxed text-[var(--text-muted)]">
            Las acciones que modifican datos se pausan hasta que las apruebes.
          </p>
        </div>,
        document.body,
      )}
    </div>
  );
}
