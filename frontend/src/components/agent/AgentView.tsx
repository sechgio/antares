import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, CornerDownRight, FolderOpen, Paperclip, Pencil, Plug, Plus, Search, Settings2, ShieldCheck, Sparkles, Square, Wrench, X } from 'lucide-react';
import { agentApi, type AgentContext, type AgentProfile, type AgentArtifact, type AgentQuestion, type AgentAttachment, type AgentApproval, type AgentMessage, type AgentSession, type AgentToolSpec } from '../../api/agentApi';
import { aiProvidersApi, type AiProviderSpec } from '../../api/aiProvidersApi';
import { errorMessage } from '../../utils/errors';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import Button from '../ui/Button';
import ThemedSelect from '../ui/ThemedSelect';
import AgentAvatar from './AgentAvatar';
import ModelPicker from './ModelPicker';
import ArtifactCard from './ArtifactCard';
import QuestionCard from './QuestionCard';
import MemoryMenu from './MemoryMenu';
import ContextChips from './ContextChips';
import AgentEditor from './AgentEditor';
import ConversationMenu from './ConversationMenu';
import { ApprovalCard, DaySeparator, MessageRow, ThinkingRow, ToolGroup, dayLabel } from './AgentTimeline';

const POLL_MS = 1500;
const SESSION_KEY = 'antares-agent-session';
const QUEUE_KEY = 'antares-agent-queue';

function newRequestId(): string {
  return crypto.randomUUID();
}

const SUGGESTIONS = [
  '¿Qué plantillas de reportes tengo disponibles?',
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

export function groupSessions(list: AgentSession[], now = Date.now()): { label: string; items: AgentSession[] }[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const buckets: [string, (ts: number) => boolean][] = [
    ['Hoy', (ts) => ts >= today],
    ['Ayer', (ts) => ts >= today - 86_400_000],
    ['Últimos 7 días', (ts) => ts >= today - 6 * 86_400_000],
    ['Anteriores', () => true],
  ];
  const groups = buckets.map(([label]) => ({ label, items: [] as AgentSession[] }));
  for (const item of list) {
    const index = buckets.findIndex(([, test]) => test(item.updated_at || 0));
    groups[index].items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
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
      className={`group flex h-[46px] shrink-0 items-center gap-2 rounded-lg p-1.5 transition-colors ${
        active
          ? 'bg-[var(--bg-input)]'
          : 'hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)]'
      }`}
    >
      <AgentAvatar seed={session.profile?.id ?? session.id} name={session.title || 'Conversación'} size={30} className="shrink-0" />
      <button type="button" className="flex min-w-0 flex-1 flex-col text-left" onClick={onSelect}>
        <span className="flex min-w-0 items-center gap-1.5">
          {session.last_error && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-yellow)]"
              title={session.last_error}
            />
          )}
          <span className="truncate text-[13px] font-medium leading-[18px] text-[var(--text-primary)]">
            {session.title || 'Conversación'}
          </span>
        </span>
        <span className="truncate text-[11px] leading-4 text-[var(--text-muted)]">
          {session.model || session.provider} · {relTime(session.updated_at)}
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

export default function AgentView({ onConfigureProvider, onOpenModule }: { active?: boolean; onConfigureProvider?: () => void; onOpenModule?: (module: string, id?: string) => void }) {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [providers, setProviders] = useState<AiProviderSpec[]>([]);
  const [tools, setTools] = useState<AgentToolSpec[]>([]);
  const [toolsBusy, setToolsBusy] = useState(false);
  const toolsVersionRef = useRef(0);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [artifacts, setArtifacts] = useState<AgentArtifact[]>([]);
  const [questions, setQuestions] = useState<AgentQuestion[]>([]);
  const [context, setContext] = useState<AgentContext | null>(null);
  const [usage, setUsage] = useState<{ input: number; output: number } | null>(null);
  const [pending, setPending] = useState<AgentApproval[]>([]);
  const [running, setRunning] = useState(false);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [editing, setEditing] = useState<AgentProfile | 'new' | null>(null);

  useEffect(() => {
    let cancelled = false;
    agentApi.agentProfilesList().then((res) => { if (!cancelled) setProfiles(res.profiles); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [deciding, setDeciding] = useState(false);
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [queued, setQueued] = useState<{ session: string; text: string; requestId: string; attachments?: string[]; failed?: boolean }[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      return Array.isArray(saved) ? saved.filter((item) => item && typeof item.session === 'string' && typeof item.text === 'string')
        .map((item) => ({
          session: item.session,
          text: item.text,
          requestId: typeof item.requestId === 'string' ? item.requestId : newRequestId(),
          attachments: Array.isArray(item.attachments) ? item.attachments.filter((a: unknown) => typeof a === 'string') : [],
          failed: true,
        })) : [];
    } catch { return []; }
  });
  const failedSendRef = useRef<{ session: string; text: string; requestId: string } | null>(null);
  const [stopping, setStopping] = useState(false);
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const wantedRef = useRef<{ id: string; silent: boolean } | null>(null);
  const messagesVersionRef = useRef(new Map<string, { version: number; pending: number }>());
  const sessionIdRef = useRef('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const toolsMenu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    align: 'end',
    estimatedWidth: 300,
    estimatedHeight: 320,
    maxHeightCap: 400,
    stopEscapePropagation: true,
  });

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
          setArtifacts(res.artifacts ?? []);
          setQuestions(res.questions ?? []);
          setContext(res.context ?? null);
          setUsage(res.usage ?? null);
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
      const restored = await refreshSessions();
      const saved = localStorage.getItem(SESSION_KEY);
      if (restored.some((s) => s.id === saved)) setSessionId(saved || '');
    })();
  }, [addToast, refreshSessions]);

  useEffect(() => {
    const version = ++toolsVersionRef.current;
    let cancelled = false;
    setTools([]);
    setToolsBusy(true);
    void agentApi.agentToolsList(sessionId || undefined).then((res) => {
      if (!cancelled && version === toolsVersionRef.current) setTools(res.tools);
    }).catch((err) => {
      if (!cancelled && sessionId) addToast({ message: errorMessage(err, 'No se pudieron cargar las herramientas'), type: 'error' });
    }).finally(() => {
      if (!cancelled && version === toolsVersionRef.current) setToolsBusy(false);
    });
    return () => { cancelled = true; };
  }, [sessionId, addToast]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    if (sessionId) localStorage.setItem(SESSION_KEY, sessionId);
    setMessages([]);
    setArtifacts([]);
    setQuestions([]);
    setContext(null);
    setUsage(null);
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
    if (atBottomRef.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, messages[messages.length - 1]?.content, pending.length]);

  useEffect(() => {
    atBottomRef.current = true;
    setShowJump(false);
  }, [sessionId]);

  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = near;
    setShowJump(!near);
  };

  const jumpToEnd = () => {
    atBottomRef.current = true;
    setShowJump(false);
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  };

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
      direct: tools.filter((t) => !t.gated && t.kind !== 'mcp').map((t) => t.name),
      gated: tools.filter((t) => t.gated && t.kind !== 'mcp').map((t) => t.name),
      mcp: tools.filter((t) => t.kind === 'mcp').map((t) => t.name),
    }),
    [tools],
  );
  const enabledNames = new Set(tools.filter((tool) => tool.enabled !== false).map((tool) => tool.name));
  const toolCount = enabledNames.size;
  const saveTools = async (names: string[] | null) => {
    if (!sessionId || toolsBusy) return;
    const version = toolsVersionRef.current;
    setToolsBusy(true);
    try {
      const res = await agentApi.agentToolsSet(sessionId, names);
      if (version === toolsVersionRef.current) setTools(res.tools);
    } catch (err) {
      if (version === toolsVersionRef.current) addToast({ message: errorMessage(err, 'No se pudo guardar la selección de herramientas'), type: 'error' });
    } finally {
      if (version === toolsVersionRef.current) setToolsBusy(false);
    }
  };
  const toggleTool = (name: string, enabled: boolean) => {
    const names = new Set(enabledNames);
    if (enabled) names.add(name);
    else names.delete(name);
    void saveTools([...names]);
  };
  const visibleSessions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((s) => (s.title || 'Conversación').toLowerCase().includes(query));
  }, [sessions, search]);

  const newSession = async (profile?: AgentProfile) => {
    if (!provider) {
      addToast({ message: 'Elige un proveedor IA', type: 'error' });
      return null;
    }
    try {
      const res = await agentApi.agentSessionCreate({ provider, model: model || undefined, ...(profile ? { profile_id: profile.id } : {}) });
      await refreshSessions();
      setSessionId(res.session.id);
      if (profile?.starter) setDraft(profile.starter);
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

  const sendToSession = async (id: string, content: string, requestId: string, attachmentIds: string[] = [], correction = false): Promise<boolean> => {
    const state = messagesVersionRef.current.get(id) ?? { version: 0, pending: 0 };
    messagesVersionRef.current.set(id, state);
    state.version += 1;
    state.pending += 1;
    if (id === sessionIdRef.current) setRunning(true);
    try {
      const res = await (correction
        ? agentApi.agentMessageSend(id, content, requestId, attachmentIds, true)
        : agentApi.agentMessageSend(id, content, requestId, attachmentIds)).finally(() => { state.pending -= 1; });
      for (const file of res.files?.rejected ?? []) {
        addToast({ message: `No se autorizó ${file.path}: ${file.reason}`, type: 'warning' });
      }
      for (const mention of res.mentions?.unknown ?? []) {
        addToast({ message: `@${mention} no corresponde a ningún módulo de Antares`, type: 'warning' });
      }
      for (const mention of res.mentions?.ambiguous ?? []) {
        addToast({ message: `@${mention.mention} es ambiguo; escribe el nombre completo del módulo`, type: 'warning' });
      }
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
    atBottomRef.current = true;
    const failed = failedSendRef.current;
    const requestId = failed && failed.session === sessionId && failed.text === content ? failed.requestId : newRequestId();
    const attachmentIds = attachments.map((a) => a.id);
    if (running || pending.length > 0) {
      setQueued((q) => [...q, { session: sessionId, text: content, requestId, attachments: attachmentIds }]);
      setAttachments([]);
      return;
    }
    const ok = await sendToSession(sessionId, content, requestId, attachmentIds);
    failedSendRef.current = ok ? null : { session: sessionId, text: content, requestId };
    if (ok) setAttachments([]);
    if (!ok) setDraft((prev) => (prev.trim() ? prev : content));
  };

  useEffect(() => {
    if (!sessionId || running || stopping || pending.length > 0) return;
    const next = queued.find((i) => i.session === sessionId && !i.failed);
    if (!next) return;
    const sending = { ...next, failed: true };
    setQueued((q) => q.map((i) => i === next ? sending : i));
    void (async () => {
      const ok = await sendToSession(sessionId, next.text, next.requestId, next.attachments ?? []);
      if (ok) setQueued((q) => q.filter((i) => i !== sending));
    })();
  }, [sessionId, running, stopping, pending.length, queued]);

  const sendCorrection = async (item: (typeof queued)[number]) => {
    setQueued((q) => q.filter((i) => i !== item));
    const ok = await sendToSession(item.session, item.text, item.requestId, item.attachments ?? [], true);
    if (!ok) setQueued((q) => [...q, { ...item, failed: true }]);
  };

  const attach = async (kind: 'files' | 'folder') => {
    try {
      const res = await agentApi.agentAttach(kind);
      setAttachments((prev) => [...prev, ...res.attachments]);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo adjuntar'), type: 'error' });
    }
  };

  const sendSuggestion = async (text: string) => {
    const id = sessionId || (await newSession());
    if (id) void sendToSession(id, text, newRequestId());
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
  const activeProfile = session?.profile ? profiles.find((item) => item.id === session.profile?.id) ?? null : null;
  const agentIdentity = session
    ? { seed: session.profile?.id ?? session.id, name: session.profile?.name ?? (session.title || 'Agente de Antares') }
    : undefined;

  return (
    <div
      className="relative flex h-full min-h-0 gap-4 bg-[var(--bg-surface)] p-3"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          setSearchOpen(true);
        }
      }}
    >
      {editing && (
        <AgentEditor
          key={editing === 'new' ? 'new' : editing.id}
          profile={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setProfiles((prev) => [...prev.filter((p) => p.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'es')));
            setEditing(null);
          }}
          onDeleted={(id) => {
            setProfiles((prev) => prev.filter((p) => p.id !== id));
            setEditing(null);
          }}
        />
      )}
      <aside className="hidden h-full w-[260px] shrink-0 flex-col rounded-[24px] border border-[var(--bg-surface)] bg-[var(--bg-base)] p-[7px] shadow-[0_1px_0_rgba(0,0,0,0.02),0_1px_12px_rgba(0,0,0,0.06)] md:flex">
        <div className="flex shrink-0 items-center gap-2 p-1">
          {searchOpen ? (
            <label className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-[var(--bg-input)] px-3">
              <Search size={14} className="shrink-0 text-[var(--text-secondary)]" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); setSearchOpen(false); } }}
                placeholder="Buscar conversaciones…"
                aria-label="Buscar conversaciones"
                className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <button
                type="button"
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                aria-label="Cerrar búsqueda"
                onClick={() => { setSearch(''); setSearchOpen(false); }}
              >
                <X size={12} />
              </button>
            </label>
          ) : (
            <>
              <button
                type="button"
                className="flex h-9 flex-1 items-center justify-center rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                aria-label="Buscar conversaciones"
                title="Buscar conversaciones (Ctrl+K)"
                onClick={() => setSearchOpen(true)}
              >
                <Search size={16} />
              </button>
              {onConfigureProvider && (
                <button
                  type="button"
                  className="flex h-9 flex-1 items-center justify-center rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                  aria-label="Proveedores"
                  title="Proveedores"
                  onClick={onConfigureProvider}
                >
                  <Plug size={16} />
                </button>
              )}
            </>
          )}
          <Button
            variant="primary"
            size="none"
            className="flex h-9 flex-1 items-center justify-center rounded-full"
            onClick={() => void newSession()}
            aria-label="Nueva conversación"
            title="Nueva conversación"
          >
            <Plus size={16} />
          </Button>
        </div>

        <div className="custom-scrollbar mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
          <div className="flex items-center justify-between px-1.5 pb-1 pt-1">
            <span className="text-[12px] font-medium text-[var(--text-muted)]">Agentes</span>
            <button
              type="button"
              className="flex size-6 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
              aria-label="Crear agente"
              title="Crear un agente para una tarea repetitiva"
              onClick={() => setEditing('new')}
            >
              <Plus size={14} />
            </button>
          </div>
          {profiles.length === 0 && (
            <button
              type="button"
              className="mb-1 rounded-xl px-2.5 py-2 text-left text-[12px] leading-relaxed text-[var(--text-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)] hover:text-[var(--text-secondary)]"
              onClick={() => setEditing('new')}
            >
              Crea un agente con tus indicaciones y herramientas para una tarea que repites.
            </button>
          )}
          {profiles.map((profile) => (
            <div key={profile.id} className="group flex h-[54px] shrink-0 items-center gap-2.5 rounded-xl p-1.5 transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)]">
              <AgentAvatar seed={profile.id} name={profile.name} size={40} className="shrink-0" />
              <button
                type="button"
                className="flex min-w-0 flex-1 flex-col text-left"
                title={`Nueva conversación con ${profile.name}`}
                onClick={() => void newSession(profile)}
              >
                <span className="truncate text-[14px] font-medium leading-5 text-[var(--text-primary)]">{profile.name}</span>
                <span className="truncate text-[13px] leading-5 text-[var(--text-muted)]">{profile.description || 'Agente personalizado'}</span>
              </button>
              <button
                type="button"
                className="invisible shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] group-hover:visible focus-visible:visible"
                aria-label={`Editar agente ${profile.name}`}
                title="Editar"
                onClick={() => setEditing(profile)}
              >
                <Pencil size={13} />
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
            <>
              <span className="px-1.5 pb-1 pt-3 text-[12px] font-medium text-[var(--text-muted)]">Conversaciones</span>
              <p className="px-2.5 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
                Sin conversaciones. Pulsa + para empezar.
              </p>
            </>
          )}
          {sessions.length > 0 && visibleSessions.length === 0 && (
            <p className="px-2.5 py-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
              Sin resultados para «{search.trim()}».
            </p>
          )}
          {groupSessions(visibleSessions).map((group) => (
            <section key={group.label} aria-label={group.label} className="flex flex-col gap-0.5">
              <span className="px-1.5 pb-1 pt-3 text-[12px] font-medium text-[var(--text-muted)]">{group.label}</span>
              {group.items.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  active={s.id === sessionId}
                  onSelect={() => setSessionId(s.id)}
                  onDelete={() => void removeSession(s.id)}
                />
              ))}
            </section>
          ))}
        </div>

      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[24px] bg-[var(--bg-base)]">
        <nav aria-label="Conversaciones" className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] p-3 md:hidden">
          <ThemedSelect value={sessionId} onChange={setSessionId} placeholder="Elegir conversación"
            options={sessions.map((item) => ({ value: item.id, label: item.title || 'Conversación' }))}
            aria-label="Conversación activa" className="min-w-0 flex-1" />
          {profiles.length > 0 && (
            <ThemedSelect value="" placeholder="Usar agente…" aria-label="Usar agente"
              options={profiles.map((item) => ({ value: item.id, label: item.name }))}
              onChange={(id) => { const chosen = profiles.find((item) => item.id === id); if (chosen) void newSession(chosen); }}
              className="w-36 shrink-0" />
          )}
          <Button size="sm" variant="secondary" aria-label="Crear conversación" onClick={() => void newSession()}><Plus size={14} /></Button>
          <Button size="sm" variant="secondary" aria-label="Nuevo agente" onClick={() => setEditing('new')}><Pencil size={14} /></Button>
          {sessionId && <Button size="sm" variant="secondary" aria-label="Borrar conversación activa" onClick={() => void removeSession(sessionId)}><X size={14} /></Button>}
          {onConfigureProvider && <Button size="sm" variant="secondary" aria-label="Configurar proveedor" onClick={onConfigureProvider}><Settings2 size={14} /></Button>}
        </nav>
        {session && (
          <header className="flex shrink-0 items-center gap-2 px-3 pt-3">
            <div className="flex h-[31px] min-w-0 items-center gap-2 rounded-full pl-2 pr-3 transition-colors hover:bg-[var(--bg-input)]">
              <AgentAvatar seed={session.profile?.id ?? session.id} name={session.title || 'Conversación'} size={20} className="shrink-0" />
              <span className="truncate text-[13px] font-medium leading-[18px] text-[var(--text-secondary)]">
                {session.title || 'Conversación'}
              </span>
            </div>
            <span className="min-w-0 flex-1" />
            <MemoryMenu />
            <Button
              ref={toolsMenu.triggerRef}
              variant="none"
              size="none"
              aria-label="Herramientas del agente"
              aria-haspopup="dialog"
              aria-expanded={toolsMenu.isOpen}
              title="Herramientas del agente"
              onClick={toolsMenu.toggle}
              className="relative flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
            >
              <Wrench size={14} />
              {toolCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--accent-primary)] px-0.5 text-[8px] font-semibold text-[var(--text-on-accent)]">
                  {toolCount}
                </span>
              )}
            </Button>
            <ConversationMenu
              session={session}
              messages={messages}
              onRename={async (title) => {
                try {
                  await agentApi.agentSessionRename(session.id, title);
                  await refreshSessions();
                } catch (err) {
                  addToast({ message: errorMessage(err, 'No se pudo renombrar la conversación'), type: 'error' });
                }
              }}
              onDelete={() => void removeSession(session.id)}
              onCopied={() => addToast({ message: 'Conversación copiada', type: 'success' })}
            />
          </header>
        )}
        {session && (
          <ContextChips
            context={context}
            usage={usage}
            onRemoveFile={async (path) => {
              try {
                await agentApi.agentContextRemoveFile(session.id, path);
                await loadMessages(session.id, false);
              } catch (err) {
                addToast({ message: errorMessage(err, 'No se pudo retirar el archivo'), type: 'error' });
              }
            }}
          />
        )}

        <div ref={listRef} onScroll={onListScroll} className="custom-scrollbar flex-1 space-y-4 overflow-y-auto px-3 pb-4 pt-2">
          {showHero ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
              <AgentAvatar
                seed={agentIdentity?.seed ?? 'antares-agent'}
                name={agentIdentity?.name ?? 'Agente de Antares'}
                size={64}
              />
              <div>
                <h2 className="text-[15px] font-semibold leading-6 text-[var(--text-primary)]">
                  {activeProfile ? activeProfile.name : sessionId ? '¿En qué trabajamos hoy?' : 'Agente de Antares'}
                </h2>
                <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-[19px] text-[var(--text-secondary)]">
                  {readyProviders.length === 0
                    ? 'Configura un proveedor en «Proveedores» para empezar.'
                    : activeProfile?.description
                      || 'Conversa con la app: consulta su estado con herramientas de lectura y aprueba cada acción con efectos antes de que se ejecute.'}
                </p>
              </div>
              {readyProviders.length === 0 && onConfigureProvider && (
                <Button size="sm" onClick={onConfigureProvider}>Configurar IA</Button>
              )}
              {readyProviders.length > 0 && (
                <div className="w-full max-w-sm space-y-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    Sugerencias
                  </p>
                  {(activeProfile?.starter ? [activeProfile.starter] : SUGGESTIONS).map((s) => (
                    <button
                      key={s}
                      className="flex w-full items-center gap-2 rounded-2xl bg-[var(--bg-surface)] px-3 py-2.5 text-left text-[13px] text-[var(--text-secondary)] shadow-[0_1px_0.5px_rgba(0,0,0,0.02),0_4px_2px_rgba(0,0,0,0.02)] transition-colors hover:text-[var(--text-primary)]"
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
            messages.map((m, i) => {
              const label = m.ts ? dayLabel(m.ts) : '';
              const previous = messages.slice(0, i).reverse().find((item) => item.ts);
              const newDay = !!label && (!previous?.ts || dayLabel(previous.ts) !== label);
              return (
                <div key={`${m.ts}-${i}`} className="space-y-4">
                  {newDay && <DaySeparator label={label} />}
                  <MessageRow msg={m} agent={agentIdentity} />
                </div>
              );
            })
          )}
          {pending.map((a) => (
            <ApprovalCard key={a.id} approval={a} busy={deciding} onDecide={(id, ok) => void decide(id, ok)} />
          ))}
          {artifacts.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} sessionId={sessionId}
            onRefresh={() => void loadMessages(sessionId, false)} onOpenModule={onOpenModule} />)}
          {questions.map((question) => <QuestionCard key={question.id} question={question} onAnswered={() => void loadMessages(sessionId, false)} />)}
          {running && !questions.length && !pending.length && <ThinkingRow elapsedSeconds={elapsed} agent={agentIdentity} />}
        </div>

        <div className="relative h-0">
          {showJump && (
            <button
              type="button"
              className="absolute -top-12 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-[var(--bg-surface)] px-3 text-[12px] text-[var(--text-secondary)] shadow-[0_2px_10px_rgba(0,0,0,0.12),0_0_1px_rgba(0,0,0,0.3)] transition-colors hover:text-[var(--text-primary)]"
              onClick={jumpToEnd}
            >
              <ArrowDown size={13} /> Ir al final
            </button>
          )}
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
                  {(running || pending.length > 0) && (
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                      aria-label="Enviar como corrección"
                      title="Enviar ahora como corrección del encargo en curso"
                      onClick={() => void sendCorrection(item)}
                    >
                      <CornerDownRight size={10} />
                    </button>
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
          <div className="rounded-[20px] border border-transparent bg-[var(--bg-surface)] p-2.5 shadow-[0_1px_0.5px_rgba(0,0,0,0.02),0_4px_2px_rgba(0,0,0,0.02)] transition-colors focus-within:border-[var(--border-subtle)]">
            {attachments.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5 px-1" aria-label="Adjuntos">
                {attachments.map((item) => (
                  <span
                    key={item.id}
                    className="flex max-w-[60%] items-center gap-1 rounded-full bg-[var(--bg-input)] py-0.5 pl-2 pr-1 text-[11px] text-[var(--text-secondary)]"
                  >
                    {item.kind === 'folder' ? <FolderOpen size={11} /> : <Paperclip size={11} />}
                    <span className="truncate">{item.name}</span>
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                      aria-label={`Quitar ${item.name}`}
                      onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== item.id))}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
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
                    : 'Hola, ¿qué necesitas hoy?'
              }
              disabled={!sessionId}
              aria-label="Mensaje para el agente"
              className="max-h-36 w-full resize-none bg-transparent px-1.5 pt-1.5 text-[14px] leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] disabled:opacity-50"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--bg-input)] text-[var(--text-primary)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_10%,var(--bg-input))] disabled:opacity-50"
                  onClick={() => void attach('files')}
                  disabled={!sessionId}
                  aria-label="Adjuntar archivos"
                  title="Adjuntar archivos (solo lectura para el agente)"
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:opacity-50"
                  onClick={() => void attach('folder')}
                  disabled={!sessionId}
                  aria-label="Adjuntar carpeta"
                  title="Adjuntar una carpeta (el agente podrá leer sus archivos)"
                >
                  <FolderOpen size={15} />
                </button>
                {session && (
                  <span
                    className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-full pl-2 pr-2.5 text-[14px] text-[var(--text-secondary)]"
                    title="Las acciones que modifican datos se pausan hasta que las apruebes"
                  >
                    <ShieldCheck
                      size={15}
                      className={pending.length > 0 ? 'text-[var(--accent-yellow)]' : 'text-[var(--text-secondary)]'}
                    />
                    {pending.length > 0 ? `${pending.length} por aprobar` : 'Con aprobación'}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!session && readyProviders.length > 0 ? (
                  <ModelPicker
                    providers={readyProviders}
                    value={{ provider, model }}
                    onChange={(next) => {
                      setProvider(next.provider);
                      setModel(next.model);
                    }}
                  />
                ) : (
                  <span className="hidden h-8 max-w-56 items-center gap-1.5 truncate rounded-full px-2 text-[12px] text-[var(--text-muted)] sm:flex">
                    <Sparkles size={11} className="shrink-0 text-[var(--accent-primary-hover)]" />
                    {session
                      ? session.model || sessionProviderLabel
                      : model || providerLabel || 'Proveedor IA'}
                  </span>
                )}
                {(running || pending.length > 0) && (
                  <button
                    type="button"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--bg-surface)] text-[var(--text-secondary)] shadow-[0_1px_2px_rgba(0,0,0,0.05)] ring-1 ring-[var(--border-subtle)] transition-colors hover:text-[var(--accent-red)]"
                    onClick={() => void cancelTurn()}
                    aria-label="Detener"
                    disabled={stopping}
                    title="Detener el turno"
                  >
                    <Square size={12} />
                  </button>
                )}
                <button
                  type="button"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[var(--text-on-accent)] transition-all duration-150 hover:bg-[var(--accent-primary-hover)] active:scale-[0.96] disabled:bg-[var(--bg-input)] disabled:text-[var(--text-muted)]"
                  onClick={() => void send()}
                  disabled={!sessionId || !draft.trim()}
                  aria-label="Enviar"
                >
                  <ArrowUp size={16} />
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
            <ToolGroup label="Lectura directa" names={toolGroups.direct} enabledNames={enabledNames} onToggle={toggleTool} disabled={!sessionId || toolsBusy} />
            <ToolGroup label="Con aprobación" names={toolGroups.gated} enabledNames={enabledNames} onToggle={toggleTool} disabled={!sessionId || toolsBusy} />
            <ToolGroup label="MCP" names={toolGroups.mcp} enabledNames={enabledNames} onToggle={toggleTool} disabled={!sessionId || toolsBusy} />
            {tools.length === 0 && (
              <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                {toolsBusy ? 'Cargando herramientas…' : 'No hay herramientas disponibles.'}
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" disabled={!sessionId || toolsBusy} onClick={() => void saveTools(null)}>
            Restablecer herramientas
          </Button>
          <p className="shrink-0 text-[10px] leading-relaxed text-[var(--text-muted)]">
            {sessionId ? 'La selección se guarda para esta conversación. Las acciones que modifican datos requieren tu aprobación.' : 'Selecciona una conversación para configurar sus herramientas.'}
          </p>
        </div>,
        document.body,
      )}
    </div>
  );
}
