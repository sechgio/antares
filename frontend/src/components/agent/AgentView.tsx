import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { createPortal } from 'react-dom';
import type { AgentFilePreviewTarget } from '../../api/agentApi';
import { FilePreviewContext } from './filePreviewContext';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  ChevronDown,
  CornerDownLeft,
  CornerDownRight,
  FolderOpen,
  Globe,
  ListOrdered,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pause,
  Pencil,
  Plug,
  Play,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Square,
  Wrench,
  X,
} from 'lucide-react';
import { mcpApi, type McpServer } from '../../api/mcpApi';
import {
  agentApi,
  type AgentApprovalRules,
  type AgentChannel,
  type AgentPermissionMode,
  type AgentReasoningEffort,
  type AgentContext,
  type AgentDelegation,
  type AgentRoom,
  type AgentPlan,
  type AgentProfile,
  type AgentArtifact,
  type AgentQuestion,
  type AgentPanel,
  type AgentPanelResponse,
  type AgentApproval,
  type AgentMessage,
  type AgentSession,
  type AgentSkill,
  type AgentToolSpec,
  type AgentUsage,
} from '../../api/agentApi';
import { aiProvidersApi, type AiProviderSpec } from '../../api/aiProvidersApi';
import { onNotify } from '../../api/core';
import { errorMessage } from '../../utils/errors';
import { useDialog } from '../../hooks/useDialog';
import { useToast } from '../../hooks/useToast';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import { useLocalStorageState } from '../../hooks/useLocalStorageState';
import { useConversationDrafts } from './useConversationDrafts';
import TranscriptSearch from './TranscriptSearch';
import ArtifactShelf from './ArtifactShelf';
import AgentAttentionInbox from './AgentAttentionInbox';
import Button from '../ui/Button';
import { WithHoverTooltip } from '../ui/HoverTooltip';
import ThemedSelect from '../ui/ThemedSelect';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ProviderGlyph } from '../connections/connectionIcons';
import AgentAvatar from './AgentAvatar';
import ModelPicker from './ModelPicker';
import PermissionPicker from './PermissionPicker';
import ReasoningPicker from './ReasoningPicker';
import ContextUsage from './ContextUsage';
import { ArtifactList } from './ArtifactCard';
import QuestionCard from './QuestionCard';
import MemoryMenu from './MemoryMenu';
import ContextChips, { FileCard } from './ContextChips';
import AgentEditor from './AgentEditor';
import ConversationMenu from './ConversationMenu';
import SidebarItemMenu, {
  EMPTY_SIDEBAR_PREFS,
  arrangeSidebar,
  parseSidebarPrefs,
  toggleId,
  type SidebarPrefs,
} from './SidebarItemMenu';
import AgentBrowserPanel from './AgentBrowserPanel';
import ScheduledTasksPanel from './ScheduledTasksPanel';
import { STATUS_LABELS } from './ScheduledTaskHistory';
import SubagentRoster from './SubagentRoster';
import RoomRoster from './RoomRoster';
import AgentProgress from './AgentProgress';
import { useAgentProgress } from './useAgentProgress';
import { METHOD_LABELS } from './methodLabels';
import { useComposerAutocomplete, type ComposerSuggestion } from './useComposerAutocomplete';
import {
  ApprovalCard,
  AssistantTurn,
  DaySeparator,
  MessageRow,
  ToolGroup,
  dayLabel,
  groupTurns,
  placeArtifacts,
  placePanels,
  type TranscriptView,
} from './AgentTimeline';
import { activityText } from './statusPhrase';
import { PlanCard, type PlanEvidence } from './AgentPlanCard';

const AgentFilePreview = lazy(() => import('./AgentFilePreview'));
const POLL_MS = 1500;
const CHAT_CACHE_LIMIT = 6;
const SESSION_KEY = 'antares-agent-session';
const SESSION_ENTRY_KEY = 'antares-agent-session-entry';
const QUEUE_KEY = 'antares-agent-queue';
const PAUSED_QUEUES_KEY = 'antares-agent-paused-message-queues';
const VIEW_KEY = 'antares-agent-transcript-view';
const SIDEBAR_KEY = 'antares-agent-sidebar';
const AGENT_LIMIT = 6;
const parseView = (raw: string): TranscriptView => (raw === 'thinking' || raw === 'verbose' ? raw : 'normal');

type SendIntent = Readonly<{
  session: string;
  text: string;
  requestId: string;
  attachments: readonly string[];
  correction: boolean;
  skillId?: string;
}>;

type ComposerOption =
  | { kind: 'bot'; profile: AgentProfile }
  | { kind: 'skill'; skill: AgentSkill }
  | { kind: 'connector'; mention: string; label: string; detail: string; brand: string | null };

const CONNECTOR_MENTIONS = [
  ['drive', 'Google Drive', 'google', 'Buscar, descargar y subir archivos'],
  ['sheets', 'Hojas de Google', 'google', 'Leer y actualizar hojas de cálculo'],
  ['gmail', 'Gmail', 'google', 'Buscar y leer correos'],
  ['onedrive', 'OneDrive', 'microsoft', 'Buscar, descargar y subir archivos'],
  ['excel', 'Excel', 'microsoft', 'Leer y actualizar libros en OneDrive'],
  ['outlook', 'Outlook', 'microsoft', 'Buscar y leer correos'],
  ['github', 'GitHub', 'github', 'Consultar ejecuciones de GitHub Actions'],
] as const;

function fuzzyGaps(query: string, text: string): number | null {
  let at = -1;
  let gaps = 0;
  for (const char of query) {
    const next = text.indexOf(char, at + 1);
    if (next < 0) return null;
    gaps += next - at - 1;
    at = next;
  }
  return gaps;
}

type SendReceipt = { intent: SendIntent } & (
  | { phase: 'sending' | 'received' }
  | { phase: 'unconfirmed'; reason: string }
);

type ConversationAttention = { key: string; text: string } & (
  | { kind: 'stale' | 'working' }
  | { kind: 'item'; target: string; action: string }
);


function newRequestId(): string {
  return crypto.randomUUID();
}

function isPartialMessage(value: unknown): value is AgentMessage {
  return typeof value === 'object' && value !== null &&
    'role' in value && value.role === 'assistant' && 'partial' in value && value.partial === true &&
    'content' in value && typeof value.content === 'string' && 'ts' in value && typeof value.ts === 'number' &&
    (!('reasoning' in value) || typeof value.reasoning === 'string') &&
    (!('reasoning_ms' in value) || typeof value.reasoning_ms === 'number');
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

type SidebarMenuProps = Omit<ComponentProps<typeof SidebarItemMenu>, 'className' | 'children'>;

function SessionRow({
  session,
  active,
  onSelect,
  menu,
}: {
  session: AgentSession;
  active: boolean;
  onSelect: () => void;
  menu: SidebarMenuProps;
}) {
  return (
    <SidebarItemMenu
      {...menu}
      className={`group relative flex h-9 shrink-0 items-center rounded-lg px-2.5 transition-colors ${
        active ? 'bg-[var(--bg-input)]' : 'hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)]'
      } ${menu.hidden ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        className={`flex h-full min-w-0 flex-1 items-center gap-1.5 text-left text-[13px] leading-[18px] group-hover:pr-6 group-focus-within:pr-6 group-data-[open]:pr-6 ${active || menu.unread ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'} ${menu.unread ? 'font-medium' : ''}`}
        title={session.title || 'Conversación'}
        aria-current={active ? 'page' : undefined}
        onClick={onSelect}
      >
        {session.last_error && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-yellow)]" title={session.last_error} />
        )}
        <span className="truncate">{session.title || 'Conversación'}</span>
        {menu.unread && (
          <span aria-hidden="true" className="ml-auto h-2 w-2 shrink-0 rounded-full bg-[var(--accent-primary)]" />
        )}
      </button>
    </SidebarItemMenu>
  );
}

function SidebarGroupLabel({ children }: { children: string }) {
  return <span className="px-1.5 pb-1 pt-3 text-[12px] font-medium text-[var(--text-muted)]">{children}</span>;
}

export default function AgentView({
  onConfigureProvider,
  onOpenModule,
}: {
  active?: boolean;
  onConfigureProvider?: () => void;
  onOpenModule?: (module: string, id?: string) => void;
}) {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [providers, setProviders] = useState<AiProviderSpec[]>([]);
  const [tools, setTools] = useState<AgentToolSpec[]>([]);
  const [toolsBusy, setToolsBusy] = useState(false);
  const toolsVersionRef = useRef(0);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [sessionEntry, setSessionEntry] = useLocalStorageState<'agent' | 'conversation' | null>(SESSION_ENTRY_KEY, {
    parse: (value) => (value === 'agent' || value === 'conversation' ? value : null),
    fallback: null,
    serialize: (entry) => entry,
  });
  const sessionSelectionRef = useRef(0);
  const profileCreationsRef = useRef(new Map<string, Promise<AgentSession | null>>());
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [earlier, setEarlier] = useState<{ messages: AgentMessage[]; before: number | null } | null>(null);
  const [before, setBefore] = useState<number | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<number | null>(null);
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const [artifactShelfOpen, setArtifactShelfOpen] = useState(false);
  const [pendingTaskOrigin, setPendingTaskOrigin] = useState<{ session: string; id: string } | null>(null);
  const historyRequest = useRef(0);
  const loadedEarlier = useRef(false);
  const prependAnchor = useRef<{ node: HTMLElement; top: number } | null>(null);
  const transcriptRevision = useRef<number | null>(null);
  const lastLiveUpdate = useRef(0);
  const [messagesSessionId, setMessagesSessionId] = useState('');
  const [transcriptView, setTranscriptView] = useLocalStorageState<TranscriptView>(VIEW_KEY, {
    parse: parseView,
    fallback: 'normal',
    serialize: (view) => view,
  });
  const [sidebarPrefs, setSidebarPrefs] = useLocalStorageState<SidebarPrefs>(SIDEBAR_KEY, {
    parse: parseSidebarPrefs,
    fallback: EMPTY_SIDEBAR_PREFS,
  });
  const [showHidden, setShowHidden] = useState(false);
  const [artifacts, setArtifacts] = useState<AgentArtifact[]>([]);
  const [questions, setQuestions] = useState<AgentQuestion[]>([]);
  const [panels, setPanels] = useState<AgentPanel[]>([]);
  const [context, setContext] = useState<AgentContext | null>(null);
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  const [contextWindow, setContextWindow] = useState<number | null>(null);
  const [compactionThresholds, setCompactionThresholds] = useState<{ warn: number; compact: number } | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [pending, setPending] = useState<AgentApproval[]>([]);
  const [running, setRunning] = useState(false);
  const [delegations, setDelegations] = useState<AgentDelegation[]>([]);
  const [rooms, setRooms] = useState<AgentRoom[]>([]);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [tokenBudget, setTokenBudget] = useState<{ limit: number; used: number } | null>(null);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [modelBusy, setModelBusy] = useState(false);
  const [permissionsBusy, setPermissionsBusy] = useState(false);
  const [globalRules, setGlobalRules] = useState<AgentApprovalRules>({});
  const [reasoningBusy, setReasoningBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const sendInFlightRef = useRef(false);
  const [messagesStale, setMessagesStale] = useState(false);
  const [pendingEvidence, setPendingEvidence] = useState<PlanEvidence | null>(null);
  const drafts = useConversationDrafts(sessionId, sessions);
  const { text: draft, attachments, skill: activeSkill } = drafts.current;
  const [skills, setSkills] = useState<AgentSkill[] | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const sessionSearchRef = useRef<HTMLInputElement | null>(null);
  const [toolsQuery, setToolsQuery] = useState('');
  const [toolsFilter, setToolsFilter] = useState<'all' | 'skills' | 'mcp'>('all');
  const toolsSearchRef = useRef<HTMLInputElement | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [editing, setEditing] = useState<AgentProfile | 'new' | null>(null);

  useEffect(() => {
    let cancelled = false;
    agentApi
      .agentProfilesList()
      .then((res) => {
        if (!cancelled) setProfiles(res.profiles);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    agentApi
      .agentPolicyGet()
      .then((res) => {
        if (!cancelled) setGlobalRules(res.rules);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const [deciding, setDeciding] = useState<{ id: string; approved: boolean } | null>(null);
  const decisionRef = useRef<string | null>(null);
  const [filePreview, setFilePreview] = useState<{ sessionId: string; target: AgentFilePreviewTarget } | null>(null);
  useEffect(() => {
    setFilePreview(null);
  }, [sessionId]);
  const [selectingWorkspace, setSelectingWorkspace] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [attentionInboxOpen, setAttentionInboxOpen] = useState(false);
  const [queued, setQueued] = useState<
    {
      session: string;
      text: string;
      requestId: string;
      attachments?: string[];
      failed?: boolean;
      correction?: boolean;
      needsFiles?: boolean;
    }[]
  >(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      return Array.isArray(saved)
        ? saved
            .filter((item) => item && typeof item.session === 'string' && typeof item.text === 'string')
            .map((item) => ({
              session: item.session,
              text: item.text,
              requestId: typeof item.requestId === 'string' ? item.requestId : newRequestId(),
              attachments: Array.isArray(item.attachments)
                ? item.attachments.filter((a: unknown) => typeof a === 'string')
                : [],
              failed: true,
              needsFiles: item.needsFiles === true ||
                (item.failed !== true && Array.isArray(item.attachments) && item.attachments.some((value: unknown) => typeof value === 'string')),
              ...(item.correction === true ? { correction: true } : {}),
            }))
        : [];
    } catch {
      return [];
    }
  });
  const [pausedQueues, setPausedQueues] = useLocalStorageState<string[]>(PAUSED_QUEUES_KEY, {
    fallback: [],
    parse: (raw) => {
      const value: unknown = JSON.parse(raw);
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
    },
    serialize: JSON.stringify,
  });
  const [queueEdit, setQueueEdit] = useState<{ session: string; id: string; text: string } | null>(null);
  const queuePaused = pausedQueues.includes(sessionId) || queueEdit?.session === sessionId;
  const [sendReceipts, setSendReceipts] = useState<SendReceipt[]>([]);
  const requestsInFlightRef = useRef(new Set<string>());
  const restoredDrafts = useRef(new Map<string, { requestId: string; version: number }>());
  const correctionInFlightRef = useRef(false);
  const [sendingCorrection, setSendingCorrection] = useState(false);
  const [stopping, setStopping] = useState(false);
  const timerRef = useRef<number | null>(null);
  const messageRequestsRef = useRef(new Map<string, { queuedSilent?: boolean }>());
  const messageCacheRef = useRef(new Map<string, AgentMessage[]>());
  const messagesVersionRef = useRef(new Map<string, { version: number; pending: number }>());
  const sessionIdRef = useRef('');
  const changingSession = sessionId !== sessionIdRef.current;
  const loadingMessages = !!sessionId && (changingSession || (messagesSessionId !== sessionId && !messagesStale));
  const listRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const [composerOptionsOpen, setComposerOptionsOpen] = useState(false);
  const composerOptionsId = useId();
  const composerOptionsRef = useRef<HTMLButtonElement>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const announcedRef = useRef(new Set<string>());
  const [announcement, setAnnouncement] = useState<{ key: string; text: string } | null>(null);
  const activeCall = messages
    .flatMap((message) => message.tool_calls ?? [])
    .reverse()
    .find((call) => call.status === 'running');
  const artifact = [...artifacts].reverse().find((item) => item.files.length > 0);
  const artifactKey = artifact ? `artifact:${artifact.id}:${artifact.files.map((file) => file.sha256).join(',')}` : '';
  const turns = useMemo(() => groupTurns(earlier?.messages ?? messages), [earlier, messages]);
  const turnArtifacts = useMemo(
    () =>
      placeArtifacts(
        turns,
        artifacts.filter(
          (artifact) =>
            artifact.kind !== 'page' ||
            !panels.some((panel) => panel.type === 'page' && panel.props.artifact_id === artifact.id),
        ),
        before === null && !earlier,
      ),
    [turns, artifacts, panels, before, earlier],
  );
  const turnPanels = useMemo(() => placePanels(turns, panels), [turns, panels]);
  const lastTurn = turns[turns.length - 1];
  const questionTurn = questions.length && lastTurn?.role === 'assistant'
    && lastTurn.messages.some((message) => message.tool_calls?.some((call) => call.name === 'ask_user' && ['running', 'queued'].includes(call.status)))
    ? lastTurn.key : null;
  const openPanel =
    lastTurn?.role === 'assistant'
      ? turnPanels.get(lastTurn.key)?.find((panel) => panel.status === 'open' && (panel.type === 'choice' || panel.type === 'form'))
      : undefined;
  const attention: ConversationAttention | null =
    sessionId !== sessionIdRef.current
      ? null
      : messagesStale
        ? {
            kind: 'stale',
            key: 'stale',
            text: 'No se pudo actualizar la conversación. El estado mostrado puede estar desactualizado.',
          }
        : pending[0]
          ? null
          : questions[0]
            ? {
                kind: 'item',
                key: `question:${questions[0].id}`,
                text: 'El agente necesita tu respuesta para continuar.',
                target: `agent-question-${questions[0].id}`,
                action: 'Responder',
              }
            : running
              ? activeCall || !messages.some((message) => message.partial)
                ? { kind: 'working', key: `working:${activeCall?.id ?? 'turn'}`, text: activityText(activeCall?.name) }
                : null
              : openPanel
                ? {
                    kind: 'item',
                    key: `panel:${openPanel.id}`,
                    text: 'El agente espera tu respuesta en el panel.',
                    target: `agent-panel-${openPanel.id}`,
                    action: 'Responder',
                  }
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
  const contextMenu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    align: 'end',
    estimatedWidth: 360,
    estimatedHeight: 180,
    maxHeightCap: 360,
    stopEscapePropagation: true,
  });
  useEffect(() => {
    contextMenu.close();
  }, [sessionId, contextMenu.close]);
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
      const inFlight = messageRequestsRef.current.get(id);
      if (inFlight) {
        inFlight.queuedSilent = (inFlight.queuedSilent ?? true) && silent;
        return;
      }
      const request: { queuedSilent?: boolean } = {};
      messageRequestsRef.current.set(id, request);
      const version = messagesVersionRef.current.get(id)?.version ?? 0;
      try {
        const res = await agentApi.agentMessagesList(id);
        const current = messagesVersionRef.current.get(id);
        if (id === sessionIdRef.current && version === (current?.version ?? 0) && !current?.pending) {
          const cache = messageCacheRef.current;
          cache.delete(id);
          if (res.messages.length && !res.running && !res.pending_approvals.length && !res.questions?.length) {
            cache.set(id, res.messages);
            const oldest = cache.keys().next().value;
            if (cache.size > CHAT_CACHE_LIMIT && oldest !== undefined) cache.delete(oldest);
          }
          setMessagesSessionId(id);
          setMessagesStale(false);
          const first = res.messages.find((message) => message.id !== undefined)?.id;
          setMessages((previous) => {
            const historical = first !== undefined && loadedEarlier.current
              ? previous.filter((message) => message.id !== undefined && message.id < first)
              : [];
            return [...historical, ...res.messages];
          });
          if (!loadedEarlier.current) setBefore(res.before ?? null);
          transcriptRevision.current = res.revision ?? null;
          setArtifacts(res.artifacts ?? []);
          setQuestions(res.questions ?? []);
          setPanels(res.panels ?? []);
          setDelegations(res.delegations ?? []);
          void agentApi
            .agentRoomsList(id)
            .then((list) => {
              if (id === sessionIdRef.current) setRooms(list.rooms ?? []);
            })
            .catch(() => {});
          setContext(res.context ?? null);
          setUsage(res.usage ?? null);
          setContextWindow(res.context_window ?? null);
          setCompactionThresholds(res.compaction_thresholds ?? null);
          setCompacting(!!res.compacting);
          setPending(res.pending_approvals);
          setRunning(res.running);
          setPlan(res.plan ?? null);
          setTokenBudget(res.token_budget ?? null);
        }
      } catch (err) {
        if (id === sessionIdRef.current) {
          setMessagesStale(true);
          if (!silent) addToast({ message: errorMessage(err, 'No se pudieron cargar los mensajes'), type: 'error' });
        }
      } finally {
        messageRequestsRef.current.delete(id);
        if (request.queuedSilent !== undefined && id === sessionIdRef.current) {
          void loadMessages(id, request.queuedSilent);
        }
      }
    },
    [addToast],
  );

  const {
    items: progress,
    cancelling: cancellingProgress,
    cancel: cancelProgress,
  } = useAgentProgress(sessionId, loadMessages, (message) => addToast({ message, type: 'error' }));

  const refreshSessions = useCallback(async () => {
    try {
      const res = await agentApi.agentSessionsList();
      setSessions(res.sessions);
      return res.sessions;
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron cargar las conversaciones'), type: 'error' });
      return null;
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
    })();
    void (async () => {
      const restored = await refreshSessions();
      const saved = localStorage.getItem(SESSION_KEY);
      if (sessionSelectionRef.current === 0 && saved && restored?.some((s) => s.id === saved)) setSessionId(saved);
    })();
  }, [addToast, refreshSessions]);

  useEffect(() => {
    const version = ++toolsVersionRef.current;
    let cancelled = false;
    setTools([]);
    setToolsBusy(true);
    setToolsQuery('');
    setToolsFilter('all');
    void agentApi
      .agentToolsList(sessionId || undefined)
      .then((res) => {
        if (!cancelled && version === toolsVersionRef.current) setTools(res.tools);
      })
      .catch((err) => {
        if (!cancelled && sessionId)
          addToast({ message: errorMessage(err, 'No se pudieron cargar las herramientas'), type: 'error' });
      })
      .finally(() => {
        if (!cancelled && version === toolsVersionRef.current) setToolsBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, addToast]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    historyRequest.current += 1;
    loadedEarlier.current = false;
    transcriptRevision.current = null;
    lastLiveUpdate.current = 0;
    setEarlier(null);
    setBefore(null);
    setHistoryBusy(false);
    setHistoryTarget(null);
    setArtifactShelfOpen(false);
    if (sessionId) localStorage.setItem(SESSION_KEY, sessionId);
    setMessages(messageCacheRef.current.get(sessionId) ?? []);
    setMessagesSessionId('');
    setArtifacts([]);
    setQuestions([]);
    setPanels([]);
    setContext(null);
    setUsage(null);
    setContextWindow(null);
    setCompactionThresholds(null);
    setCompacting(false);
    setPending([]);
    setDelegations([]);
    setRooms([]);
    setPlan(null);
    setMessagesStale(false);
    if (sessionId) void loadMessages(sessionId, false);
    else setRunning(false);
  }, [sessionId, loadMessages]);

  useEffect(() => {
    if (!sessionId) return undefined;
    return onNotify((method, params) => {
      if (method !== 'agent.changed' || !params || typeof params !== 'object'
          || !('session_id' in params) || params.session_id !== sessionId) return;
      if ('revision' in params && typeof params.revision === 'number' && transcriptRevision.current !== null) {
        if (params.revision <= transcriptRevision.current) return;
        if (params.revision === transcriptRevision.current + 1 && !messageRequestsRef.current.has(sessionId)
            && 'partial' in params && isPartialMessage(params.partial)) {
          transcriptRevision.current = params.revision;
          lastLiveUpdate.current = Date.now();
          const partial = params.partial;
          setMessages((previous) => [
            ...(previous[previous.length - 1]?.partial ? previous.slice(0, -1) : previous), partial,
          ]);
          setRunning(true);
          return;
        }
      }
      lastLiveUpdate.current = 0;
      void loadMessages(sessionId);
    });
  }, [sessionId, loadMessages]);

  useEffect(
    () =>
      onNotify((method, params) => {
        if (method === 'agent.browser' && (params as { reason?: string } | null)?.reason === 'agent-open')
          setBrowserOpen(true);
      }),
    [],
  );

  const handoffPending = messages.some(({ handoff }) =>
    handoff?.status === 'pending' || handoff?.status === 'delivering' ||
    handoff?.status === 'needs_input' || handoff?.status === 'to_verify');
  useEffect(() => {
    const active = Boolean(sessionId) && (running || pending.length > 0 || delegations.length > 0 || handoffPending);
    if (active && timerRef.current == null) {
      timerRef.current = window.setInterval(() => {
        if (Date.now() - lastLiveUpdate.current >= POLL_MS) void loadMessages(sessionId);
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
  }, [sessionId, running, pending.length, delegations.length, handoffPending, loadMessages]);

  useEffect(() => {
    if (atBottomRef.current && !earlier) listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight });
  }, [messages.length, messages[messages.length - 1]?.content, pending.length, attentionKey, artifactKey, earlier]);

  useEffect(() => {
    atBottomRef.current = true;
    setShowJump(false);
  }, [sessionId]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let frame = 0;
    const follow = new ResizeObserver(() => {
      if (!atBottomRef.current || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (atBottomRef.current) list.scrollTo?.({ top: list.scrollHeight });
      });
    });
    const watch = () => {
      follow.disconnect();
      for (const child of list.children) follow.observe(child);
    };
    watch();
    const children = new MutationObserver(watch);
    children.observe(list, { childList: true });
    return () => {
      children.disconnect();
      follow.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = near;
    setShowJump(!near);
  };

  const jumpToEnd = () => {
    if (earlier) setEarlier(null);
    atBottomRef.current = true;
    setShowJump(false);
    listRef.current?.scrollTo?.({
      top: listRef.current.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };

  useLayoutEffect(() => {
    const list = listRef.current;
    if (historyTarget !== null) {
      const row = list?.querySelector<HTMLElement>(`[data-entry-ids~="${historyTarget}"]`);
      row?.scrollIntoView?.({ block: 'center' });
      row?.focus({ preventScroll: true });
      setHistoryTarget(null);
    }
    const anchor = prependAnchor.current;
    if (list && anchor?.node.isConnected) list.scrollTop += anchor.node.getBoundingClientRect().top - anchor.top;
    prependAnchor.current = null;
  }, [turns, historyTarget]);

  const visitHistory = async (target?: number) => {
    const cursor = target ?? (earlier ? earlier.before : before);
    if (historyBusy || cursor === null || !sessionId) return;
    atBottomRef.current = false;
    if (target !== undefined && (earlier?.messages ?? messages).some((message) => message.id === target)) {
      setHistoryTarget(target);
      return;
    }
    const request = ++historyRequest.current;
    setHistoryBusy(true);
    try {
      const page = await (target === undefined
        ? agentApi.agentMessagesBefore(sessionId, cursor)
        : agentApi.agentMessagesAround(sessionId, target));
      if (request !== historyRequest.current || sessionId !== sessionIdRef.current) return;
      if (target !== undefined) {
        if (!page.messages.some((message) => message.id === target)) throw new Error('El mensaje ya no está disponible');
        setEarlier(page);
        setHistoryTarget(target);
        setShowJump(true);
      } else {
        const list = listRef.current;
        if (list) {
          const top = list.getBoundingClientRect().top;
          const node = Array.from(list.querySelectorAll<HTMLElement>('[data-entry-ids]'))
            .find((row) => row.getBoundingClientRect().bottom > top);
          if (node) prependAnchor.current = { node, top: node.getBoundingClientRect().top };
        }
        if (earlier) setEarlier({ messages: [...page.messages, ...earlier.messages], before: page.before });
        else {
          loadedEarlier.current = true;
          setMessages((current) => {
            const ids = new Set(current.map((message) => message.id));
            return [...page.messages.filter((message) => !ids.has(message.id)), ...current];
          });
          setBefore(page.before);
        }
      }
    } catch (error) {
      if (request === historyRequest.current) addToast({ message: errorMessage(error, 'No se pudo cargar el historial'), type: 'error' });
    } finally {
      if (request === historyRequest.current) setHistoryBusy(false);
    }
  };

  const jumpToOrigin = async (kind: 'artifact' | 'task', ref: string) => {
    try {
      const { id } = await agentApi.agentMessageOrigin(sessionId, kind, ref);
      if (sessionId !== sessionIdRef.current) return;
      if (id !== null) await visitHistory(id);
      else if (kind === 'artifact') {
        const card = document.getElementById(`agent-artifact-${ref}`);
        if (card) card.scrollIntoView({ block: 'nearest' });
        else addToast({ message: 'No se encontró el turno de este entregable', type: 'warning' });
      }
    } catch (error) {
      if (sessionId === sessionIdRef.current)
        addToast({ message: errorMessage(error, 'No se pudo abrir el origen'), type: 'error' });
    }
  };

  useEffect(() => {
    if (pendingTaskOrigin?.session !== sessionId || loadingMessages) return;
    setPendingTaskOrigin(null);
    void jumpToOrigin('task', pendingTaskOrigin.id);
  }, [pendingTaskOrigin, sessionId, loadingMessages, jumpToOrigin]);

  const session = sessions.find((s) => s.id === sessionId) ?? null;
  const hideReasoning = sessionEntry === 'agent' || (sessionEntry === null && !!session?.profile);
  const visibleTranscriptView = hideReasoning && transcriptView === 'thinking' ? 'normal' : transcriptView;
  const changePermissions = async (mode: AgentPermissionMode) => {
    if (!sessionId || permissionsBusy) return;
    setPermissionsBusy(true);
    try {
      const { session: updated } = await agentApi.agentSessionPermissionsSet(sessionId, mode);
      setSessions((list) => list.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudieron guardar los permisos'), type: 'error' });
    } finally {
      setPermissionsBusy(false);
    }
  };
  const undoEffect = async (callId: string) => {
    const id = sessionId;
    if (!id) return;
    try {
      await agentApi.agentEffectUndo(id, callId);
      addToast({ message: 'Acción deshecha.', type: 'success' });
      await loadMessages(id, false);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo deshacer la acción'), type: 'error' });
    }
  };
  const changeReasoning = async (effort: AgentReasoningEffort) => {
    if (!sessionId || reasoningBusy) return;
    setReasoningBusy(true);
    try {
      const { session: updated } = await agentApi.agentSessionReasoningSet(sessionId, effort);
      setSessions((list) => list.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo cambiar el razonamiento'), type: 'error' });
    } finally {
      setReasoningBusy(false);
    }
  };
  const queuedForSession = queued.filter((i) => i.session === sessionId);
  const receiptsForSession = sendReceipts.filter((receipt) => receipt.intent.session === sessionId);
  const latestReceipt = receiptsForSession[receiptsForSession.length - 1];
  const visibleReceipts = receiptsForSession.filter(
    (receipt) => receipt.phase !== 'received' || receipt === latestReceipt,
  );
  const receiptsQuiet = visibleReceipts.every((receipt) => receipt.phase === 'received');
  const readyProviders = providers.filter((p) => p.configured && (!p.needs_key || p.has_key));
  const providerLabel = providers.find((p) => p.id === provider)?.label ?? provider;
  const filteredTools = useMemo(() => {
    const query = toolsQuery.trim().toLocaleLowerCase('es');
    return tools.filter(
      (tool) =>
        (toolsFilter === 'all' || (toolsFilter === 'skills' ? tool.name.startsWith('skills_') : tool.kind === 'mcp')) &&
        `${METHOD_LABELS[tool.name] ?? ''} ${tool.name} ${tool.module ?? ''}`.toLocaleLowerCase('es').includes(query),
    );
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
      if (version === toolsVersionRef.current)
        addToast({ message: errorMessage(err, 'No se pudo guardar la selección de herramientas'), type: 'error' });
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
    const query = search.trim().toLocaleLowerCase('es');
    return profiles.filter((profile) =>
      `${profile.name} ${profile.description}`.toLocaleLowerCase('es').includes(query),
    );
  }, [profiles, search]);
  const normalizeBotName = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLocaleLowerCase('es')
      .trim()
      .replace(/[\s_]+/g, '-');
  const composer = useComposerAutocomplete<ComposerOption>(draft, [
    {
      id: 'bot',
      pattern: /(?:^|\s)@(?:"([^"\n]*)|([\p{L}\p{N}_-]*))$/u,
      options: (match) => {
        const query = normalizeBotName(match[1] ?? match[2] ?? '');
        const bots = profiles
          .filter((profile) => normalizeBotName(profile.name).includes(query))
          .slice(0, 6)
          .map((profile) => ({ kind: 'bot' as const, profile }));
        const connectors = [
          ...CONNECTOR_MENTIONS.map(([mention, label, brand, detail]) => ({
            kind: 'connector' as const,
            mention,
            label,
            detail,
            brand,
          })),
          ...mcpServers.map((server) => ({
            kind: 'connector' as const,
            mention: normalizeBotName(server.name),
            label: server.name,
            detail: `Servidor MCP${server.tools_count === null ? '' : ` · ${server.tools_count} herramientas`}`,
            brand: null,
          })),
        ]
          .filter((item) => item.mention.includes(query) || normalizeBotName(item.label).includes(query))
          .slice(0, 10);
        return [...bots, ...connectors];
      },
    },
    {
      id: 'skill',
      pattern: /(?:^|\s)\/([\p{L}\p{N}_-]*)$/u,
      options: (match) => {
        const query = match[1].toLocaleLowerCase('es');
        const ranked: { skill: AgentSkill; gaps: number }[] = [];
        for (const skill of skills ?? []) {
          const gaps = fuzzyGaps(query, skill.name.toLocaleLowerCase('es'));
          if (gaps !== null) ranked.push({ skill, gaps });
        }
        return ranked
          .sort((a, b) => a.gaps - b.gaps)
          .slice(0, 6)
          .map(({ skill }) => ({ kind: 'skill' as const, skill }));
      },
    },
  ]);
  const autocomplete = composer.suggestion;
  const optionId = (option: ComposerOption) =>
    option.kind === 'bot'
      ? `agent-mention-${option.profile.id}`
      : option.kind === 'connector'
        ? `agent-connector-${option.mention}`
        : `agent-skill-${option.skill.id}`;
  const selectedOptionId = autocomplete?.selected ? optionId(autocomplete.selected) : undefined;
  const listboxId = autocomplete?.id === 'bot' ? 'agent-bot-mentions' : 'agent-skill-options';
  useEffect(() => {
    const option = Array.from(suggestionsRef.current?.children ?? []).find(
      (item) => item.getAttribute('aria-selected') === 'true',
    );
    option?.scrollIntoView({ block: 'nearest' });
  }, [selectedOptionId]);
  const skillsOpen = autocomplete?.id === 'skill';
  const mentionsOpen = autocomplete?.id === 'bot';
  useEffect(() => {
    if (!mentionsOpen) return;
    let alive = true;
    mcpApi
      .mcpServersList()
      .then((res) => {
        if (alive) setMcpServers(res.servers);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mentionsOpen]);
  useEffect(() => {
    if (!skillsOpen) return;
    let alive = true;
    agentApi
      .agentSkillsList()
      .then((res) => {
        if (alive) setSkills(res.skills);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setSkills([]);
        addToast({ message: errorMessage(err, 'No se pudo cargar el catálogo de skills'), type: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [skillsOpen]);
  const pickSuggestion = (option: ComposerOption, active: ComposerSuggestion<ComposerOption>) => {
    const token =
      option.kind === 'bot' ? `@bot:${option.profile.id} ` : option.kind === 'connector' ? `@${option.mention} ` : '';
    const caret = active.start + token.length;
    drafts.update(sessionId, (current) => ({
      text: `${draft.slice(0, active.start)}${token}${draft.slice(active.end)}`,
      skill: option.kind === 'skill' ? option.skill : current.skill,
    }), true);
    composer.close(caret);
    window.requestAnimationFrame(() => {
      draftRef.current?.focus();
      draftRef.current?.setSelectionRange(caret, caret);
    });
  };

  const createSession = async (profile?: AgentProfile) => {
    try {
      const res = await agentApi.agentSessionCreate({
        provider,
        model: model || undefined,
        ...(profile ? { profile_id: profile.id } : {}),
      });
      const listed = await refreshSessions();
      if (profile && !listed?.some((s) => s.id === res.session.id)) {
        setSessions((list) => [res.session, ...list.filter((s) => s.id !== res.session.id)]);
      }
      return res.session;
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo crear la conversación'), type: 'error' });
      return null;
    }
  };

  const newSession = async (profile?: AgentProfile, adoptDraft = false) => {
    const selection = ++sessionSelectionRef.current;
    let creation = profile && profileCreationsRef.current.get(profile.id);
    if (!creation) {
      if (!provider) {
        addToast({ message: 'Elige un proveedor IA', type: 'error' });
        return null;
      }
      creation = createSession(profile);
      if (profile) profileCreationsRef.current.set(profile.id, creation);
    }
    const created = await creation;
    if (profile) profileCreationsRef.current.delete(profile.id);
    if (!created) return null;
    if (adoptDraft) drafts.adoptNew(created.id);
    if (selection === sessionSelectionRef.current) {
      setSessionEntry(profile ? 'agent' : 'conversation');
      setSessionId(created.id);
      if (profile?.starter) drafts.update(created.id, () => ({ text: profile.starter }), true);
    }
    return created.id;
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
      drafts.discard(id);
      restoredDrafts.current.delete(id);
      setPausedQueues((current) => toggleId(current, id, false));
      messageCacheRef.current.delete(id);
      const version = messagesVersionRef.current.get(id);
      if (version) version.version += 1;
      else messagesVersionRef.current.set(id, { version: 1, pending: 0 });
      setQueued((q) => q.filter((i) => i.session !== id));
      if (sessionId === id) {
        setSessionEntry(null);
        setSessionId('');
        localStorage.removeItem(SESSION_KEY);
      }
      addToast({ message: 'Conversación eliminada', type: 'success' });
      await refreshSessions();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo eliminar la conversación'), type: 'error' });
    }
  };

  const renameSession = async (id: string, title: string) => {
    try {
      await agentApi.agentSessionRename(id, title);
      await refreshSessions();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo renombrar la conversación'), type: 'error' });
    }
  };

  const setIncognito = async (id: string, incognito: boolean) => {
    try {
      await agentApi.agentSessionIncognitoSet(id, incognito);
      drafts.setPrivate(id, incognito);
      await refreshSessions();
      addToast({ message: incognito ? 'Modo incógnito activado: esta conversación no alimentará la memoria' : 'Modo incógnito desactivado', type: 'success' });
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo cambiar el modo incógnito'), type: 'error' });
    }
  };

  const renameProfile = async (profile: AgentProfile, name: string) => {
    try {
      const res = await agentApi.agentProfileSave({
        id: profile.id,
        name,
        color: profile.color,
        description: profile.description,
        role: profile.role,
        memory_scope: profile.memory_scope,
        instructions: profile.instructions,
        starter: profile.starter,
        daily_tokens: profile.daily_tokens ?? null,
        model: profile.model ?? null,
        tools: profile.tools,
        tools_deny: profile.tools_deny ?? [],
      });
      setProfiles((prev) =>
        prev.map((p) => (p.id === profile.id ? res.profile : p)).sort((a, b) => a.name.localeCompare(b.name, 'es')),
      );
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo renombrar el agente'), type: 'error' });
    }
  };

  const removeProfile = async (profile: AgentProfile) => {
    const ok = await confirm({
      title: 'Borrar agente',
      description: `Se borrará «${profile.name}». Sus conversaciones se conservan.`,
      confirmLabel: 'Borrar',
      type: 'destructive',
    });
    if (!ok) return;
    try {
      await agentApi.agentProfileDelete(profile.id);
      setProfiles((prev) => prev.filter((p) => p.id !== profile.id));
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo borrar el agente'), type: 'error' });
    }
  };

  const markRead = (id: string) => {
    if (sidebarPrefs.unread.includes(id)) setSidebarPrefs((p) => ({ ...p, unread: toggleId(p.unread, id, false) }));
  };

  const selectSession = (id: string, entry: 'agent' | 'conversation' = 'conversation') => {
    sessionSelectionRef.current += 1;
    markRead(id);
    setSessionEntry(entry);
    setSessionId(id);
  };

  const openProfileSession = async (profile: AgentProfile) => {
    const selection = ++sessionSelectionRef.current;
    markRead(profile.id);
    const active = sessions.find((item) => item.id === sessionId && item.profile?.id === profile.id);
    const latest = (list: AgentSession[]) =>
      list.filter((item) => item.profile?.id === profile.id).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))[0];
    const existing = active ?? latest(sessions);
    if (existing) {
      selectSession(existing.id, 'agent');
      return;
    }
    if (profileCreationsRef.current.has(profile.id)) {
      await newSession(profile);
      return;
    }
    const listed = await refreshSessions();
    if (!listed || selection !== sessionSelectionRef.current) return;
    const restored = latest(listed);
    if (restored && !profileCreationsRef.current.has(profile.id)) selectSession(restored.id, 'agent');
    else await newSession(profile);
  };

  const sidebarMenu = (id: string, name: string, noun: 'conversación' | 'agente') => ({
    id,
    name,
    noun,
    renameLabel: noun === 'agente' ? 'Cambiar nombre del agente' : 'Cambiar nombre',
    pinned: sidebarPrefs.pinned.includes(id),
    unread: sidebarPrefs.unread.includes(id),
    hidden: sidebarPrefs.hidden.includes(id),
    section: sidebarPrefs.sections[id],
    onPin: (on: boolean) => setSidebarPrefs((p) => ({ ...p, pinned: toggleId(p.pinned, id, on) })),
    onUnread: (on: boolean) => setSidebarPrefs((p) => ({ ...p, unread: toggleId(p.unread, id, on) })),
    onHidden: (on: boolean) => setSidebarPrefs((p) => ({ ...p, hidden: toggleId(p.hidden, id, on) })),
    onSection: (section: string | null) =>
      setSidebarPrefs((p) => {
        const sections = { ...p.sections };
        if (section) sections[id] = section;
        else delete sections[id];
        return { ...p, sections };
      }),
    onCopied: () => addToast({ message: 'ID copiado', type: 'success' }),
  });

  const recordReceipt = (receipt: SendReceipt) => {
    setSendReceipts((previous) => {
      const matches = (item: SendReceipt) =>
        item.intent.session === receipt.intent.session && item.intent.requestId === receipt.intent.requestId;
      const retained = receipt.phase === 'sending' ? previous.filter((item) => !matches(item)) : previous;
      const next = retained.some(matches)
        ? retained.map((item) => (matches(item) ? receipt : item))
        : [...retained, receipt];
      const latestReceived = [...next]
        .reverse()
        .find((item) => item.intent.session === receipt.intent.session && item.phase === 'received');
      return next.filter(
        (item) =>
          item.intent.session !== receipt.intent.session || item.phase !== 'received' || item === latestReceived,
      );
    });
  };

  const sendToSession = async (input: SendIntent): Promise<boolean> => {
    const intent = { ...input, attachments: [...input.attachments] };
    const { session: id, text: content, requestId, attachments: attachmentIds, correction, skillId } = intent;
    const key = JSON.stringify([id, requestId]);
    if (requestsInFlightRef.current.has(key) || (correction && correctionInFlightRef.current)) return false;
    requestsInFlightRef.current.add(key);
    if (correction) {
      correctionInFlightRef.current = true;
      setSendingCorrection(true);
    }
    recordReceipt({ intent, phase: 'sending' });
    setQueued((previous) =>
      previous.some((item) => item.session === id && item.requestId === requestId)
        ? previous
        : [...previous, { ...intent, attachments: [...attachmentIds], failed: true }],
    );
    const state = messagesVersionRef.current.get(id) ?? { version: 0, pending: 0 };
    messagesVersionRef.current.set(id, state);
    state.version += 1;
    state.pending += 1;
    if (!correction && (id === sessionIdRef.current || !sessionIdRef.current)) setRunning(true);
    try {
      const res = await (
        correction
          ? agentApi.agentMessageSend(id, content, requestId, attachmentIds, true)
          : skillId
            ? agentApi.agentMessageSend(id, content, requestId, attachmentIds, false, skillId)
            : agentApi.agentMessageSend(id, content, requestId, attachmentIds)
      ).finally(() => {
        state.pending -= 1;
      });
      if (res.accepted !== true)
        throw new Error(correction ? 'No se pudo registrar la indicación' : 'No se pudo registrar el mensaje');
      recordReceipt({ intent, phase: 'received' });
      setQueued((previous) => previous.filter((item) => item.session !== id || item.requestId !== requestId));
      const restored = restoredDrafts.current.get(id);
      const clearRestored = restored?.requestId === requestId && restored.version === drafts.version(id);
      if (restored?.requestId === requestId) restoredDrafts.current.delete(id);
      drafts.update(id, (current) => ({
        attachments: current.attachments.filter((file) => !attachmentIds.includes(file.id)),
        skill: skillId && current.skill?.id === skillId ? null : current.skill,
        text: clearRestored ? '' : current.text,
      }));
      for (const file of res.files?.rejected ?? []) {
        addToast({ message: `No se autorizó ${file.path}: ${file.reason}`, type: 'warning' });
      }
      for (const mention of res.mentions?.unknown ?? []) {
        addToast({
          message: `@${mention} no corresponde a ningún agente guardado ni módulo de Antares`,
          type: 'warning',
        });
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
    const skill = suggestion === undefined ? activeSkill : null;
    const content = suggestion ?? (draft.trim() || (skill ? `/${skill.name}` : ''));
    if (
      !content ||
      sendInFlightRef.current ||
      modelBusy ||
      stopping ||
      selectingWorkspace ||
      (correction && correctionInFlightRef.current)
    )
      return;
    if (skill && (correction || running || pending.length > 0)) {
      addToast({ message: 'Espera a que termine el turno en curso para invocar una skill', type: 'warning' });
      return;
    }
    const attachmentIds = suggestion === undefined ? attachments.map((a) => a.id) : [];
    const version = drafts.version(sessionId);
    sendInFlightRef.current = true;
    setSending(true);
    try {
      const id = sessionId || (await newSession(undefined, suggestion === undefined));
      if (!id) return;
      if (suggestion === undefined && version === drafts.version(id))
        drafts.update(id, (current) => ({ text: current.text.trim() === content ? '' : current.text }));
      atBottomRef.current = true;
      const failed = sendReceipts.find(
        (receipt) =>
          receipt.phase === 'unconfirmed' &&
          receipt.intent.session === id &&
          receipt.intent.text === content &&
          receipt.intent.correction === correction &&
          JSON.stringify(receipt.intent.attachments) === JSON.stringify(attachmentIds) &&
          receipt.intent.skillId === skill?.id,
      );
      const requestId = failed?.intent.requestId ?? newRequestId();
      if (!correction && !failed && (running || pending.length > 0 || queuePaused)) {
        setQueued((q) => [...q, { session: id, text: content, requestId, attachments: attachmentIds }]);
        drafts.update(id, (current) => ({ attachments: current.attachments.filter((file) => !attachmentIds.includes(file.id)) }));
        return;
      }
      const ok = await sendToSession({
        session: id,
        text: content,
        requestId,
        attachments: attachmentIds,
        correction,
        ...(skill ? { skillId: skill.id } : {}),
      });
      if (!ok && suggestion === undefined && version === drafts.version(id)) {
        drafts.update(id, (current) => {
          if (current.text.trim()) return {};
          restoredDrafts.current.set(id, { requestId, version });
          return { text: content };
        });
      }
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
    }
  };

  const retrySend = async (intent: SendIntent) => {
    if (sendInFlightRef.current || modelBusy || stopping || (intent.correction && correctionInFlightRef.current))
      return;
    sendInFlightRef.current = true;
    setSending(true);
    try {
      const ok = await sendToSession(intent);
      if (ok)
        setQueued((q) => q.filter((item) => item.session !== intent.session || item.requestId !== intent.requestId));
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
    }
  };

  useEffect(() => {
    if (!sessionId || loadingMessages || running || stopping || modelBusy || messagesStale || pending.length > 0 || queuePaused) return;
    const next = queued.find((i) => i.session === sessionId && !i.failed);
    if (!next) return;
    const sending = { ...next, failed: true };
    setQueued((q) => q.map((i) => (i === next ? sending : i)));
    void (async () => {
      const ok = await sendToSession({
        session: sessionId,
        text: next.text,
        requestId: next.requestId,
        attachments: next.attachments ?? [],
        correction: next.correction === true,
      });
      if (ok) setQueued((q) => q.filter((i) => i !== sending));
    })();
  }, [sessionId, loadingMessages, running, stopping, modelBusy, messagesStale, pending.length, queued, queuePaused]);

  const updateQueuedText = () => {
    if (!queueEdit?.text.trim()) return;
    setQueued((items) => items.map((item) => item.session === queueEdit.session && item.requestId === queueEdit.id && !item.failed
      ? { ...item, text: queueEdit.text.trim() } : item));
    setQueueEdit(null);
  };

  const moveQueued = (item: (typeof queued)[number], neighbor: (typeof queued)[number] | undefined) => {
    if (!neighbor || item.failed || neighbor.failed) return;
    setQueued((items) => {
      const from = items.indexOf(item);
      const to = items.indexOf(neighbor);
      if (from < 0 || to < 0) return items;
      const next = [...items];
      [next[from], next[to]] = [neighbor, item];
      return next;
    });
  };

  const replaceQueuedFiles = async (item: (typeof queued)[number]) => {
    try {
      const result = await agentApi.agentAttach('files');
      if (!result.attachments.length) return;
      const ids = result.attachments.map((file) => file.id);
      setQueued((items) => items.map((entry) => entry === item
        ? { ...entry, attachments: ids, needsFiles: false } : entry));
    } catch (error) {
      addToast({ message: errorMessage(error, 'No se pudieron adjuntar los archivos de nuevo'), type: 'error' });
    }
  };

  const sendCorrection = async (item: (typeof queued)[number]) => {
    if (correctionInFlightRef.current || item.failed) return;
    const correcting = { ...item, correction: true, failed: true };
    setQueued((q) => q.map((i) => (i === item ? correcting : i)));
    const ok = await sendToSession({
      session: item.session,
      text: item.text,
      requestId: item.requestId,
      attachments: item.attachments ?? [],
      correction: true,
    });
    if (ok) setQueued((q) => q.filter((i) => i !== correcting));
  };

  const removeFile = async (path: string) => {
    if (!sessionId) return;
    try {
      await agentApi.agentContextRemoveFile(sessionId, path);
      await loadMessages(sessionId, false);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo retirar el archivo'), type: 'error' });
    }
  };

  const selectWorkspace = async () => {
    const id = sessionId;
    if (!id || selectingWorkspace) return;
    setSelectingWorkspace(true);
    try {
      await agentApi.agentWorkspaceSelect(id);
      if (sessionIdRef.current === id) await loadMessages(id, false);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo seleccionar la carpeta de trabajo'), type: 'error' });
    } finally {
      setSelectingWorkspace(false);
    }
  };

  const setWorkspace = async (path: string) => {
    if (!sessionId) return;
    try {
      await agentApi.agentWorkspaceSet(sessionId, path);
      await loadMessages(sessionId, false);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo cambiar el espacio de trabajo'), type: 'error' });
    }
  };

  const attach = async () => {
    try {
      const res = await agentApi.agentAttach('files');
      if (res.attachments.length)
        drafts.update(sessionId, (current) => ({ attachments: [...current.attachments, ...res.attachments] }), true);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo adjuntar'), type: 'error' });
    }
  };

  const attachFiles = async (files: File[]) => {
    if (!sessionId || !files.length) return;
    const withPath = files.map((file) => ({ file, path: window.electronAPI?.getPathForFile?.(file) || '' }));
    const pasted = withPath.filter((item) => !item.path).map((item) => item.file);
    try {
      const data = await Promise.all(
        pasted.map(
          (file) =>
            new Promise<{ name: string; data: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({ name: file.name || 'captura.png', data: String(reader.result).split(',')[1] ?? '' });
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            }),
        ),
      );
      const ordered = [...withPath.filter((item) => item.path).map((item) => item.file), ...pasted];
      const res = await agentApi.agentAttach('files', {
        paths: withPath.filter((item) => item.path).map((item) => item.path),
        data,
      });
      if (res.attachments.length) {
        drafts.update(sessionId, (current) => ({
          attachments: [...current.attachments, ...res.attachments.map((item, index) =>
            ordered[index]?.type.startsWith('image/') ? { ...item, preview: URL.createObjectURL(ordered[index]) } : item,
          )],
        }), true);
      }
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo adjuntar'), type: 'error' });
    }
  };

  const respondPanel = async (panel: AgentPanel, response: AgentPanelResponse) => {
    if (!sessionId) return;
    if (sendInFlightRef.current || modelBusy || stopping || selectingWorkspace) {
      addToast({ message: 'Espera un momento y vuelve a responder el panel', type: 'warning' });
      return;
    }
    try {
      const { message } = await agentApi.agentPanelRespond(sessionId, panel.id, response);
      setPanels((current) =>
        current.map((item) =>
          item.id === panel.id ? { ...item, status: 'dismissed' in response ? 'dismissed' : 'answered', response } : item,
        ),
      );
      await send(false, message);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo enviar tu respuesta'), type: 'error' });
    }
  };

  const cancelTurn = async () => {
    if (!sessionId) return;
    setStopping(true);
    setQueued((q) => q.map((item) => (item.session === sessionId ? { ...item, failed: true } : item)));
    try {
      await agentApi.agentTurnCancel(sessionId);
      await loadMessages(sessionId);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo detener el turno'), type: 'error' });
    } finally {
      setStopping(false);
    }
  };

  const decide = async (id: string, ok: boolean, opts?: Parameters<typeof agentApi.agentApprove>[1]) => {
    if (decisionRef.current) return;
    decisionRef.current = id;
    setDeciding({ id, approved: ok });
    try {
      if (ok) await agentApi.agentApprove(id, opts);
      else await agentApi.agentDeny(id);
      await loadMessages(sessionId);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo aplicar la decisión'), type: 'error' });
    } finally {
      decisionRef.current = null;
      setDeciding(null);
    }
  };
  const decideWithRule = async (approval: AgentApproval, channel: AgentChannel, rule: 'allow' | 'deny') => {
    if (!session || !channel || decisionRef.current) return;
    decisionRef.current = approval.id;
    setDeciding({ id: approval.id, approved: rule === 'allow' });
    try {
      const decision = { channel, rule };
      if (rule === 'allow') await agentApi.agentApprove(approval.id, decision);
      else await agentApi.agentDeny(approval.id, decision);
      setSessions((list) =>
        list.map((item) =>
          item.id === session.id
            ? { ...item, approval_rules: { ...(item.approval_rules ?? {}), [channel]: rule } }
            : item,
        ),
      );
      try {
        const policy = await agentApi.agentPolicyGet();
        setGlobalRules(policy.rules);
      } catch {}
      await loadMessages(sessionId);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo aplicar la decisión'), type: 'error' });
      const listed = await agentApi.agentSessionsList().catch(() => null);
      if (listed) setSessions(listed.sessions);
    } finally {
      decisionRef.current = null;
      setDeciding(null);
    }
  };

  const showHero = !sessionId || (messagesSessionId === sessionId && messages.length === 0);
  const activeProfile = session?.profile ? (profiles.find((item) => item.id === session.profile?.id) ?? null) : null;
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
      setSessions((prev) => prev.map((item) => (item.id === res.session.id ? res.session : item)));
      setProvider(next.provider);
      setModel(next.model);
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo cambiar el modelo'), type: 'error' });
    } finally {
      setModelBusy(false);
    }
  };

  const previewResource = useCallback(
    (resource: string) => {
      if (sessionId) {
        setBrowserOpen(false);
        setFilePreview({ sessionId, target: { kind: 'resource', resource } });
      }
    },
    [sessionId],
  );
  const evidenceTurn = useCallback((evidence: PlanEvidence) => (
    evidence.kind === 'tool_call'
      ? turns.find((turn) => turn.role === 'assistant' && turn.messages.some((message) =>
        message.tool_calls?.some((call) => call.id === evidence.ref && call.status === 'done')))?.key
      : [...turnArtifacts].find(([, items]) => items.some((item) => item.id === evidence.ref))?.[0]
  ), [turns, turnArtifacts]);
  const revealEvidence = useCallback((evidence: PlanEvidence, turnKey: number) => {
    const turn = document.getElementById(`agent-turn-${turnKey}`);
    const artifact = evidence.kind === 'artifact' && document.getElementById(`agent-artifact-${evidence.ref}`);
    (artifact || turn)?.scrollIntoView({ block: 'nearest' });
    turn?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!pendingEvidence || pendingEvidence.session_id !== sessionId || messagesStale) return;
    const turnKey = evidenceTurn(pendingEvidence);
    if (turnKey === undefined) return;
    revealEvidence(pendingEvidence, turnKey);
    setPendingEvidence(null);
  }, [pendingEvidence, sessionId, messagesStale, evidenceTurn, revealEvidence]);

  const planEvidenceAction = (evidence: PlanEvidence) => {
    const source = evidence.session_id;
    if (source && source !== sessionId) {
      if ((evidence.kind !== 'tool_call' && evidence.kind !== 'artifact') ||
        !sessions.some((item) => item.id === source)) return undefined;
      return () => {
        setPendingEvidence(evidence);
        selectSession(source);
      };
    }
    if (evidence.kind === 'file') return () => previewResource(evidence.ref);
    if (evidence.kind === 'url') return undefined;
    const turnKey = evidenceTurn(evidence);
    if (turnKey === undefined) return undefined;
    return () => revealEvidence(evidence, turnKey);
  };

  return (
    <FilePreviewContext.Provider value={previewResource}>
      <div
        className="agent-workspace relative flex h-full min-h-0 bg-[var(--bg-surface)]"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
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
            providers={readyProviders}
            onClose={() => setEditing(null)}
            onSaved={(saved) => {
              setProfiles((prev) =>
                [...prev.filter((p) => p.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'es')),
              );
              setEditing(null);
              if (editing === 'new' && provider) void newSession(saved);
            }}
            onDeleted={(id) => {
              setProfiles((prev) => prev.filter((p) => p.id !== id));
              setEditing(null);
            }}
          />
        )}
        <aside
          aria-label="Agentes y conversaciones"
          hidden={!sidebarOpen}
          className={`agent-sidebar hidden h-full w-[248px] shrink-0 flex-col bg-[var(--bg-base)] p-2 ${sidebarOpen ? 'md:flex' : ''}`}
        >
          {searchOpen && (
            <div className="shrink-0 p-1">
              <label className="agent-search flex h-9 min-w-0 items-center gap-2 rounded-lg bg-[var(--bg-input)] px-3">
                <Search size={14} className="shrink-0 text-[var(--text-secondary)]" />
                <input
                  ref={sessionSearchRef}
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearch('');
                      setSearchOpen(false);
                    }
                  }}
                  placeholder="Buscar…"
                  aria-label="Buscar agentes y conversaciones"
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                />
                <button
                  type="button"
                  className="flex size-5 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                  aria-label="Cerrar búsqueda"
                  onClick={() => {
                    setSearch('');
                    setSearchOpen(false);
                  }}
                >
                  <X size={12} />
                </button>
              </label>
            </div>
          )}

          <div className="mt-1 flex min-h-0 flex-1 flex-col gap-0.5 px-1">
            {(() => {
              const query = search.trim();
              const arrangedProfiles = arrangeSidebar(visibleProfiles, sidebarPrefs, showHidden || Boolean(query));
              const arrangedSessions = arrangeSidebar(visibleSessions, sidebarPrefs, showHidden || Boolean(query));
              const hiddenCount = arrangedProfiles.hiddenCount + arrangedSessions.hiddenCount;
              const agentGroups = [
                { label: '', items: arrangedProfiles.pinned, grid: true },
                ...arrangedProfiles.sections,
                { label: '', items: arrangedProfiles.rest },
              ];
              const agentTotal = agentGroups.reduce((total, group) => total + group.items.length, 0);
              let agentBudget = agentsExpanded || query ? agentTotal : AGENT_LIMIT;
              const shownAgentGroups = agentGroups
                .map((group) => {
                  const items = group.items.slice(0, agentBudget);
                  agentBudget -= items.length;
                  return { ...group, items };
                })
                .filter((group) => group.items.length > 0);
              const profileRow = (profile: AgentProfile) => {
                const menu = sidebarMenu(profile.id, profile.name, 'agente');
                return (
                  <SidebarItemMenu
                    key={profile.id}
                    {...menu}
                    onRename={(name) => renameProfile(profile, name)}
                    onDelete={() => void removeProfile(profile)}
                    className={`group relative flex h-[50px] shrink-0 items-center gap-2.5 rounded-xl p-1.5 pr-2 transition-colors hover:pr-8 focus-within:pr-8 data-[open]:pr-8 ${activeProfile?.id === profile.id ? 'bg-[var(--bg-input)]' : 'hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)]'} ${menu.hidden ? 'opacity-60' : ''}`}
                  >
                    <AgentAvatar
                      seed={profile.id}
                      color={profile.color}
                      name={profile.name}
                      size={32}
                      className={`shrink-0 ${activeProfile?.id === profile.id ? 'agent-avatar-active' : ''}`}
                    />
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 flex-col text-left"
                      title={`Abrir conversación con ${profile.name}`}
                      onClick={() => void openProfileSession(profile)}
                    >
                      <span
                        className={`truncate text-[13px] leading-5 text-[var(--text-primary)] ${menu.unread ? 'font-semibold' : 'font-medium'}`}
                      >
                        {profile.name}
                      </span>
                      <span className="truncate text-[11px] leading-4 text-[var(--text-muted)]">
                        {profile.description || 'Agente personalizado'}
                      </span>
                    </button>
                    {menu.unread && (
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent-primary)] group-hover:hidden"
                      />
                    )}
                    <button
                      type="button"
                      className="hidden size-6 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_8%,transparent)] hover:text-[var(--text-primary)] group-hover:flex group-focus-within:flex group-data-[open]:flex"
                      aria-label={`Nueva conversación con ${profile.name}`}
                      title="Nueva conversación"
                      onClick={() => {
                        markRead(profile.id);
                        void newSession(profile);
                      }}
                    >
                      <Plus size={13} />
                    </button>
                    <button
                      type="button"
                      className="hidden size-6 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_8%,transparent)] hover:text-[var(--text-primary)] group-hover:flex group-focus-within:flex group-data-[open]:flex"
                      aria-label={`Editar agente ${profile.name}`}
                      title="Editar"
                      onClick={() => setEditing(profile)}
                    >
                      <Pencil size={13} />
                    </button>
                  </SidebarItemMenu>
                );
              };
              const profileTile = (profile: AgentProfile) => {
                const menu = sidebarMenu(profile.id, profile.name, 'agente');
                const active = activeProfile?.id === profile.id;
                return (
                  <SidebarItemMenu
                    key={profile.id}
                    {...menu}
                    onNewConversation={() => {
                      markRead(profile.id);
                      void newSession(profile);
                    }}
                    onRename={(name) => renameProfile(profile, name)}
                    onDelete={() => void removeProfile(profile)}
                    className={`group relative flex min-w-0 flex-col items-center rounded-2xl px-1 pb-2 pt-2.5 transition-colors ${active ? 'bg-[var(--bg-input)]' : 'hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)]'} ${menu.hidden ? 'opacity-60' : ''}`}
                  >
                    <button
                      type="button"
                      className="flex w-full min-w-0 flex-col items-center gap-1.5"
                      title={`Abrir conversación con ${profile.name}`}
                      onClick={() => void openProfileSession(profile)}
                    >
                      <span className="relative">
                        <AgentAvatar
                          seed={profile.id}
                          color={profile.color}
                          name={profile.name}
                          size={48}
                          className={active ? 'agent-avatar-active' : ''}
                        />
                        {menu.unread && (
                          <span
                            aria-hidden="true"
                            className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-[var(--bg-base)] bg-[var(--accent-primary)]"
                          />
                        )}
                      </span>
                      <span
                        className={`w-full truncate text-center text-[12px] leading-4 text-[var(--text-primary)] ${menu.unread ? 'font-semibold' : 'font-medium'}`}
                      >
                        {profile.name}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="absolute left-1.5 top-1.5 hidden size-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_8%,transparent)] hover:text-[var(--text-primary)] group-hover:flex group-focus-within:flex group-data-[open]:flex"
                      aria-label={`Editar agente ${profile.name}`}
                      title="Editar"
                      onClick={() => setEditing(profile)}
                    >
                      <Pencil size={13} />
                    </button>
                  </SidebarItemMenu>
                );
              };
              const sessionRow = (s: AgentSession) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  active={s.id === sessionId}
                  onSelect={() => selectSession(s.id)}
                  menu={{
                    ...sidebarMenu(s.id, s.title || 'Conversación', 'conversación'),
                    onRename: (title) => renameSession(s.id, title),
                    onDelete: () => void removeSession(s.id),
                  }}
                />
              );
              return (
                <>
                  <section aria-label="Agentes" className="custom-scrollbar flex max-h-[60%] shrink-0 flex-col gap-0.5 overflow-y-auto">
                    <div className="flex items-center justify-between px-1.5 pb-1 pt-2">
                      <span className="text-[12px] font-medium text-[var(--text-muted)]">Agentes</span>
                      <button
                        type="button"
                        className="flex size-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
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
                    {profiles.length > 0 && visibleProfiles.length === 0 && (
                      <p className="px-2.5 py-2 text-[12px] text-[var(--text-muted)]">Sin agentes para «{query}».</p>
                    )}
                    {shownAgentGroups.map((group, index) =>
                      group.label ? (
                        <section key={group.label} aria-label={group.label} className="flex flex-col gap-0.5">
                          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                          {group.items.map(profileRow)}
                        </section>
                      ) : 'grid' in group && group.grid ? (
                        <div key={`agents-${index}`} role="group" aria-label="Agentes fijados" className="mb-1 grid grid-cols-3 gap-1">
                          {group.items.map(profileTile)}
                        </div>
                      ) : (
                        <div key={`agents-${index}`} className="flex flex-col gap-0.5">
                          {group.items.map(profileRow)}
                        </div>
                      ),
                    )}
                    {agentTotal > AGENT_LIMIT && !query && (
                      <button
                        type="button"
                        aria-expanded={agentsExpanded}
                        onClick={() => setAgentsExpanded((v) => !v)}
                        className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-left text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--text-primary)_5%,transparent)] hover:text-[var(--text-primary)]"
                      >
                        <ChevronDown size={14} className={agentsExpanded ? 'rotate-180' : ''} />
                        {agentsExpanded ? 'Ver menos' : `Ver todos (${agentTotal})`}
                      </button>
                    )}
                  </section>
                  <div aria-hidden="true" className="mx-1.5 mt-3 shrink-0 border-t border-[var(--border-subtle)]" />
                  <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                    <section aria-label="Conversaciones" className="flex flex-col gap-0.5">
                      <div className="flex items-center justify-between px-1.5 pb-1 pt-2">
                        <span className="text-[12px] font-medium text-[var(--text-muted)]">Conversaciones</span>
                        <span className="flex items-center gap-0.5">
                          <button
                            type="button"
                            className="flex size-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                            aria-label="Buscar agentes y conversaciones"
                            title="Buscar agentes y conversaciones (Ctrl+K)"
                            onClick={() => setSearchOpen(true)}
                          >
                            <Search size={13} />
                          </button>
                          <button
                            type="button"
                            className="flex size-6 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                            aria-label="Nueva conversación"
                            title="Nueva conversación"
                            onClick={() => void newSession()}
                          >
                            <Plus size={14} />
                          </button>
                        </span>
                      </div>
                      {sessions.length === 0 && (
                        <p className="px-2.5 py-2 text-[12px] text-[var(--text-muted)]">Tus chats aparecerán aquí.</p>
                      )}
                      {sessions.length > 0 && visibleSessions.length === 0 && (
                        <p className="px-2.5 py-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
                          Sin resultados para «{query}».
                        </p>
                      )}
                      {[
                        ...(arrangedSessions.pinned.length ? [{ label: 'Fijados', items: arrangedSessions.pinned }] : []),
                        ...arrangedSessions.sections,
                        ...groupSessions(arrangedSessions.rest),
                      ].map((group) => (
                        <section key={group.label} aria-label={group.label} className="flex flex-col gap-0.5">
                          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                          {group.items.map(sessionRow)}
                        </section>
                      ))}
                    </section>
                    {hiddenCount > 0 && !query && (
                      <button
                        type="button"
                        onClick={() => setShowHidden((v) => !v)}
                        className="mt-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-secondary)]"
                      >
                        {showHidden ? 'Ocultar elementos ocultos' : `Mostrar ocultos (${hiddenCount})`}
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </aside>

        <main
          aria-label="Conversación del agente"
          className="agent-conversation relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-base)]"
        >
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
          <nav
            aria-label="Conversaciones"
            className="grid shrink-0 grid-cols-[minmax(0,1fr)_repeat(4,auto)] items-center gap-2 border-b border-[var(--border-subtle)] p-3 md:hidden"
          >
            <ThemedSelect
              value={sessionId}
              onChange={selectSession}
              placeholder="Elegir conversación"
              options={sessions.map((item) => ({ value: item.id, label: item.title || 'Conversación' }))}
              aria-label="Conversación activa"
              className="col-span-full min-w-0"
            />
            {profiles.length > 0 && (
              <ThemedSelect
                value=""
                placeholder="Usar agente…"
                aria-label="Usar agente"
                options={profiles.map((item) => ({ value: item.id, label: item.name }))}
                onChange={(id) => {
                  const chosen = profiles.find((item) => item.id === id);
                  if (chosen) void openProfileSession(chosen);
                }}
                className="min-w-0"
              />
            )}
            <Button size="sm" variant="secondary" aria-label="Crear conversación" onClick={() => void newSession()}>
              <Plus size={14} />
            </Button>
            <Button size="sm" variant="secondary" aria-label="Nuevo agente" onClick={() => setEditing('new')}>
              <Pencil size={14} />
            </Button>
            {sessionId && (
              <Button
                size="sm"
                variant="secondary"
                aria-label="Borrar conversación activa"
                onClick={() => void removeSession(sessionId)}
              >
                <X size={14} />
              </Button>
            )}
            {onConfigureProvider && (
              <Button size="sm" variant="secondary" aria-label="Configurar proveedor" onClick={onConfigureProvider}>
                <Settings2 size={14} />
              </Button>
            )}
          </nav>
          {session && (
            <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3 md:pl-12">
              <div className="flex h-8 min-w-0 items-center">
                <span className="truncate text-[14px] font-medium leading-5 text-[var(--text-primary)]">
                  {session.title || 'Conversación'}
                </span>
              </div>
              <span className="min-w-0 flex-1" />
              {context?.files.some((file) => file.path !== context.workspace) && (
                <Button
                  ref={contextMenu.triggerRef}
                  variant="none"
                  size="none"
                  aria-label="Archivos y accesos"
                  aria-haspopup="dialog"
                  aria-expanded={contextMenu.isOpen}
                  title="Archivos y accesos"
                  onClick={contextMenu.toggle}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                >
                  <Paperclip size={14} />
                </Button>
              )}
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
              <MemoryMenu profiles={profiles} sessionId={sessionId} onTrialQueued={() => setTasksOpen(true)} />
              <Button
                ref={toolsMenu.triggerRef}
                variant="none"
                size="none"
                aria-label="Herramientas del agente"
                aria-haspopup="dialog"
                aria-expanded={toolsMenu.isOpen}
                title="Herramientas del agente"
                onClick={() => {
                  setToolsQuery('');
                  setToolsFilter('all');
                  toolsMenu.toggle();
                }}
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
                view={visibleTranscriptView}
                hideReasoning={hideReasoning}
                onView={setTranscriptView}
                onRename={(title) => renameSession(session.id, title)}
                onDelete={() => void removeSession(session.id)}
                onCopied={() => addToast({ message: 'Conversación copiada', type: 'success' })}
                onIncognito={(incognito) => setIncognito(session.id, incognito)}
              />
            </header>
          )}

          {session && (
            <div className="mx-auto flex w-full max-w-[768px] flex-wrap justify-end gap-1 px-4">
              <Button size="sm" variant="ghost" onClick={() => setAttentionInboxOpen(true)}>Encargos por atender</Button>
              <Button size="sm" variant="ghost" aria-expanded={historySearchOpen}
                onClick={() => setHistorySearchOpen((open) => !open)}>
                <Search size={13} /> Buscar mensajes
              </Button>
              {artifacts.some((artifact) => artifact.files.length > 0) && (
                <Button size="sm" variant="ghost" onClick={() => setArtifactShelfOpen(true)}>Entregables</Button>
              )}
              {earlier && <Button size="sm" variant="ghost" onClick={jumpToEnd}>Volver a mensajes recientes</Button>}
            </div>
          )}
          {session && historySearchOpen && (
            <TranscriptSearch key={session.id} sessionId={session.id}
              onJump={(id) => void visitHistory(id)} onClose={() => setHistorySearchOpen(false)} />
          )}
          {session && artifactShelfOpen && <ArtifactShelf artifacts={artifacts}
            onClose={() => setArtifactShelfOpen(false)} onJump={(id) => {
              setArtifactShelfOpen(false);
              void jumpToOrigin('artifact', id);
            }} />}
          <div
            ref={listRef}
            onScroll={onListScroll}
            role="region"
            aria-label="Mensajes"
            tabIndex={-1}
            className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto [scrollbar-gutter:stable_both-edges] px-4 pb-4 pt-3 [&>*]:mx-auto [&>*]:max-w-[768px]"
          >
            {(earlier ? earlier.before : before) !== null && (
              <div className="flex justify-center">
                <Button size="sm" variant="ghost" disabled={historyBusy} onClick={() => void visitHistory()}>
                  {historyBusy ? 'Cargando…' : 'Cargar mensajes anteriores'}
                </Button>
              </div>
            )}
            {loadingMessages && (changingSession || !messages.length) ? (
              <p role="status" className="py-8 text-center text-sm text-[var(--text-secondary)]">
                Cargando conversación…
              </p>
            ) : showHero ? (
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
                  <p className="mx-auto mt-2 max-w-sm text-[14px] leading-[22px] text-[var(--text-secondary)]">
                    {readyProviders.length === 0
                      ? 'Configura un proveedor en «Proveedores» para empezar.'
                      : activeProfile?.description ||
                        'Puedo ayudarte a preparar informes, revisar documentos y organizar tu trabajo.'}
                  </p>
                </div>
                {readyProviders.length === 0 && onConfigureProvider && (
                  <Button size="sm" onClick={onConfigureProvider}>
                    Configurar IA
                  </Button>
                )}
              </div>
            ) : (
              turns.map((turn, i) => {
                const first = turn.role === 'user' ? turn.message : turn.messages[0];
                const label = first.ts ? dayLabel(first.ts) : '';
                const before = turns[i - 1];
                const previous =
                  before && (before.role === 'user' ? before.message : before.messages[before.messages.length - 1]);
                const newDay = !!label && (!previous?.ts || dayLabel(previous.ts) !== label);
                const results = turnArtifacts.get(turn.key);
                const entryIds = (turn.role === 'user' ? [turn.message] : turn.messages)
                  .flatMap((message) => message.id === undefined ? [] : [message.id]);
                const stableKey = turn.role === 'assistant' && before?.role === 'user' && before.message.id !== undefined
                  ? `after-${before.message.id}` : first.id ?? turn.key;
                return (
                  <div key={`${sessionId}-${turn.role}-${stableKey}`} id={`agent-turn-${turn.key}`}
                    data-entry-ids={entryIds.join(' ')} tabIndex={-1}
                    className="agent-transcript-turn space-y-4">
                    {newDay && <DaySeparator label={label} />}
                    {first.handoff ? (
                      <div className="space-y-1 text-sm text-[var(--text-secondary)]">
                        <p className="break-words">{first.content}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          {first.handoff.status && <span className="text-xs">
                            {first.handoff.status === 'pending' ? 'En cola' : STATUS_LABELS[first.handoff.status]}
                          </span>}
                          {sessions.some((item) => item.id === first.handoff?.peer_session_id) &&
                            <Button variant="ghost" size="sm" onClick={() => {
                              if (first.handoff) selectSession(first.handoff.peer_session_id);
                            }}>Abrir conversación</Button>}
                        </div>
                      </div>
                    ) : turn.role === 'user' ? (
                      <MessageRow msg={turn.message} />
                    ) : (
                      <AssistantTurn
                        messages={turn.messages}
                        startedAt={turn.startedAt}
                        agent={agentIdentity}
                        onUndo={messagesSessionId === sessionId ? undoEffect : undefined}
                        view={visibleTranscriptView}
                        hideReasoning={hideReasoning}
                        panels={turnPanels.get(turn.key)}
                        pendingQuestions={turn.key === questionTurn ? { items: questions, onAnswered: () => void loadMessages(sessionId, false) } : undefined}
                        sessionId={sessionId}
                        onPanelRespond={respondPanel}
                        results={
                          results && (
                            <ArtifactList
                              artifacts={results}
                              sessionId={sessionId}
                              onRefresh={() => void loadMessages(sessionId, false)}
                              onOpenModule={onOpenModule}
                            />
                          )
                        }
                      />
                    )}
                  </div>
                );
              })
            )}
            {!showHero && plan && <PlanCard plan={plan} running={running && !messagesStale} evidenceAction={planEvidenceAction} />}
            {pending.map((a) => (
              <div key={a.id} id={`agent-approval-${a.id}`}>
                <ApprovalCard
                  approval={a}
                  busy={!!deciding}
                  decision={deciding?.id === a.id ? (deciding.approved ? 'approve' : 'deny') : undefined}
                  onDecide={(id, ok, opts) => void decide(id, ok, opts)}
                  onRule={(channel, rule) => void decideWithRule(a, channel, rule)}
                />
              </div>
            ))}
            {turnArtifacts.has(-1) && (
              <div id="agent-turn--1" tabIndex={-1}>
                <ArtifactList
                  artifacts={turnArtifacts.get(-1) ?? []}
                  sessionId={sessionId}
                  onRefresh={() => void loadMessages(sessionId, false)}
                  onOpenModule={onOpenModule}
                />
              </div>
            )}
            {questionTurn === null && questions.map((question) => (
              <div key={question.id}>
                <QuestionCard question={question} onAnswered={() => void loadMessages(sessionId, false)} />
              </div>
            ))}
          </div>

          <div className="relative h-0">
            {showJump && !earlier && (
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
          <div className="mx-auto w-full max-w-[800px] shrink-0 px-4 pb-3">
            {rooms.length > 0 && <RoomRoster rooms={rooms} />}
            <AgentProgress
              items={progress}
              cancelling={cancellingProgress}
              onCancel={(item) => void cancelProgress(item)}
            />
            {delegations.length > 0 && <SubagentRoster items={delegations} />}
            {attention && attention.kind !== 'working' && (
              <div
                role="region"
                aria-label="Atención del agente"
                className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <p className="min-w-0 flex-1 text-[13px] text-[var(--text-secondary)]">{attention.text}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-controls={attention.kind === 'item' ? attention.target : undefined}
                  onClick={() => {
                    if (attention.kind === 'stale') {
                      void loadMessages(sessionId, false);
                    } else if (attention.kind === 'item') {
                      const target = document.getElementById(attention.target);
                      target?.scrollIntoView({
                        block: 'nearest',
                        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
                      });
                      target?.querySelector<HTMLElement>('input, button, summary')?.focus({ preventScroll: true });
                    }
                  }}
                >
                  {attention.kind === 'item' ? attention.action : 'Reintentar actualización'}
                </Button>
              </div>
            )}
            {(queuedForSession.length > 0 || pausedQueues.includes(sessionId)) && (
              <section
                aria-label="Mensajes en cola"
                className="agent-queue mb-2 overflow-hidden rounded-xl border border-[var(--border-subtle)]"
              >
                <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                  <ListOrdered size={14} aria-hidden="true" />
                  <span className="font-medium">En cola</span>
                  <span
                    className="tabular-nums"
                    aria-label={`${queuedForSession.length} mensaje${queuedForSession.length === 1 ? '' : 's'} pendiente${queuedForSession.length === 1 ? '' : 's'}`}
                  >
                    {queuedForSession.length}
                  </span>
                  <span className="ml-auto text-[11px] text-[var(--text-muted)]">{queuePaused ? 'En pausa' : 'Pendientes de envío'}</span>
                  <Button variant="ghost" size="sm" aria-label={pausedQueues.includes(sessionId) ? 'Reanudar mensajes en cola' : 'Pausar mensajes en cola'}
                    onClick={() => setPausedQueues((ids) => toggleId(ids, sessionId, !ids.includes(sessionId)))}>
                    {pausedQueues.includes(sessionId) ? <Play size={13} /> : <Pause size={13} />}
                  </Button>
                </div>
                {queueEdit?.session === sessionId && (
                  <div className="space-y-1 px-3 pb-2">
                    <Textarea aria-label="Editar mensaje en cola" value={queueEdit.text} rows={2}
                      onChange={(event) => setQueueEdit({ ...queueEdit, text: event.target.value })} className="w-full" />
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setQueueEdit(null)}>Cancelar edición</Button>
                      <Button size="sm" onClick={updateQueuedText} disabled={!queueEdit.text.trim()}>Guardar mensaje</Button>
                    </div>
                  </div>
                )}
                <ol aria-label="Orden de envío" className="custom-scrollbar max-h-40 overflow-y-auto px-1 pb-1">
                  {queuedForSession.map((item, idx) => (
                    <li
                      key={item.requestId}
                      className="agent-queue-item flex min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-[12px] text-[var(--text-secondary)]"
                    >
                      <span
                        aria-hidden="true"
                        className="w-4 shrink-0 pt-0.5 text-center text-[11px] tabular-nums text-[var(--text-muted)]"
                      >
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        {requestsInFlightRef.current.has(JSON.stringify([item.session, item.requestId])) ? (
                          <p className="line-clamp-2 break-words" title={item.text}>
                            Enviando: {item.text}
                          </p>
                        ) : item.failed ? (
                          <button
                            type="button"
                            className="line-clamp-2 break-words text-left text-[var(--accent-yellow)]"
                            title="Reintentar el envío pendiente"
                            disabled={modelBusy || stopping || item.needsFiles}
                            onClick={() => {
                              const receipt = sendReceipts.find(
                                (entry) =>
                                  entry.intent.session === item.session && entry.intent.requestId === item.requestId,
                              );
                              if (receipt) void retrySend(receipt.intent);
                              else
                                void sendToSession({
                                  session: item.session,
                                  text: item.text,
                                  requestId: item.requestId,
                                  attachments: item.attachments ?? [],
                                  correction: item.correction === true,
                                });
                            }}
                          >
                            {item.text}
                          </button>
                        ) : (
                          <details className="group/queued">
                            <summary
                              className="flex cursor-pointer list-none items-start gap-1 rounded-sm"
                              title="Ver mensaje completo"
                            >
                              <span className="min-w-0 flex-1 line-clamp-2 break-words [overflow-wrap:anywhere] group-open/queued:line-clamp-none group-open/queued:whitespace-pre-wrap">
                                {item.text}
                              </span>
                              <ChevronDown
                                size={12}
                                aria-hidden="true"
                                className="mt-0.5 shrink-0 text-[var(--text-muted)] transition-transform group-open/queued:rotate-180"
                              />
                            </summary>
                          </details>
                        )}
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                          <span>
                            {requestsInFlightRef.current.has(JSON.stringify([item.session, item.requestId]))
                              ? 'Enviando…'
                              : item.failed
                                ? 'Revisar envío'
                                : item.correction
                                  ? 'Indicación pendiente'
                                  : idx === 0 && !queuePaused
                                    ? 'A continuación'
                                    : 'En espera'}
                          </span>
                          {!!item.attachments?.length && (
                            <span className="inline-flex items-center gap-1">
                              <Paperclip size={10} aria-hidden="true" />
                              {item.attachments.length} adjunto{item.attachments.length === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        {item.needsFiles && <Button size="sm" variant="ghost" onClick={() => void replaceQueuedFiles(item)}>
                          Volver a adjuntar archivos
                        </Button>}
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        {!item.failed && (
                          <>
                            <Button variant="ghost" size="sm" aria-label="Editar en cola" disabled={queueEdit !== null}
                              onClick={() => setQueueEdit({ session: item.session, id: item.requestId, text: item.text })}><Pencil size={12} /></Button>
                            <Button variant="ghost" size="sm" aria-label="Subir en la cola"
                              disabled={idx === 0 || queuedForSession[idx - 1]?.failed}
                              onClick={() => moveQueued(item, queuedForSession[idx - 1])}><ArrowUp size={12} /></Button>
                            <Button variant="ghost" size="sm" aria-label="Bajar en la cola"
                              disabled={idx === queuedForSession.length - 1 || queuedForSession[idx + 1]?.failed}
                              onClick={() => moveQueued(item, queuedForSession[idx + 1])}><ArrowDown size={12} /></Button>
                          </>
                        )}
                        {(running || pending.length > 0) && !item.failed && (
                          <button
                            type="button"
                            className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                            aria-label="Enviar como corrección"
                            title="Enviar ahora como corrección del encargo en curso"
                            disabled={sendingCorrection || stopping || queueEdit?.id === item.requestId}
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
                          disabled={queueEdit?.id === item.requestId || requestsInFlightRef.current.has(JSON.stringify([item.session, item.requestId]))}
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
            {session && (
              <ContextChips
                context={context}
                showFiles={false}
                onRemoveFile={removeFile}
                onSetWorkspace={setWorkspace}
              />
            )}
            <div
              role="group"
              aria-label="Redactar mensaje"
              className={`agent-composer relative rounded-[20px] border bg-[var(--bg-elevated)] transition-[border-color,box-shadow] ${dragging ? 'border-[var(--accent-primary)]' : 'border-[var(--border-medium)]'}`}
              onDragOver={(event) => {
                if (!sessionId || !event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={(event) => {
                if (!event.dataTransfer.files.length) return;
                event.preventDefault();
                setDragging(false);
                void attachFiles([...event.dataTransfer.files]);
              }}
            >
              {autocomplete && (
                <div className="agent-command-palette absolute bottom-full left-0 z-20 mb-2 w-[min(440px,100%)] rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-surface)] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.18),0_2px_6px_rgba(0,0,0,0.06)]">
                  {autocomplete.id === 'skill' && (
                    <p className="px-2.5 pb-1 pt-0.5 text-[11px] text-[var(--text-muted)]">
                      Usar una skill · instrucciones, no permisos
                    </p>
                  )}
                  <div
                    ref={suggestionsRef}
                    id={listboxId}
                    role="listbox"
                    aria-label={autocomplete.id === 'bot' ? 'Bots y conectores para mencionar' : 'Skills disponibles'}
                    className="max-h-72 overflow-y-auto"
                  >
                    {autocomplete.options.map((option, index) => {
                      const previous = autocomplete.options[index - 1];
                      const heading =
                        option.kind !== 'skill' && option.kind !== previous?.kind
                          ? option.kind === 'bot'
                            ? 'Bots · solo lectura'
                            : 'Complementos'
                          : null;
                      return (
                        <Fragment key={optionId(option)}>
                          {heading && (
                            <p aria-hidden="true" className="px-2.5 pb-1 pt-1.5 text-[11px] text-[var(--text-muted)]">
                              {heading}
                            </p>
                          )}
                          <Button
                            id={optionId(option)}
                            role="option"
                            aria-selected={autocomplete.selected === option}
                            tabIndex={-1}
                            variant="none"
                            size="none"
                            className={`flex min-h-9 w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--bg-input)] ${autocomplete.selected === option ? 'bg-[var(--bg-input)]' : ''}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => pickSuggestion(option, autocomplete)}
                          >
                            {option.kind === 'skill' ? (
                              <>
                                <span className="flex size-5 shrink-0 items-center justify-center text-[var(--text-secondary)]">
                                  <Sparkles size={15} />
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[13px]">
                                  <span className="font-medium text-[var(--text-primary)]">/{option.skill.name}</span>
                                  <span className="ml-2.5 text-[var(--text-muted)]">{option.skill.description}</span>
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="flex size-5 shrink-0 items-center justify-center text-[var(--text-secondary)]">
                                  {option.kind === 'bot' ? (
                                    <AgentAvatar
                                      seed={option.profile.id}
                                      color={option.profile.color}
                                      name={option.profile.name}
                                      size={20}
                                    />
                                  ) : option.brand ? (
                                    <ProviderGlyph providerId={option.brand} size={16} />
                                  ) : (
                                    <Plug size={15} />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[13px]">
                                  <span className="text-[var(--text-primary)]">
                                    {option.kind === 'bot' ? option.profile.name : option.label}
                                  </span>
                                  <span className="ml-2 text-[var(--text-muted)]">
                                    {option.kind === 'bot'
                                      ? option.profile.description || 'Agente guardado'
                                      : option.detail}
                                  </span>
                                </span>
                              </>
                            )}
                            {autocomplete.selected === option && (
                              <kbd
                                aria-hidden="true"
                                className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[var(--bg-base)] text-[var(--text-muted)]"
                              >
                                <CornerDownLeft size={11} />
                              </kbd>
                            )}
                          </Button>
                        </Fragment>
                      );
                    })}
                    {autocomplete.options.length === 0 && (
                      <p className="px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)]">
                        {autocomplete.id === 'bot'
                          ? 'Sin bots ni conectores coincidentes. Continúa con tu mensaje.'
                          : skills === null
                            ? 'Cargando skills…'
                            : 'Sin skills coincidentes. Añádelas en Complementos o continúa con tu mensaje.'}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {activeSkill && (
                <div className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Skill activa">
                  <span className="flex max-w-[60%] items-center gap-1 rounded-full bg-[var(--bg-input)] py-0.5 pl-2 pr-1 text-[11px] text-[var(--text-secondary)]">
                    <Sparkles size={11} />
                    <span className="truncate">/{activeSkill.name}</span>
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                      aria-label={`Quitar la skill ${activeSkill.name}`}
                      onClick={() => drafts.update(sessionId, () => ({ skill: null }), true)}
                    >
                      <X size={10} />
                    </button>
                  </span>
                </div>
              )}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Adjuntos">
                  {attachments.map((item) => {
                    return (
                      <div key={item.id} className="agent-attachment relative min-w-0 max-w-full">
                        <Button
                          variant="none"
                          size="none"
                          disabled={item.kind === 'folder'}
                          aria-label={`Previsualizar ${item.name}`}
                          title={item.name}
                          onClick={() => {
                            if (sessionId) {
                              setBrowserOpen(false);
                              setFilePreview({
                                sessionId,
                                target: { kind: 'attachment', id: item.id, name: item.name },
                              });
                            }
                          }}
                          className="flex w-[260px] max-w-full min-w-0 items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-input)] p-2.5 pr-4"
                        >
                          <FileCard path={item.name} folder={item.kind === 'folder'} preview={item.preview} />
                        </Button>
                        <WithHoverTooltip
                          label="Quitar archivo"
                          placement="top"
                          className="absolute -right-1.5 -top-1.5"
                        >
                          <button
                            type="button"
                            className="flex size-5 items-center justify-center rounded-full border border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
                            aria-label={`Quitar ${item.name}`}
                            onClick={() => {
                              drafts.update(sessionId, (current) => ({
                                attachments: current.attachments.filter((a) => a.id !== item.id),
                              }), true);
                            }}
                          >
                            <X size={11} strokeWidth={2.25} />
                          </button>
                        </WithHoverTooltip>
                      </div>
                    );
                  })}
                </div>
              )}
              <textarea
                ref={draftRef}
                rows={1}
                value={draft}
                onChange={(event) => {
                  drafts.update(sessionId, () => ({ text: event.target.value }), true);
                  composer.edited(event.target.selectionStart);
                }}
                onSelect={(event) => composer.moved(event.currentTarget.selectionStart)}
                onPaste={(event) => {
                  if (!sessionId || !event.clipboardData.files.length) return;
                  event.preventDefault();
                  void attachFiles([...event.clipboardData.files]);
                }}
                aria-autocomplete="list"
                aria-controls={autocomplete ? listboxId : undefined}
                aria-activedescendant={selectedOptionId}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
                  if (e.key === 'Enter' && e.repeat && !e.shiftKey) {
                    e.preventDefault();
                    return;
                  }
                  if (composer.keyDown(e, pickSuggestion)) return;
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={running || pending.length > 0 ? 'Añade una indicación…' : 'Escribe un mensaje · @ para mencionar · / para usar una skill'}
                aria-label="Mensaje para el agente"
                title="Intro para enviar · Mayús+Intro para otra línea · @ para mencionar · / para usar una skill"
                className="agent-composer-input block w-full resize-none bg-transparent text-[14px] leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
              />
              <div className="flex min-w-0 items-center gap-1.5 px-2.5 pb-2.5">
                <Button
                  ref={composerOptionsRef}
                  variant="none"
                  size="none"
                  className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                  aria-label="Opciones del mensaje"
                  aria-expanded={composerOptionsOpen}
                  aria-controls={composerOptionsId}
                  aria-description={pending.length > 0 ? `${pending.length} por aprobar` : session?.permission_mode === 'full' ? 'Permisos: Acceso completo' : undefined}
                  title="Opciones del mensaje"
                  onClick={() => setComposerOptionsOpen((open) => !open)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && composerOptionsOpen) {
                      event.stopPropagation();
                      setComposerOptionsOpen(false);
                    }
                  }}
                >
                  <Plus size={16} aria-hidden="true" />
                  {(pending.length > 0 || session?.permission_mode === 'full') && (
                    <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-[var(--accent-yellow)]" aria-hidden="true" />
                  )}
                </Button>
                {readyProviders.length > 0 ? (
                  <ModelPicker
                    providers={readyProviders}
                    value={{ provider: session?.provider ?? provider, model: session?.model ?? model }}
                    onChange={(next) => void changeModel(next)}
                    disabled={sending || modelBusy || reasoningBusy || running || stopping || pending.length > 0}
                    className="agent-composer-model"
                  />
                ) : (
                  <span className="agent-composer-model px-2 text-xs text-[var(--text-secondary)]">
                    <span className="truncate">{session?.model || model || providerLabel || 'Proveedor IA'}</span>
                  </span>
                )}
                {(running || pending.length > 0) && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="none"
                      className="size-8 rounded-full"
                      aria-label="Dejar para después"
                      onClick={() => void send()}
                      disabled={!draft.trim() || modelBusy || stopping || sending}
                      title="Dejar para después (Intro)"
                    >
                      <ListOrdered size={15} aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="none"
                      className="size-8 rounded-full"
                      aria-label="Indicar ahora"
                      onClick={() => void send(true)}
                      disabled={!draft.trim() || modelBusy || stopping || sending || sendingCorrection}
                      title="Indicar ahora"
                    >
                      <CornerDownRight size={15} aria-hidden="true" />
                    </Button>
                  </div>
                )}
                {(running || pending.length > 0) && (
                  <button
                    type="button"
                    className="agent-stop flex size-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50"
                    onClick={() => void cancelTurn()}
                    aria-label="Detener"
                    disabled={stopping}
                    title="Detener el turno"
                  >
                    <Square size={15} fill="currentColor" aria-hidden="true" />
                  </button>
                )}
                {!running && pending.length === 0 && (
                  <button
                    type="button"
                    className="agent-send flex size-9 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 active:scale-[0.96] motion-reduce:transform-none disabled:cursor-not-allowed"
                    onClick={() => void send()}
                    disabled={(!sessionId && !provider) || !draft.trim() || modelBusy || sending || selectingWorkspace}
                    aria-label="Enviar"
                    title="Enviar (Intro)"
                  >
                    <ArrowUp size={18} strokeWidth={2.25} aria-hidden="true" />
                  </button>
                )}
              </div>
              <div
                id={composerOptionsId}
                hidden={!composerOptionsOpen}
                role="group"
                aria-label="Opciones del mensaje"
                className="agent-composer-options flex flex-wrap items-center gap-1 border-t border-[var(--border-medium)] px-2 pb-2 pt-1.5"
                onKeyDown={(event) => {
                  if (event.key !== 'Escape' || !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
                  event.stopPropagation();
                  setComposerOptionsOpen(false);
                  composerOptionsRef.current?.focus();
                }}
              >
                <Button
                  variant="none"
                  size="none"
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:opacity-50"
                  onClick={() => void attach()}
                  disabled={!sessionId}
                  aria-label="Adjuntar archivos"
                  title="Adjuntar archivos (solo lectura para el agente)"
                >
                  <Paperclip size={14} aria-hidden="true" />
                  <span>Adjuntar</span>
                </Button>
                <Button
                  variant="none"
                  size="none"
                  className="flex h-8 min-w-8 max-w-44 shrink items-center justify-center gap-1.5 rounded-full px-2.5 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:opacity-50"
                  onClick={() => void selectWorkspace()}
                  disabled={!sessionId || running || sending || selectingWorkspace}
                  aria-label="Seleccionar carpeta de trabajo"
                  title={
                    context?.workspace
                      ? `Trabajar en ${context.workspace}. Haz clic para cambiar de carpeta`
                      : 'Elegir dónde el agente leerá, creará y editará archivos y ejecutará comandos'
                  }
                >
                  <FolderOpen size={14} className="shrink-0" />
                  <span className="truncate">
                    {selectingWorkspace
                      ? 'Seleccionando…'
                      : context?.workspace?.split(/[\\/]/).filter(Boolean).pop() || 'Carpeta de trabajo'}
                  </span>
                </Button>
                {context?.workspace && (
                  <button
                    type="button"
                    className="-ml-1 flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:opacity-50"
                    onClick={() => {
                      if (context.workspace) void removeFile(context.workspace);
                    }}
                    disabled={!sessionId || selectingWorkspace}
                    aria-label="Quitar la carpeta de trabajo"
                    title="Quitar la carpeta de trabajo y volver a los borradores"
                  >
                    <X size={12} />
                  </button>
                )}
                {session && (
                  <PermissionPicker
                    key={`permissions-${session.id}`}
                    value={session.permission_mode ?? 'auto'}
                    onChange={(mode) => void changePermissions(mode)}
                    disabled={permissionsBusy || modelBusy || running || stopping || pending.length > 0}
                    pending={pending.length}
                    rules={session.approval_rules ?? {}}
                    globalRules={globalRules}
                  />
                )}
                {!!session?.reasoning_levels?.length && (
                  <ReasoningPicker
                    key={`reasoning-${session.id}`}
                    levels={session.reasoning_levels}
                    value={session.reasoning_effort ?? 'low'}
                    model={session.model}
                    onChange={(effort) => void changeReasoning(effort)}
                    disabled={sending || reasoningBusy || modelBusy || running || stopping || pending.length > 0}
                  />
                )}
                <ContextUsage
                  usage={usage}
                  model={session?.model ?? model}
                  contextWindow={contextWindow}
                  thresholds={compactionThresholds}
                  compacting={compacting}
                />
              </div>
            </div>
            {visibleReceipts.length > 0 && (
              <div
                role="region"
                aria-label="Estado de los envíos"
                tabIndex={receiptsQuiet ? undefined : 0}
                className={`${receiptsQuiet ? 'sr-only ' : ''}custom-scrollbar max-h-36 space-y-2 overflow-y-auto px-3 pt-2`}
              >
                {visibleReceipts.map((receipt) => (
                  <div
                    key={receipt.intent.requestId}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[12px] leading-5 text-[var(--text-secondary)]"
                  >
                    <p role="status" aria-live="polite" aria-atomic="true" className="min-w-0 flex-1">
                      {receipt.phase === 'sending'
                        ? receipt.intent.correction
                          ? 'Enviando indicación…'
                          : 'Enviando mensaje…'
                        : receipt.phase === 'received'
                          ? receipt.intent.correction
                            ? 'Indicación recibida.'
                            : 'Mensaje recibido.'
                          : receipt.intent.correction
                            ? 'Indicación sin confirmar.'
                            : 'Recepción sin confirmar.'}
                      <span className="ml-1 break-words text-[var(--text-muted)]">
                        «{receipt.intent.text.slice(0, 100)}
                        {receipt.intent.text.length > 100 ? '…' : ''}»
                        {receipt.intent.attachments.length > 0 &&
                          ` · ${receipt.intent.attachments.length} adjunto${receipt.intent.attachments.length === 1 ? '' : 's'}`}
                      </span>
                    </p>
                    {receipt.phase === 'unconfirmed' && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Reintentar envío: ${receipt.intent.text}`}
                          title={receipt.reason}
                          disabled={sending || sendingCorrection || modelBusy || stopping}
                          onClick={() => void retrySend(receipt.intent)}
                        >
                          Reintentar
                        </Button>
                        <p className="w-full text-[11px] text-[var(--text-muted)]">{receipt.reason}</p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            {tokenBudget && tokenBudget.used >= tokenBudget.limit * 0.8 && (
              <p role="status" className="mt-1.5 text-right text-[12px] text-[var(--accent-yellow)]">
                {tokenBudget.used >= tokenBudget.limit
                  ? 'Este agente agotó su presupuesto diario'
                  : `Este agente usó el ${Math.floor((tokenBudget.used / tokenBudget.limit) * 100)} % de su presupuesto diario`}
                {` (${tokenBudget.used.toLocaleString('es')} de ${tokenBudget.limit.toLocaleString('es')} tokens).`}
              </p>
            )}
          </div>
        </main>

        {filePreview && filePreview.sessionId === sessionId && !browserOpen && (
          <Suspense
            fallback={
              <p role="status" className="p-4 text-sm text-[var(--text-muted)]">
                Abriendo vista previa…
              </p>
            }
          >
            <AgentFilePreview
              key={`${filePreview.sessionId}:${JSON.stringify(filePreview.target)}`}
              sessionId={filePreview.sessionId}
              target={filePreview.target}
              onClose={() => setFilePreview(null)}
            />
          </Suspense>
        )}
        {browserOpen && (
          <AgentBrowserPanel
            onClose={() => setBrowserOpen(false)}
            onAnnotate={
              sessionId
                ? (files, source, notes) => {
                    void attachFiles(files);
                    const context = notes.length ? `\n${notes.join('\n')}\n` : '';
                    if (!draft.trim()) {
                      drafts.update(sessionId, () => ({ text: `Mira mi anotación sobre ${source}: ${context}` }), true);
                    } else if (context) {
                      drafts.update(sessionId, () => ({ text: `${draft.trimEnd()}\n${context}` }), true);
                    }
                  }
                : undefined
            }
          />
        )}
        {tasksOpen && session && (
          <ScheduledTasksPanel sessions={sessions} sessionId={session.id} onClose={() => setTasksOpen(false)} />
        )}
        {attentionInboxOpen && (
          <AgentAttentionInbox sessions={sessions} onClose={() => setAttentionInboxOpen(false)}
            onOpenTask={(task) => {
              setAttentionInboxOpen(false);
              setPendingTaskOrigin({ session: task.session_id, id: task.id });
              selectSession(task.session_id);
            }} />
        )}

        {contextMenu.isOpen &&
          session &&
          createPortal(
            <div
              ref={contextMenu.popupRef}
              role="dialog"
              aria-label="Archivos y accesos"
              className="fixed z-[300] overflow-y-auto rounded-2xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-3 shadow-lg"
              style={{
                top: contextMenu.position?.top ?? -9999,
                left: contextMenu.position?.left ?? -9999,
                width: contextMenu.position?.width ?? 360,
                maxHeight: contextMenu.position?.maxHeight ?? 360,
                visibility: contextMenu.position ? 'visible' : 'hidden',
              }}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-[13px] font-medium text-[var(--text-primary)]">Archivos y accesos</h2>
                <Button
                  variant="ghost"
                  size="none"
                  className="flex size-6 items-center justify-center"
                  aria-label="Cerrar archivos y accesos"
                  onClick={contextMenu.close}
                >
                  <X size={13} />
                </Button>
              </div>
              <ContextChips
                context={context && { ...context, modules: [], accounts: [] }}
                onRemoveFile={removeFile}
                onSetWorkspace={setWorkspace}
              />
            </div>,
            document.body,
          )}
        {toolsMenu.isOpen &&
          createPortal(
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
                  <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                    {toolsBusy ? 'Actualizando herramientas…' : `${toolCount} de ${tools.length} habilitadas`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="none"
                  className="flex size-6 items-center justify-center"
                  aria-label="Cerrar herramientas"
                  onClick={toolsMenu.close}
                >
                  <X size={13} />
                </Button>
              </div>
              <div className="relative shrink-0">
                <Input
                  ref={toolsSearchRef}
                  value={toolsQuery}
                  onChange={(event) => setToolsQuery(event.target.value)}
                  style={{ transitionProperty: 'background-color, border-color, box-shadow, color' }}
                  aria-label="Buscar herramientas"
                  placeholder="Buscar por nombre o módulo…"
                  className="w-full pr-8 text-[12px]"
                />
                {toolsQuery && (
                  <Button
                    variant="ghost"
                    size="none"
                    className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center"
                    aria-label="Limpiar búsqueda de herramientas"
                    onClick={() => {
                      setToolsQuery('');
                      toolsSearchRef.current?.focus();
                    }}
                  >
                    <X size={12} />
                  </Button>
                )}
              </div>
              <SegmentedControl
                value={toolsFilter}
                onChange={setToolsFilter}
                aria-label="Filtrar herramientas"
                className="flex shrink-0 gap-1 [&>button]:flex-none [&>button]:px-2.5 [&>button]:text-[12px] [&>button[aria-pressed=false]]:text-[var(--text-secondary)] [&>button[aria-pressed=true]]:bg-[var(--bg-input)] [&>button[aria-pressed=true]]:shadow-none [&>button[aria-pressed=true]]:ring-0"
                options={[
                  { value: 'all', label: 'Todas' },
                  { value: 'skills', label: 'Skills' },
                  { value: 'mcp', label: 'MCP' },
                ]}
              />
              {toolsFilter === 'skills' && (
                <p className="shrink-0 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                  Elige una carpeta de trabajo con SKILL.md y pide al agente que busque una skill. Estas opciones
                  habilitan sus herramientas de lectura, no instalan skills.
                </p>
              )}
              <div className="custom-scrollbar -mx-1.5 min-h-0 overflow-y-auto px-1.5">
                <ToolGroup
                  label="Uso general"
                  names={toolGroups.direct}
                  enabledNames={enabledNames}
                  onToggle={toggleTool}
                  disabled={!sessionId || toolsBusy}
                  expanded={!!toolsQuery.trim() || toolsFilter !== 'all'}
                />
                <ToolGroup
                  label="Acciones sensibles"
                  names={toolGroups.gated}
                  enabledNames={enabledNames}
                  onToggle={toggleTool}
                  disabled={!sessionId || toolsBusy}
                  expanded={!!toolsQuery.trim() || toolsFilter !== 'all'}
                />
                <ToolGroup
                  label="MCP"
                  names={toolGroups.mcp}
                  enabledNames={enabledNames}
                  onToggle={toggleTool}
                  disabled={!sessionId || toolsBusy}
                  expanded={!!toolsQuery.trim() || toolsFilter !== 'all'}
                />
                {tools.length > 0 && filteredTools.length === 0 && (
                  <p className="py-2 text-[12px] text-[var(--text-secondary)]">
                    {toolsQuery.trim()
                      ? 'No hay coincidencias. Prueba otro nombre o módulo.'
                      : toolsFilter === 'skills'
                        ? 'No hay herramientas de skills disponibles.'
                        : 'No hay herramientas MCP disponibles.'}
                  </p>
                )}
                {tools.length === 0 && (
                  <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                    {toolsBusy ? 'Cargando herramientas…' : 'No hay herramientas disponibles.'}
                  </p>
                )}
              </div>
              <Button variant="ghost" size="sm" disabled={!sessionId || toolsBusy} onClick={() => void saveTools(null)}>
                Restablecer herramientas
              </Button>
              <p className="shrink-0 text-[11px] leading-relaxed text-[var(--text-muted)]">
                {sessionId
                  ? 'La selección se guarda para esta conversación. Las acciones siguen el modo de permisos elegido.'
                  : 'Selecciona una conversación para configurar sus herramientas.'}
              </p>
            </div>,
            document.body,
          )}
      </div>
    </FilePreviewContext.Provider>
  );
}
