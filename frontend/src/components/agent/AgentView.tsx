import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, CalendarClock, ChevronDown, CornerDownRight, FolderOpen, Globe, ListOrdered, PanelLeftClose, PanelLeftOpen, Paperclip, Pencil, Play, Plug, Plus, Search, Settings2, ShieldCheck, Sparkles, Square, Wrench, X } from 'lucide-react';
import { agentApi, type AgentPermissionMode, type AgentContext, type AgentPlan, type AgentProfile, type AgentArtifact, type AgentQuestion, type AgentAttachment, type AgentApproval, type AgentMessage, type AgentSession, type AgentToolSpec, type AgentUsage } from '../../api/agentApi';
import { aiProvidersApi, type AiProviderSpec } from '../../api/aiProvidersApi';
import { onNotify } from '../../api/core';
import { errorMessage } from '../../utils/errors';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import Button from '../ui/Button';
import ThemedSelect from '../ui/ThemedSelect';
import Input from '../ui/Input';
import { SegmentedControl } from '../ui/SegmentedControl';
import AgentAvatar from './AgentAvatar';
import ModelPicker from './ModelPicker';
import PermissionPicker from './PermissionPicker';
import ContextUsage from './ContextUsage';
import ArtifactCard from './ArtifactCard';
import QuestionCard from './QuestionCard';
import MemoryMenu from './MemoryMenu';
import ContextChips from './ContextChips';
import AgentEditor from './AgentEditor';
import ConversationMenu from './ConversationMenu';
import AgentBrowserPanel from './AgentBrowserPanel';
import AgentAuditPanel from './AgentAuditPanel';
import ScheduledTasksPanel from './ScheduledTasksPanel';
import { METHOD_LABELS } from './methodLabels';
import { ApprovalCard, DaySeparator, MessageRow, PlanCard, ThinkingRow, ToolGroup, dayLabel } from './AgentTimeline';

const POLL_MS = 1500;
const SESSION_KEY = 'antares-agent-session';
const QUEUE_KEY = 'antares-agent-queue';
const RESUME_TEXT = 'Reanuda el encargo donde lo dejaste: revisa el plan y los últimos resultados antes de repetir cualquier acción.';

type SendIntent = Readonly<{
  session: string;
  text: string;
  requestId: string;
  attachments: readonly string[];
  correction: boolean;
}>;

type SendReceipt = { intent: SendIntent } & (
  | { phase: 'sending' | 'received' }
  | { phase: 'unconfirmed'; reason: string }
);

type ConversationAttention = { key: string; text: string } & (
  | { kind: 'stale' | 'working' }
  | { kind: 'item'; target: string; action: string }
);

function activityText(tool?: string): string {
  if (tool?.startsWith('fs_')) return 'Estoy trabajando con tus archivos.';
  if (tool?.startsWith('web_')) return 'Estoy trabajando en la página.';
  if (tool?.startsWith('desktop_')) return 'Estoy trabajando con la aplicación.';
  if (tool === 'shell_run') return 'Estoy ejecutando la tarea.';
  if (tool === 'subagent_run') return 'Estoy consultando a otro agente.';
  return 'El agente está trabajando';
}

function newRequestId(): string {
  return crypto.randomUUID();
}

const SUGGESTIONS = [
  '¿Qué plantillas de reportes tengo disponibles?',
  'Resume el estado de mis conexiones externas.',
  '¿Qué ejecuciones recientes fallaron y por qué?',
];

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
      className={`group relative flex h-9 shrink-0 items-center rounded-lg px-2.5 transition-colors ${
        active
          ? 'bg-[var(--bg-input)]'
          : 'hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)]'
      }`}
    >
      <button
        type="button"
        className={`flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] leading-[18px] group-hover:pr-6 group-focus-within:pr-6 ${active ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}
        title={session.title || 'Conversación'}
        aria-current={active ? 'page' : undefined}
        onClick={onSelect}
      >
        {session.last_error && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-yellow)]"
            title={session.last_error}
          />
        )}
        <span className="truncate">
          {session.title || 'Conversación'}
        </span>
      </button>
      <button
        type="button"
        className="invisible absolute right-1.5 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:text-[var(--accent-red)] group-hover:visible group-focus-within:visible"
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
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  const [pending, setPending] = useState<AgentApproval[]>([]);
  const [running, setRunning] = useState(false);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [resumable, setResumable] = useState(false);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [modelBusy, setModelBusy] = useState(false);
  const [permissionsBusy, setPermissionsBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const sendInFlightRef = useRef(false);
  const [messagesStale, setMessagesStale] = useState(false);
  const [draft, setDraft] = useState('');
  const [mentionCursor, setMentionCursor] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionsHidden, setMentionsHidden] = useState(false);
  const [search, setSearch] = useState('');
  const [profileSearch, setProfileSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarView, setSidebarView] = useState<'conversations' | 'agents'>('conversations');
  const sessionSearchRef = useRef<HTMLInputElement | null>(null);
  const [toolsQuery, setToolsQuery] = useState('');
  const [toolsFilter, setToolsFilter] = useState<'all' | 'skills' | 'mcp'>('all');
  const toolsSearchRef = useRef<HTMLInputElement | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [editing, setEditing] = useState<AgentProfile | 'new' | null>(null);

  useEffect(() => {
    let cancelled = false;
    agentApi.agentProfilesList().then((res) => { if (!cancelled) setProfiles(res.profiles); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [deciding, setDeciding] = useState<{ id: string; approved: boolean } | null>(null);
  const decisionRef = useRef<string | null>(null);
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [queued, setQueued] = useState<{ session: string; text: string; requestId: string; attachments?: string[]; failed?: boolean; correction?: boolean }[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      return Array.isArray(saved) ? saved.filter((item) => item && typeof item.session === 'string' && typeof item.text === 'string')
        .map((item) => ({
          session: item.session,
          text: item.text,
          requestId: typeof item.requestId === 'string' ? item.requestId : newRequestId(),
          attachments: Array.isArray(item.attachments) ? item.attachments.filter((a: unknown) => typeof a === 'string') : [],
          failed: true,
          ...(item.correction === true ? { correction: true } : {}),
        })) : [];
    } catch { return []; }
  });
  const [sendReceipts, setSendReceipts] = useState<SendReceipt[]>([]);
  const requestsInFlightRef = useRef(new Set<string>());
  const draftVersionRef = useRef(0);
  const restoredDraftRef = useRef<{ session: string; requestId: string; version: number } | null>(null);
  const correctionInFlightRef = useRef(false);
  const [sendingCorrection, setSendingCorrection] = useState(false);
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
  const botMentionsRef = useRef<HTMLDivElement | null>(null);
  const announcedRef = useRef(new Set<string>());
  const [announcement, setAnnouncement] = useState<{ key: string; text: string } | null>(null);
  const activeCall = messages.flatMap((message) => message.tool_calls ?? []).reverse().find((call) => call.status === 'running');
  const artifact = [...artifacts].reverse().find((item) => item.files.length > 0);
  const attention: ConversationAttention | null = sessionId !== sessionIdRef.current ? null : messagesStale
    ? { kind: 'stale', key: 'stale', text: 'No se pudo actualizar la conversación. El estado mostrado puede estar desactualizado.' }
    : pending[0]
      ? { kind: 'item', key: `approval:${pending[0].id}`, text: 'Hay una acción pendiente de tu aprobación.',
        target: `agent-approval-${pending[0].id}`, action: 'Revisar acción' }
      : questions[0]
        ? { kind: 'item', key: `question:${questions[0].id}`, text: 'El agente necesita tu respuesta para continuar.',
          target: `agent-question-${questions[0].id}`, action: 'Responder' }
        : running
          ? activeCall || !messages.some((message) => message.partial)
            ? { kind: 'working', key: `working:${activeCall?.id ?? 'turn'}`, text: activityText(activeCall?.name) }
            : null
          : artifact
            ? { kind: 'item', key: `artifact:${artifact.id}:${artifact.files.map((file) => file.sha256).join(',')}`,
              text: `Resultado disponible: ${artifact.files[0].name}`, target: `agent-artifact-${artifact.id}`, action: 'Ver resultado' }
            : null;
  const attentionKey = attention ? `${sessionId}:${attention.key}` : '';
  const attentionText = attention?.text ?? '';
  const persistentAttention = attention?.kind === 'item';
  useEffect(() => {
    if (!attentionKey || (persistentAttention && announcedRef.current.has(attentionKey))) {
      setAnnouncement(null);
      return;
    }
    if (persistentAttention) announcedRef.current.add(attentionKey);
    setAnnouncement({ key: attentionKey, text: attentionText });
  }, [attentionKey, attentionText, persistentAttention]);
  const toolsMenu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    align: 'end',
    estimatedWidth: 360,
    estimatedHeight: 400,
    maxHeightCap: 480,
    stopEscapePropagation: true,
  });
  const toolsVisible = toolsMenu.isOpen && toolsMenu.position !== null;
  useEffect(() => {
    if (!toolsVisible) return;
    const frame = window.requestAnimationFrame(() => toolsSearchRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (document.activeElement === document.body) toolsMenu.triggerRef.current?.focus();
    };
  }, [toolsVisible, toolsMenu.triggerRef]);

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
          setMessagesStale(false);
          setMessages(res.messages);
          setArtifacts(res.artifacts ?? []);
          setQuestions(res.questions ?? []);
          setContext(res.context ?? null);
          setUsage(res.usage ?? null);
          setPending(res.pending_approvals);
          setRunning(res.running);
          setPlan(res.plan ?? null);
          setResumable(!!res.resumable);
        }
      } catch (err) {
        if (id === sessionIdRef.current) setMessagesStale(true);
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
    setToolsQuery('');
    setToolsFilter('all');
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
    setPlan(null);
    setResumable(false);
    setMessagesStale(false);
    if (sessionId) void loadMessages(sessionId, false);
    else setRunning(false);
  }, [sessionId, loadMessages]);

  useEffect(() => {
    if (!sessionId) return undefined;
    return onNotify((method, params) => {
      if (method === 'agent.changed' && (params as { session_id?: string } | null)?.session_id === sessionId) void loadMessages(sessionId);
    });
  }, [sessionId, loadMessages]);

  useEffect(() => onNotify((method, params) => {
    if (method === 'agent.browser' && (params as { reason?: string } | null)?.reason === 'agent-open') setBrowserOpen(true);
  }), []);

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
  }, [messages.length, messages[messages.length - 1]?.content, pending.length, attentionKey]);

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
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
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
  const changePermissions = async (mode: AgentPermissionMode) => {
    if (!sessionId || permissionsBusy) return;
    setPermissionsBusy(true);
    try {
      const { session: updated } = await agentApi.agentSessionPermissionsSet(sessionId, mode);
      setSessions((list) => list.map((item) => item.id === updated.id ? updated : item));
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron guardar los permisos'), type: 'error' });
    } finally {
      setPermissionsBusy(false);
    }
  };
  const queuedForSession = queued.filter((i) => i.session === sessionId);
  const receiptsForSession = sendReceipts.filter((receipt) => receipt.intent.session === sessionId);
  const latestReceipt = receiptsForSession[receiptsForSession.length - 1];
  const visibleReceipts = receiptsForSession.filter((receipt) => receipt.phase !== 'received' || receipt === latestReceipt);
  const readyProviders = providers.filter((p) => p.configured && (!p.needs_key || p.has_key));
  const providerLabel = providers.find((p) => p.id === provider)?.label ?? provider;
  const filteredTools = useMemo(() => {
    const query = toolsQuery.trim().toLocaleLowerCase('es');
    return tools.filter((tool) => (toolsFilter === 'all' || (toolsFilter === 'skills' ? tool.name.startsWith('skills_') : tool.kind === 'mcp'))
      && `${METHOD_LABELS[tool.name] ?? ''} ${tool.name} ${tool.module ?? ''}`.toLocaleLowerCase('es').includes(query));
  }, [tools, toolsQuery, toolsFilter]);
  const toolGroups = useMemo(
    () => ({
      direct: filteredTools.filter((t) => !t.gated && t.kind !== 'mcp').map((t) => t.name),
      gated: filteredTools.filter((t) => t.gated && t.kind !== 'mcp').map((t) => t.name),
      mcp: filteredTools.filter((t) => t.kind === 'mcp').map((t) => t.name),
    }),
    [filteredTools],
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
  const visibleProfiles = useMemo(() => {
    const query = profileSearch.trim().toLocaleLowerCase('es');
    return profiles.filter((profile) => `${profile.name} ${profile.description}`.toLocaleLowerCase('es').includes(query));
  }, [profiles, profileSearch]);
  const mentionMatch = mentionsHidden ? null : draft.slice(0, mentionCursor).match(/(?:^|\s)@(?:"([^"\n]*)|([\p{L}\p{N}_-]*))$/u);
  const normalizeBotName = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').trim().replace(/[\s_]+/g, '-');
  const mentionQuery = normalizeBotName(mentionMatch?.[1] ?? mentionMatch?.[2] ?? '');
  const mentionProfiles = mentionMatch ? profiles.filter((profile) => normalizeBotName(profile.name).includes(mentionQuery)).slice(0, 6) : [];
  const selectedMention = mentionProfiles[Math.min(mentionIndex, Math.max(0, mentionProfiles.length - 1))];
  useEffect(() => {
    const option = Array.from(botMentionsRef.current?.children ?? []).find((item) => item.getAttribute('aria-selected') === 'true');
    option?.scrollIntoView({ block: 'nearest' });
  }, [selectedMention?.id]);
  const insertBotMention = (profile: AgentProfile) => {
    if (!mentionMatch) return;
    const token = `@bot:${profile.id}`;
    const start = mentionCursor - mentionMatch[0].length + mentionMatch[0].indexOf('@');
    const caret = start + token.length + 1;
    draftVersionRef.current += 1;
    setDraft(`${draft.slice(0, start)}${token} ${draft.slice(mentionCursor)}`);
    setMentionCursor(caret);
    setMentionsHidden(true);
    window.requestAnimationFrame(() => { draftRef.current?.focus(); draftRef.current?.setSelectionRange(caret, caret); });
  };

  const newSession = async (profile?: AgentProfile) => {
    if (!provider) {
      addToast({ message: 'Elige un proveedor IA', type: 'error' });
      return null;
    }
    try {
      const res = await agentApi.agentSessionCreate({ provider, model: model || undefined, ...(profile ? { profile_id: profile.id } : {}) });
      await refreshSessions();
      setSessionId(res.session.id);
      if (profile?.starter) {
        draftVersionRef.current += 1;
        setDraft(profile.starter);
      }
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

  const recordReceipt = (receipt: SendReceipt) => {
    setSendReceipts((previous) => {
      const matches = (item: SendReceipt) => item.intent.session === receipt.intent.session && item.intent.requestId === receipt.intent.requestId;
      const retained = receipt.phase === 'sending' ? previous.filter((item) => !matches(item)) : previous;
      const next = retained.some(matches) ? retained.map((item) => matches(item) ? receipt : item) : [...retained, receipt];
      const latestReceived = [...next].reverse().find((item) => item.intent.session === receipt.intent.session && item.phase === 'received');
      return next.filter((item) => item.intent.session !== receipt.intent.session || item.phase !== 'received' || item === latestReceived);
    });
  };

  const sendToSession = async (input: SendIntent): Promise<boolean> => {
    const intent = { ...input, attachments: [...input.attachments] };
    const { session: id, text: content, requestId, attachments: attachmentIds, correction } = intent;
    const key = JSON.stringify([id, requestId]);
    if (requestsInFlightRef.current.has(key) || (correction && correctionInFlightRef.current)) return false;
    requestsInFlightRef.current.add(key);
    if (correction) {
      correctionInFlightRef.current = true;
      setSendingCorrection(true);
    }
    recordReceipt({ intent, phase: 'sending' });
    setQueued((previous) => previous.some((item) => item.session === id && item.requestId === requestId)
      ? previous : [...previous, { ...intent, attachments: [...attachmentIds], failed: true }]);
    const state = messagesVersionRef.current.get(id) ?? { version: 0, pending: 0 };
    messagesVersionRef.current.set(id, state);
    state.version += 1;
    state.pending += 1;
    if (!correction && (id === sessionIdRef.current || !sessionIdRef.current)) setRunning(true);
    try {
      const res = await (correction
        ? agentApi.agentMessageSend(id, content, requestId, attachmentIds, true)
        : agentApi.agentMessageSend(id, content, requestId, attachmentIds)).finally(() => { state.pending -= 1; });
      if (res.accepted !== true) throw new Error(correction ? 'No se pudo registrar la indicación' : 'No se pudo registrar el mensaje');
      recordReceipt({ intent, phase: 'received' });
      setQueued((previous) => previous.filter((item) => item.session !== id || item.requestId !== requestId));
      setAttachments((previous) => previous.filter((file) => !attachmentIds.includes(file.id)));
      if (id === sessionIdRef.current) {
        const restored = restoredDraftRef.current;
        if (restored?.session === id && restored.requestId === requestId && restored.version === draftVersionRef.current) {
          setDraft('');
          restoredDraftRef.current = null;
        }
      }
      for (const file of res.files?.rejected ?? []) {
        addToast({ message: `No se autorizó ${file.path}: ${file.reason}`, type: 'warning' });
      }
      for (const mention of res.mentions?.unknown ?? []) {
        addToast({ message: `@${mention} no corresponde a ningún agente guardado ni módulo de Antares`, type: 'warning' });
      }
      for (const mention of res.mentions?.ambiguous ?? []) {
        addToast({ message: `@${mention.mention} es ambiguo; escribe el nombre completo del módulo`, type: 'warning' });
      }
      state.version += 1;
      void refreshSessions();
      await loadMessages(id);
      return true;
    } catch (err) {
      const reason = errorMessage(err, 'No se pudo enviar el mensaje');
      recordReceipt({ intent, phase: 'unconfirmed', reason });
      if (id === sessionIdRef.current) {
        if (!correction) setRunning(false);
        addToast({ message: reason, type: 'error' });
      }
      return false;
    } finally {
      requestsInFlightRef.current.delete(key);
      if (correction) {
        correctionInFlightRef.current = false;
        setSendingCorrection(false);
      }
    }
  };

  const send = async (correction = false, suggestion?: string) => {
    const content = suggestion ?? draft.trim();
    if (!content || sendInFlightRef.current || modelBusy || stopping || (correction && correctionInFlightRef.current)) return;
    const attachmentIds = suggestion === undefined ? attachments.map((a) => a.id) : [];
    const version = draftVersionRef.current;
    sendInFlightRef.current = true;
    setSending(true);
    try {
      const id = sessionId || (await newSession());
      if (!id) return;
      if (suggestion === undefined && version === draftVersionRef.current) setDraft((prev) => prev.trim() === content ? '' : prev);
      atBottomRef.current = true;
      const failed = sendReceipts.find((receipt) => receipt.phase === 'unconfirmed'
        && receipt.intent.session === id && receipt.intent.text === content && receipt.intent.correction === correction
        && JSON.stringify(receipt.intent.attachments) === JSON.stringify(attachmentIds));
      const requestId = failed?.intent.requestId ?? newRequestId();
      if (!correction && !failed && (running || pending.length > 0)) {
        setQueued((q) => [...q, { session: id, text: content, requestId, attachments: attachmentIds }]);
        setAttachments((previous) => previous.filter((file) => !attachmentIds.includes(file.id)));
        return;
      }
      const ok = await sendToSession({ session: id, text: content, requestId, attachments: attachmentIds, correction });
      if (!ok && suggestion === undefined && id === sessionIdRef.current && version === draftVersionRef.current) {
        setDraft((prev) => {
          if (prev.trim()) return prev;
          restoredDraftRef.current = { session: id, requestId, version };
          return content;
        });
      }
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
    }
  };

  const retrySend = async (intent: SendIntent) => {
    if (sendInFlightRef.current || modelBusy || stopping || (intent.correction && correctionInFlightRef.current)) return;
    sendInFlightRef.current = true;
    setSending(true);
    try {
      const ok = await sendToSession(intent);
      if (ok) setQueued((q) => q.filter((item) => item.session !== intent.session || item.requestId !== intent.requestId));
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
    }
  };

  useEffect(() => {
    if (!sessionId || running || stopping || modelBusy || messagesStale || pending.length > 0) return;
    const next = queued.find((i) => i.session === sessionId && !i.failed);
    if (!next) return;
    const sending = { ...next, failed: true };
    setQueued((q) => q.map((i) => i === next ? sending : i));
    void (async () => {
      const ok = await sendToSession({ session: sessionId, text: next.text, requestId: next.requestId,
        attachments: next.attachments ?? [], correction: next.correction === true });
      if (ok) setQueued((q) => q.filter((i) => i !== sending));
    })();
  }, [sessionId, running, stopping, modelBusy, messagesStale, pending.length, queued]);

  const sendCorrection = async (item: (typeof queued)[number]) => {
    if (correctionInFlightRef.current || item.failed) return;
    const correcting = { ...item, correction: true, failed: true };
    setQueued((q) => q.map((i) => i === item ? correcting : i));
    const ok = await sendToSession({ session: item.session, text: item.text, requestId: item.requestId,
      attachments: item.attachments ?? [], correction: true });
    if (ok) setQueued((q) => q.filter((i) => i !== correcting));
  };

  const attach = async (kind: 'files' | 'folder') => {
    try {
      const res = await agentApi.agentAttach(kind);
      if (res.attachments.length) draftVersionRef.current += 1;
      setAttachments((prev) => [...prev, ...res.attachments]);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo adjuntar'), type: 'error' });
    }
  };

  const sendSuggestion = async (text: string) => {
    if (running || pending.length > 0) return;
    await send(false, text);
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

  const decide = async (id: string, ok: boolean, remember = false) => {
    if (decisionRef.current) return;
    decisionRef.current = id;
    setDeciding({ id, approved: ok });
    try {
      if (ok) await agentApi.agentApprove(id, remember);
      else await agentApi.agentDeny(id);
      await loadMessages(sessionId);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo aplicar la decisión'), type: 'error' });
    } finally {
      decisionRef.current = null;
      setDeciding(null);
    }
  };

  const showHero = !sessionId || messages.length === 0;
  const activeProfile = session?.profile ? profiles.find((item) => item.id === session.profile?.id) ?? null : null;
  const suggestionList = activeProfile?.starter ? [activeProfile.starter] : SUGGESTIONS;
  const suggestionsHidden = !!draft.trim() || running || pending.length > 0;
  const agentIdentity = session
    ? { seed: session.profile?.id ?? session.id, name: session.profile?.name ?? 'Antares', color: activeProfile?.color }
    : undefined;

  const changeModel = async (next: { provider: string; model: string }) => {
    if (modelBusy || running || pending.length > 0) return;
    if (!session) {
      setProvider(next.provider);
      setModel(next.model);
      return;
    }
    setModelBusy(true);
    try {
      const res = await agentApi.agentSessionModelSet(session.id, next.provider, next.model);
      setSessions((prev) => prev.map((item) => item.id === res.session.id ? res.session : item));
      setProvider(next.provider);
      setModel(next.model);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo cambiar el modelo'), type: 'error' });
    } finally {
      setModelBusy(false);
    }
  };

  return (
    <div
      className="agent-workspace relative flex h-full min-h-0 gap-3 bg-[var(--bg-surface)] p-2.5"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          setSidebarView('conversations');
          setSidebarOpen(true);
          setSearchOpen(true);
          sessionSearchRef.current?.focus();
        }
      }}
    >
      {editing && (
        <AgentEditor
          key={editing === 'new' ? 'new' : editing.id}
          profile={editing === 'new' ? null : editing}
          canStartChat={Boolean(provider)}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setProfiles((prev) => [...prev.filter((p) => p.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'es')));
            setEditing(null);
            if (editing === 'new') {
              if (provider) void newSession(saved);
              else setSidebarView('agents');
            }
          }}
          onDeleted={(id) => {
            setProfiles((prev) => prev.filter((p) => p.id !== id));
            setEditing(null);
          }}
        />
      )}
      <aside aria-label="Agentes y conversaciones" hidden={!sidebarOpen} className={`agent-sidebar hidden h-full w-[248px] shrink-0 flex-col bg-[var(--bg-base)] p-2 ${sidebarOpen ? 'md:flex' : ''}`}>
        <div className="flex shrink-0 items-center gap-2 p-1">
          {!searchOpen && <Button
            variant="none"
            size="none"
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-input)]"
            onClick={() => void newSession()}
            aria-label="Nueva conversación"
            title="Nueva conversación"
          >
            <Pencil size={15} className="shrink-0 text-[var(--text-secondary)]" />
            <span className="truncate">Nuevo chat</span>
          </Button>}
          {searchOpen && sidebarOpen ? (
            <label className="agent-search flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-[var(--bg-input)] px-3">
              <Search size={14} className="shrink-0 text-[var(--text-secondary)]" />
              <input
                ref={sessionSearchRef}
                autoFocus
                value={sidebarView === 'agents' ? profileSearch : search}
                onChange={(e) => sidebarView === 'agents' ? setProfileSearch(e.target.value) : setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { if (sidebarView === 'agents') setProfileSearch(''); else setSearch(''); setSearchOpen(false); } }}
                placeholder={sidebarView === 'agents' ? 'Buscar agentes…' : 'Buscar conversaciones…'}
                aria-label={sidebarView === 'agents' ? 'Buscar agentes' : 'Buscar conversaciones'}
                className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              />
              <button
                type="button"
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                aria-label="Cerrar búsqueda"
                onClick={() => { if (sidebarView === 'agents') setProfileSearch(''); else setSearch(''); setSearchOpen(false); }}
              >
                <X size={12} />
              </button>
            </label>
          ) : (
            <>
              <button
                type="button"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                aria-label={sidebarView === 'agents' ? 'Buscar agentes' : 'Buscar conversaciones'}
                title={sidebarView === 'agents' ? 'Buscar agentes' : 'Buscar conversaciones (Ctrl+K)'}
                onClick={() => setSearchOpen(true)}
              >
                <Search size={16} />
              </button>
              {onConfigureProvider && (
                <button
                  type="button"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                  aria-label="Proveedores"
                  title="Proveedores"
                  onClick={onConfigureProvider}
                >
                  <Plug size={16} />
                </button>
              )}
            </>
          )}
        </div>

        <SegmentedControl
          value={sidebarView}
          onChange={(value) => { setSidebarView(value); setSearchOpen(Boolean(value === 'agents' ? profileSearch : search)); }}
          options={[{ value: 'conversations', label: 'Conversaciones' }, { value: 'agents', label: 'Agentes' }]}
          aria-label="Vistas del agente"
          className="mx-1 mt-2 flex shrink-0 gap-0.5 rounded-lg bg-[var(--bg-input)] p-0.5 [&>button]:text-[12px] [&>button[aria-pressed=false]]:text-[var(--text-secondary)]"
        />
        <div className="custom-scrollbar mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
          {sidebarView === 'agents' ? <>
          <div className="flex items-center justify-between px-1.5 pb-1 pt-1">
            <span className="text-[12px] font-medium text-[var(--text-muted)]">Agentes guardados</span>
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
          {profiles.length > 0 && visibleProfiles.length === 0 && <p className="px-2.5 py-3 text-[12px] text-[var(--text-secondary)]">
            Sin agentes para «{profileSearch.trim()}».
          </p>}
          {visibleProfiles.map((profile) => (
            <div key={profile.id} className={`group flex h-[50px] shrink-0 items-center gap-2 rounded-xl p-1.5 transition-colors ${activeProfile?.id === profile.id ? 'bg-[var(--bg-input)]' : 'hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)]'}`}>
              <AgentAvatar seed={profile.id} color={profile.color} name={profile.name} size={32} className="shrink-0" />
              <button
                type="button"
                className="flex min-w-0 flex-1 flex-col text-left"
                title={`Nueva conversación con ${profile.name}`}
                onClick={() => void newSession(profile)}
              >
                <span className="truncate text-[13px] font-medium leading-5 text-[var(--text-primary)]">{profile.name}</span>
                <span className="truncate text-[11px] leading-4 text-[var(--text-muted)]">{profile.description || 'Agente personalizado'}</span>
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
          </> : <>
          {sessions.length === 0 && (
            <p className="px-2.5 py-3 text-[12px] text-[var(--text-muted)]">
              Tus chats aparecerán aquí.
            </p>
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
          </>}
        </div>

      </aside>

      <main aria-label="Conversación del agente" className="agent-conversation relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-base)]">
        <Button
          variant="none"
          size="none"
          className="absolute left-3 top-3 hidden size-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] md:flex"
          aria-label={sidebarOpen ? 'Ocultar barra lateral' : 'Mostrar barra lateral'}
          title={sidebarOpen ? 'Ocultar barra lateral' : 'Mostrar barra lateral'}
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </Button>
        <nav aria-label="Conversaciones" className="grid shrink-0 grid-cols-[minmax(0,1fr)_repeat(4,auto)] items-center gap-2 border-b border-[var(--border-subtle)] p-3 md:hidden">
          <ThemedSelect value={sessionId} onChange={setSessionId} placeholder="Elegir conversación"
            options={sessions.map((item) => ({ value: item.id, label: item.title || 'Conversación' }))}
            aria-label="Conversación activa" className="col-span-full min-w-0" />
          {profiles.length > 0 && (
            <ThemedSelect value="" placeholder="Usar agente…" aria-label="Usar agente"
              options={profiles.map((item) => ({ value: item.id, label: item.name }))}
              onChange={(id) => { const chosen = profiles.find((item) => item.id === id); if (chosen) void newSession(chosen); }}
              className="min-w-0" />
          )}
          <Button size="sm" variant="secondary" aria-label="Crear conversación" onClick={() => void newSession()}><Plus size={14} /></Button>
          <Button size="sm" variant="secondary" aria-label="Nuevo agente" onClick={() => setEditing('new')}><Pencil size={14} /></Button>
          {sessionId && <Button size="sm" variant="secondary" aria-label="Borrar conversación activa" onClick={() => void removeSession(sessionId)}><X size={14} /></Button>}
          {onConfigureProvider && <Button size="sm" variant="secondary" aria-label="Configurar proveedor" onClick={onConfigureProvider}><Settings2 size={14} /></Button>}
        </nav>
        {session && (
          <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3 md:pl-12">
            <div className="flex h-8 min-w-0 items-center">
              <span className="truncate text-[13px] font-medium leading-[18px] text-[var(--text-secondary)]">
                {session.title || 'Conversación'}
              </span>
            </div>
            <span className="min-w-0 flex-1" />
            <button
              type="button"
              aria-label="Historial de aprobaciones"
              title="Historial de aprobaciones"
              onClick={() => setAuditOpen(true)}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
            >
              <ShieldCheck size={14} />
            </button>
            <button
              type="button"
              aria-label="Encargos programados"
              title="Encargos programados"
              onClick={() => setTasksOpen(true)}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
            >
              <CalendarClock size={14} />
            </button>
            <button
              type="button"
              aria-label="Navegador del agente"
              aria-pressed={browserOpen}
              title={browserOpen ? 'Cerrar el navegador del agente' : 'Abrir el navegador del agente'}
              onClick={() => setBrowserOpen((open) => !open)}
              className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] ${browserOpen ? 'bg-[var(--bg-input)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}
            >
              <Globe size={14} />
            </button>
            <MemoryMenu />
            <Button
              ref={toolsMenu.triggerRef}
              variant="none"
              size="none"
              aria-label="Herramientas del agente"
              aria-haspopup="dialog"
              aria-expanded={toolsMenu.isOpen}
              title="Herramientas del agente"
              onClick={() => { setToolsQuery(''); setToolsFilter('all'); toolsMenu.toggle(); }}
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

        <div ref={listRef} onScroll={onListScroll} role="region" aria-label="Mensajes" tabIndex={-1} className="custom-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto [scrollbar-gutter:stable_both-edges] px-4 pb-4 pt-3 [&>*]:mx-auto [&>*]:max-w-[720px]">
          {showHero ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
              <AgentAvatar
                seed={agentIdentity?.seed ?? 'antares-agent'}
                color={activeProfile?.color}
                name={agentIdentity?.name ?? 'Agente de Antares'}
                size={64}
              />
              <div>
                <h2 className="text-[22px] font-medium leading-8 tracking-tight text-[var(--text-primary)]">
                  {activeProfile ? activeProfile.name : '¿En qué trabajamos hoy?'}
                </h2>
                {(readyProviders.length === 0 || activeProfile?.description) && (
                  <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-[19px] text-[var(--text-secondary)]">
                    {readyProviders.length === 0 ? 'Configura un proveedor en «Proveedores» para empezar.' : activeProfile?.description}
                  </p>
                )}
              </div>
              {readyProviders.length === 0 && onConfigureProvider && (
                <Button size="sm" onClick={onConfigureProvider}>Configurar IA</Button>
              )}
            </div>
          ) : (
            messages.map((m, i) => {
              const label = m.ts ? dayLabel(m.ts) : '';
              const previous = messages.slice(0, i).reverse().find((item) => item.ts);
              const newDay = !!label && (!previous?.ts || dayLabel(previous.ts) !== label);
              return (
                <div key={`${sessionId}-${m.role}-${i}`} className="space-y-4">
                  {newDay && <DaySeparator label={label} />}
                  <MessageRow msg={m} agent={agentIdentity} />
                </div>
              );
            })
          )}
          {!showHero && plan && <PlanCard plan={plan} running={running && !messagesStale} />}
          {pending.map((a) => (
            <div key={a.id} id={`agent-approval-${a.id}`}>
              <ApprovalCard approval={a} busy={!!deciding}
                decision={deciding?.id === a.id ? deciding.approved ? 'approve' : 'deny' : undefined}
                onDecide={(id, ok, remember) => void decide(id, ok, remember)} />
            </div>
          ))}
          {artifacts.map((artifact) => <div key={artifact.id} id={`agent-artifact-${artifact.id}`}>
            <ArtifactCard artifact={artifact} sessionId={sessionId}
              onRefresh={() => void loadMessages(sessionId, false)} onOpenModule={onOpenModule} />
          </div>)}
          {questions.map((question) => <div key={question.id} id={`agent-question-${question.id}`}>
            <QuestionCard question={question} onAnswered={() => void loadMessages(sessionId, false)} />
          </div>)}
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
        <div role="status" aria-label="Avisos del agente" aria-live="polite" aria-atomic="true" className="sr-only">
          {announcement && <span key={announcement.key}>{announcement.text}</span>}
        </div>
        <div className="mx-auto w-full max-w-[752px] shrink-0 px-4 pb-3">
          {attention && (
            <div role="region" aria-label="Atención del agente" className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2">
              {attention.kind === 'working'
                ? <ThinkingRow elapsedSeconds={elapsed} agent={agentIdentity} label={attention.text} />
                : <p className="min-w-0 flex-1 text-[13px] text-[var(--text-secondary)]">{attention.text}</p>}
              <Button variant="ghost" size="sm" aria-controls={attention.kind === 'item' ? attention.target : undefined} onClick={() => {
                if (attention.kind === 'stale') {
                  void loadMessages(sessionId, false);
                } else if (attention.kind === 'item') {
                  const target = document.getElementById(attention.target);
                  target?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
                  target?.querySelector<HTMLElement>('input, button, summary')?.focus({ preventScroll: true });
                } else {
                  jumpToEnd();
                  listRef.current?.focus({ preventScroll: true });
                }
              }}>
                {attention.kind === 'stale' ? 'Reintentar actualización' : attention.kind === 'item' ? attention.action : 'Ver detalles'}
              </Button>
            </div>
          )}
          {readyProviders.length > 0 && (
            <div className="agent-suggestions" data-hidden={suggestionsHidden ? 'true' : undefined} inert={suggestionsHidden}>
              <div role="group" aria-label="Sugerencias" className="agent-suggestion-list min-h-0 pb-2">
                {suggestionList.map((suggestion, i) => (
                  <Button
                    key={`${sessionId}-${suggestion}`}
                    variant="none"
                    size="none"
                    className="agent-suggestion"
                    style={{ animationDelay: `${i * 60}ms` }}
                    disabled={sending || modelBusy || running || stopping || pending.length > 0}
                    onClick={() => void sendSuggestion(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {queuedForSession.length > 0 && (
            <section aria-label="Mensajes en cola" className="agent-queue mb-2 overflow-hidden rounded-xl border border-[var(--border-subtle)]">
              <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                <ListOrdered size={14} aria-hidden="true" />
                <span className="font-medium">En cola</span>
                <span className="tabular-nums" aria-label={`${queuedForSession.length} mensaje${queuedForSession.length === 1 ? '' : 's'} pendiente${queuedForSession.length === 1 ? '' : 's'}`}>{queuedForSession.length}</span>
                <span className="ml-auto text-[11px] text-[var(--text-muted)]">Pendientes de envío</span>
              </div>
              <ol aria-label="Orden de envío" className="custom-scrollbar max-h-40 overflow-y-auto px-1 pb-1">
                {queuedForSession.map((item, idx) => (
                  <li
                    key={item.requestId}
                    className="agent-queue-item flex min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-[12px] text-[var(--text-secondary)]"
                  >
                    <span aria-hidden="true" className="w-4 shrink-0 pt-0.5 text-center text-[11px] tabular-nums text-[var(--text-muted)]">{idx + 1}</span>
                    <div className="min-w-0 flex-1">
                      {requestsInFlightRef.current.has(JSON.stringify([item.session, item.requestId])) ? (
                        <p className="line-clamp-2 break-words" title={item.text}>Enviando: {item.text}</p>
                      ) : item.failed ? (
                        <button
                          type="button"
                          className="line-clamp-2 break-words text-left text-[var(--accent-yellow)]"
                          title="Reintentar el envío pendiente"
                          disabled={modelBusy || stopping}
                          onClick={() => {
                            const receipt = sendReceipts.find((entry) => entry.intent.session === item.session && entry.intent.requestId === item.requestId);
                            if (receipt) void retrySend(receipt.intent);
                            else void sendToSession({ session: item.session, text: item.text, requestId: item.requestId,
                              attachments: item.attachments ?? [], correction: item.correction === true });
                          }}
                        >
                          {item.text}
                        </button>
                      ) : (
                        <details className="group/queued">
                          <summary className="flex cursor-pointer list-none items-start gap-1 rounded-sm" title="Ver mensaje completo">
                            <span className="min-w-0 flex-1 line-clamp-2 break-words [overflow-wrap:anywhere] group-open/queued:line-clamp-none group-open/queued:whitespace-pre-wrap">{item.text}</span>
                            <ChevronDown size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--text-muted)] transition-transform group-open/queued:rotate-180" />
                          </summary>
                        </details>
                      )}
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                        <span>{requestsInFlightRef.current.has(JSON.stringify([item.session, item.requestId])) ? 'Enviando…' : item.failed ? 'Revisar envío' : item.correction ? 'Indicación pendiente' : idx === 0 ? 'A continuación' : 'En espera'}</span>
                        {!!item.attachments?.length && <span className="inline-flex items-center gap-1"><Paperclip size={10} aria-hidden="true" />{item.attachments.length} adjunto{item.attachments.length === 1 ? '' : 's'}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {(running || pending.length > 0) && !item.failed && (
                        <button
                          type="button"
                          className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                          aria-label="Enviar como corrección"
                          title="Enviar ahora como corrección del encargo en curso"
                          disabled={sendingCorrection || stopping}
                          onClick={() => void sendCorrection(item)}
                        >
                          <CornerDownRight size={12} />
                          <span className="hidden text-[11px] sm:inline">Indicar ahora</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="flex size-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                        aria-label="Quitar de la cola"
                        title="Quitar de la cola"
                        disabled={requestsInFlightRef.current.has(JSON.stringify([item.session, item.requestId]))}
                        onClick={() => setQueued((q) => q.filter((i) => i !== item))}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <div role="group" aria-label="Redactar mensaje" className="agent-composer rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] transition-colors">
            {mentionMatch && <div className="border-b border-[var(--border-subtle)] p-2">
              <p className="px-2 pb-1 text-[11px] text-[var(--text-secondary)]">Colaborar con un bot · solo lectura</p>
              <div ref={botMentionsRef} id="agent-bot-mentions" role="listbox" aria-label="Bots para mencionar" className="max-h-44 overflow-y-auto">
                {mentionProfiles.map((profile) => <Button key={profile.id} id={`agent-mention-${profile.id}`} role="option"
                  aria-selected={selectedMention?.id === profile.id} tabIndex={-1} variant="none" size="none"
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--bg-input)] ${selectedMention?.id === profile.id ? 'bg-[var(--bg-input)]' : ''}`}
                  onMouseDown={(event) => event.preventDefault()} onClick={() => insertBotMention(profile)}>
                  <AgentAvatar seed={profile.id} color={profile.color} name={profile.name} size={24} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[12px]">{profile.name}</span>
                    <span className="block truncate text-[11px] text-[var(--text-secondary)]">{profile.description || 'Agente guardado'} · {profile.id}</span></span>
                </Button>)}
                {mentionProfiles.length === 0 && <p className="px-2 py-1 text-[12px] text-[var(--text-secondary)]">Sin bots coincidentes. Crea uno en Agentes o continúa con tu mensaje.</p>}
              </div>
            </div>}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Adjuntos">
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
                      onClick={() => { draftVersionRef.current += 1; setAttachments((prev) => prev.filter((a) => a.id !== item.id)); }}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="px-4 pb-1 pt-4">
              <textarea
                ref={draftRef}
                rows={1}
                value={draft}
                onChange={(event) => { draftVersionRef.current += 1; setDraft(event.target.value); setMentionCursor(event.target.selectionStart); setMentionIndex(0); setMentionsHidden(false); }}
                onSelect={(event) => setMentionCursor(event.currentTarget.selectionStart)}
                aria-autocomplete="list"
                aria-controls={mentionMatch ? 'agent-bot-mentions' : undefined}
                aria-activedescendant={selectedMention ? `agent-mention-${selectedMention.id}` : undefined}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
                  if (e.key === 'Enter' && e.repeat && !e.shiftKey) { e.preventDefault(); return; }
                  if (mentionMatch && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMentionsHidden(true); return; }
                  if (selectedMention && !e.shiftKey && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key)) {
                    e.preventDefault();
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setMentionIndex((mentionProfiles.indexOf(selectedMention) + (e.key === 'ArrowDown' ? 1 : -1) + mentionProfiles.length) % mentionProfiles.length);
                    else insertBotMention(selectedMention);
                    return;
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  running || pending.length > 0
                    ? 'Añade una indicación o déjala para después…'
                    : 'Escribe un mensaje o @ para mencionar un bot…'
                }
                aria-label="Mensaje para el agente"
                className="block max-h-36 min-h-12 w-full min-w-0 resize-none bg-transparent py-0.5 text-[14px] leading-[22px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] disabled:opacity-50"
              />
            </div>
            <div className="agent-composer-toolbar flex min-w-0 items-center gap-1 px-2.5 pb-2.5">
              <button
                type="button"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:opacity-50"
                onClick={() => void attach('files')}
                disabled={!sessionId}
                aria-label="Adjuntar archivos"
                title="Adjuntar archivos (solo lectura para el agente)"
              >
                <Plus size={16} />
              </button>
              <button
                type="button"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:opacity-50"
                onClick={() => void attach('folder')}
                disabled={!sessionId}
                aria-label="Adjuntar carpeta"
                title="Adjuntar una carpeta (el agente podrá leer sus archivos)"
              >
                <FolderOpen size={14} />
              </button>
              <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1">
                {readyProviders.length > 0 ? (
                  <ModelPicker
                    providers={readyProviders}
                    value={{ provider: session?.provider ?? provider, model: session?.model ?? model }}
                    onChange={(next) => void changeModel(next)}
                    disabled={sending || modelBusy || running || stopping || pending.length > 0}
                    className="min-w-0 max-w-[min(40vw,240px)]"
                  />
                ) : (
                  <span className="hidden h-7 max-w-56 items-center gap-1.5 truncate px-2 sm:flex">
                    <Sparkles size={11} className="shrink-0 text-[var(--accent-primary-hover)]" />
                    {session?.model || model || providerLabel || 'Proveedor IA'}
                  </span>
                )}
                <ContextUsage usage={usage} model={session?.model ?? model} />
              </div>
              {(running || pending.length > 0) && (
                <div className="agent-turn-actions flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="none" className="h-8 gap-1.5 rounded-lg px-2 text-[12px]" aria-label="Dejar para después"
                    onClick={() => void send()} disabled={!draft.trim() || modelBusy || stopping || sending} title="Dejar para después (Intro)">
                    <ListOrdered size={14} aria-hidden="true" /><span>Dejar para después</span>
                  </Button>
                  <Button variant="ghost" size="none" className="h-8 gap-1.5 rounded-lg px-2 text-[12px]" aria-label="Indicar ahora"
                    onClick={() => void send(true)} disabled={!draft.trim() || modelBusy || stopping || sending || sendingCorrection} title="Indicar ahora">
                    <CornerDownRight size={14} aria-hidden="true" /><span>Indicar ahora</span>
                  </Button>
                </div>
              )}
              {(running || pending.length > 0) && (
                <button
                  type="button"
                  className="agent-stop flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--accent-red)]"
                  onClick={() => void cancelTurn()}
                  aria-label="Detener"
                  disabled={stopping}
                  title="Detener el turno"
                >
                  <Square size={12} />
                </button>
              )}
              {!running && pending.length === 0 && <button
                type="button"
                className="agent-send flex size-8 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 active:scale-[0.96] motion-reduce:transform-none disabled:cursor-not-allowed"
                onClick={() => void send()}
                disabled={(!sessionId && !provider) || !draft.trim() || modelBusy || sending}
                aria-label="Enviar"
                title="Enviar (Intro)"
              >
                <ArrowUp size={17} aria-hidden="true" />
              </button>}
            </div>
          </div>
          {visibleReceipts.length > 0 && (
            <div role="region" aria-label="Estado de los envíos" tabIndex={0} className="custom-scrollbar max-h-36 space-y-2 overflow-y-auto px-3 pt-2">
              {visibleReceipts.map((receipt) => (
                <div key={receipt.intent.requestId} className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                  <p role="status" aria-live="polite" aria-atomic="true" className="min-w-0 flex-1">
                    {receipt.phase === 'sending' ? receipt.intent.correction ? 'Enviando indicación…' : 'Enviando mensaje…'
                      : receipt.phase === 'received' ? receipt.intent.correction ? 'Indicación recibida.' : 'Mensaje recibido.'
                        : receipt.intent.correction ? 'Indicación sin confirmar.' : 'Recepción sin confirmar.'}
                    <span className="ml-1 break-words text-[var(--text-muted)]">«{receipt.intent.text.slice(0, 100)}{receipt.intent.text.length > 100 ? '…' : ''}»{receipt.intent.attachments.length > 0 && ` · ${receipt.intent.attachments.length} adjunto${receipt.intent.attachments.length === 1 ? '' : 's'}`}</span>
                  </p>
                  {receipt.phase === 'unconfirmed' && <>
                    <Button variant="ghost" size="sm" aria-label={`Reintentar envío: ${receipt.intent.text}`}
                      title={receipt.reason} disabled={sending || sendingCorrection || modelBusy || stopping} onClick={() => void retrySend(receipt.intent)}>
                      Reintentar
                    </Button>
                    <p className="w-full text-[11px] text-[var(--text-muted)]">{receipt.reason}</p>
                  </>}
                </div>
              ))}
            </div>
          )}
          <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2 text-[12px] text-[var(--text-muted)]">
            {session ? (
              <PermissionPicker
                key={session.id}
                value={session.permission_mode ?? 'auto'}
                onChange={(mode) => void changePermissions(mode)}
                disabled={permissionsBusy || modelBusy || running || stopping || pending.length > 0}
                pending={pending.length}
              />
            ) : <span />}
            <div className="flex min-w-0 items-center gap-1">
              {resumable && !running && pending.length === 0 && (
                <button
                  type="button"
                  className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:opacity-50"
                  onClick={() => void sendSuggestion(RESUME_TEXT)}
                  disabled={sending || modelBusy || stopping}
                  title="Continuar el encargo desde el último paso verificado"
                >
                  <Play size={11} aria-hidden="true" />
                  Reanudar
                </button>
              )}
              <span className="hidden text-[11px] sm:inline">Mayús + Intro para una nueva línea</span>
            </div>
          </div>
        </div>
      </main>

      {browserOpen && <AgentBrowserPanel onClose={() => setBrowserOpen(false)} />}
      {auditOpen && session && (
        <AgentAuditPanel sessions={sessions} sessionId={session.id} onClose={() => setAuditOpen(false)} />
      )}
      {tasksOpen && session && (
        <ScheduledTasksPanel sessions={sessions} sessionId={session.id} onClose={() => setTasksOpen(false)} />
      )}

      {toolsMenu.isOpen && createPortal(
        <div
          ref={toolsMenu.popupRef}
          role="dialog"
          aria-label="Herramientas del agente"
          className="fixed z-[300] flex flex-col gap-2 rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.22),0_2px_6px_rgba(0,0,0,0.08)]"
          style={{
            top: toolsMenu.position?.top ?? -9999,
            left: toolsMenu.position?.left ?? -9999,
            width: toolsMenu.position?.width ?? 360,
            maxHeight: toolsMenu.position?.maxHeight ?? 480,
            visibility: toolsMenu.position ? 'visible' : 'hidden',
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-2">
            <div>
              <h2 className="text-[13px] font-medium text-[var(--text-primary)]">Herramientas del agente</h2>
              <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{toolsBusy ? 'Actualizando herramientas…' : `${toolCount} de ${tools.length} habilitadas`}</p>
            </div>
            <Button variant="ghost" size="none" className="flex size-6 items-center justify-center" aria-label="Cerrar herramientas" onClick={toolsMenu.close}><X size={13} /></Button>
          </div>
          <div className="relative shrink-0">
            <Input ref={toolsSearchRef} value={toolsQuery} onChange={(event) => setToolsQuery(event.target.value)}
              style={{ transitionProperty: 'background-color, border-color, box-shadow, color' }}
              aria-label="Buscar herramientas" placeholder="Buscar por nombre o módulo…" className="w-full pr-8 text-[12px]" />
            {toolsQuery && <Button variant="ghost" size="none" className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center"
              aria-label="Limpiar búsqueda de herramientas" onClick={() => { setToolsQuery(''); toolsSearchRef.current?.focus(); }}><X size={12} /></Button>}
          </div>
          <SegmentedControl value={toolsFilter} onChange={setToolsFilter} aria-label="Filtrar herramientas"
            className="flex shrink-0 gap-0.5 rounded-lg bg-[var(--bg-input)] p-0.5 [&>button]:text-[12px] [&>button[aria-pressed=false]]:text-[var(--text-secondary)]"
            options={[{ value: 'all', label: 'Todas' }, { value: 'skills', label: 'Skills' }, { value: 'mcp', label: 'MCP' }]} />
          {toolsFilter === 'skills' && <p className="shrink-0 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            Adjunta una carpeta con SKILL.md y pide al agente que busque una skill. Estas opciones habilitan sus herramientas de lectura, no instalan skills.
          </p>}
          <div className="custom-scrollbar min-h-0 space-y-2 overflow-y-auto">
            <ToolGroup label="Uso general" names={toolGroups.direct} enabledNames={enabledNames} onToggle={toggleTool} disabled={!sessionId || toolsBusy} expanded={!!toolsQuery.trim() || toolsFilter !== 'all'} />
            <ToolGroup label="Acciones sensibles" names={toolGroups.gated} enabledNames={enabledNames} onToggle={toggleTool} disabled={!sessionId || toolsBusy} expanded={!!toolsQuery.trim() || toolsFilter !== 'all'} />
            <ToolGroup label="MCP" names={toolGroups.mcp} enabledNames={enabledNames} onToggle={toggleTool} disabled={!sessionId || toolsBusy} expanded={!!toolsQuery.trim() || toolsFilter !== 'all'} />
            {tools.length > 0 && filteredTools.length === 0 && <p className="py-2 text-[12px] text-[var(--text-secondary)]">
              {toolsQuery.trim() ? 'No hay coincidencias. Prueba otro nombre o módulo.' : toolsFilter === 'skills' ? 'No hay herramientas de skills disponibles.' : 'No hay herramientas MCP disponibles.'}
            </p>}
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
            {sessionId ? 'La selección se guarda para esta conversación. Las acciones siguen el modo de permisos elegido.' : 'Selecciona una conversación para configurar sus herramientas.'}
          </p>
        </div>,
        document.body,
      )}
    </div>
  );
}
