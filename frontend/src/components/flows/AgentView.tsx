import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, MessageSquare, Plus, Send, Sparkles, X } from 'lucide-react';
import { agentApi, type AgentApproval, type AgentMessage, type AgentSession, type AgentToolSpec } from '../../api/agentApi';
import { aiProvidersApi, type AiProviderSpec } from '../../api/aiProvidersApi';
import { errorMessage } from '../../utils/errors';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import Button from '../ui/Button';
import { AgentContextPanel, ApprovalCard, MessageRow, ThinkingRow } from './AgentTimeline';

const POLL_MS = 1500;

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

export default function AgentView({ initialDraft, onConfigureProvider }: { initialDraft?: string; onConfigureProvider?: () => void }) {
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
  const [deciding, setDeciding] = useState(false);
  const [queued, setQueued] = useState<{ session: string; text: string; failed?: boolean }[]>([]);
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const wantedRef = useRef<{ id: string; silent: boolean } | null>(null);
  const messagesVersionRef = useRef(new Map<string, { version: number; pending: number }>());
  const sessionIdRef = useRef('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (initialDraft) setDraft(initialDraft);
  }, [initialDraft]);

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
      await refreshSessions();
    })();
  }, [addToast, refreshSessions]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
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
  }, [messages.length, pending.length]);

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

  const session = useMemo(() => sessions.find((s) => s.id === sessionId) ?? null, [sessions, sessionId]);
  const queuedForSession = useMemo(() => queued.filter((i) => i.session === sessionId), [queued, sessionId]);
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

  const newSession = async () => {
    if (!provider) {
      addToast({ message: 'Elige un proveedor IA', type: 'error' });
      return null;
    }
    try {
      const res = await agentApi.agentSessionCreate({ provider, model: model || undefined });
      await refreshSessions();
      setSessionId(res.session.id);
      return res.session.id as string;
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
      if (sessionId === id) setSessionId('');
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
    if (!sessionId || running || pending.length > 0) return;
    const next = queued.find((i) => i.session === sessionId && !i.failed);
    if (!next) return;
    setQueued((q) => q.filter((i) => i !== next));
    void (async () => {
      const ok = await sendToSession(sessionId, next.text);
      if (!ok) setQueued((q) => [{ ...next, failed: true }, ...q]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, running, pending.length, queued]);

  const sendSuggestion = async (text: string) => {
    const id = sessionId || (await newSession());
    if (id) void sendToSession(id, text);
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
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--border-medium)]">
        <div className="flex items-center justify-between px-3 pb-1.5 pt-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Conversaciones
          </span>
          <button
            className="rounded-md p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            onClick={() => void newSession()}
            aria-label="Nueva conversación"
            title="Nueva conversación"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {sessions.length === 0 && (
            <p className="px-2 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
              Sin conversaciones. Pulsa + para empezar.
            </p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group mb-0.5 flex items-center gap-2 rounded-lg px-2 py-2 transition-colors ${
                s.id === sessionId
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-input)]'
              }`}
            >
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setSessionId(s.id)}>
                <MessageSquare size={13} className="shrink-0 opacity-60" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {s.last_error && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-yellow)]"
                        title={s.last_error}
                      />
                    )}
                    <span className="truncate text-[12px]">{s.title || 'Conversación'}</span>
                  </span>
                  <span className="block truncate text-[10px] text-[var(--text-muted)]">
                    {s.provider} · {s.model} · {relTime(s.updated_at)}
                  </span>
                </span>
              </button>
              <button
                className="invisible shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--accent-red)] group-hover:visible"
                aria-label="Eliminar conversación"
                title="Eliminar"
                onClick={() => void removeSession(s.id)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {session && (
          <div className="flex items-center gap-2 border-b border-[var(--border-medium)] px-5 py-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--accent-primary-glow)] text-[var(--accent-primary-hover)]">
              <Bot size={14} />
            </span>
            <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
              {session.title || 'Conversación'}
            </span>
            <span className="shrink-0 rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
              {sessionProviderLabel}
              {session.model ? ` · ${session.model}` : ''}
            </span>
          </div>
        )}

        <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {showHero ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-primary-glow)] text-[var(--accent-primary-hover)]">
                <Bot size={28} />
              </span>
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  {sessionId ? '¿En qué trabajamos hoy?' : 'Agente de Antares'}
                </h2>
                <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-[var(--text-secondary)]">
                  {readyProviders.length === 0
                    ? 'Configura un proveedor en «Proveedores IA» para empezar.'
                    : 'Conversa con la app: consulta su estado con herramientas de lectura y aprueba cada acción con efectos antes de que se ejecute.'}
                </p>
              </div>
              {readyProviders.length === 0 && onConfigureProvider && <Button size="sm" onClick={onConfigureProvider}>Configurar IA</Button>}
              {readyProviders.length > 0 && (
                <div className="w-full max-w-sm space-y-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    Sugerencias
                  </p>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      className="flex w-full items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
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

        <div className="px-5 pb-4 pt-1">
          {queuedForSession.length > 0 && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                En cola
              </span>
              {queuedForSession.map((item, idx) => (
                <span
                  key={`${idx}-${item.text}`}
                  className="flex max-w-[70%] items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-0.5 pl-2.5 pr-1 text-[11px] text-[var(--text-secondary)]"
                >
                  {item.failed ? (
                    <button
                      className="truncate text-[var(--accent-yellow)]"
                      title="Falló el envío — clic para reintentar"
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
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 pb-2 pt-3 transition-colors focus-within:border-[var(--border-medium)]">
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
              className="max-h-36 w-full resize-none bg-transparent text-[13px] leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] disabled:opacity-50"
            />
            <div className="mt-1.5 flex items-center justify-between">
              <span className="truncate rounded-full bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] text-[var(--text-muted)]">
                {session
                  ? `${sessionProviderLabel}${session.model ? ` · ${session.model}` : ''}`
                  : `${providerLabel || 'Proveedor IA'}${model ? ` · ${model}` : ''}`}
              </span>
              <button
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--text-on-accent)] transition-all duration-150 hover:bg-[var(--accent-primary-hover)] active:scale-[0.96] disabled:bg-[var(--bg-input)] disabled:text-[var(--text-muted)]"
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

      <AgentContextPanel
        session={session}
        providers={providers}
        provider={provider}
        model={model}
        messageCount={messages.filter((m) => m.role !== 'tool_result').length}
        toolGroups={toolGroups}
        onProviderPick={(v) => {
          setProvider(v);
          const p = providers.find((x) => x.id === v);
          if (p?.default_model) setModel(p.default_model);
        }}
        onModelChange={setModel}
      />
    </div>
  );
}
