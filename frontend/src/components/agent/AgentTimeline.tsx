import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppWindow, ArrowLeft, ArrowRight, Ban, BookOpen, Camera, Check, ChevronDown, ChevronRight, Circle, CircleCheck, CircleDot, CircleX, Copy, Download, FilePen, FileText, FolderOpen, Globe, Hand, Keyboard, ListChecks, Loader2, Monitor, Mouse, MousePointerClick, Network, Package, RotateCw, Route, Search, ShieldCheck, Terminal, TriangleAlert, Upload, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { agentApi, AgentApproval, AgentArtifact, AgentChannel, AgentMessage, AgentPlan, AgentToolCall } from '../../api/agentApi';
import Button from '../ui/Button';
import Toggle from '../ui/Toggle';
import AgentAvatar from './AgentAvatar';
import BrokerReceipt from './BrokerReceipt';
import { DiffStats, FileChangeStep, FileDiff } from './FileDiff';
import { fileChange } from './diffLines';
import MessageMarkdown from './MessageMarkdown';
import Reasoning from './Reasoning';
import SubagentTrace from './SubagentTrace';
import { channelLabel } from './channels';
import { METHOD_LABELS } from './methodLabels';

interface AgentIdentity {
  seed: string;
  color?: string;
  name: string;
}

const DAY_FORMAT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long' });

export function dayLabel(ts: number, now = Date.now()): string {
  const day = new Date(ts);
  const today = new Date(now);
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(today) - start(day)) / 86_400_000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return DAY_FORMAT.format(day);
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-1" role="separator" aria-label={label}>
      <span className="rounded-full bg-[var(--bg-input)] px-[7px] py-1 text-[13px] font-medium leading-[18px] text-[var(--text-secondary)]">
        {label}
      </span>
    </div>
  );
}

const CALL_STATUS_LABEL: Record<string, string> = {
  queued: 'en cola',
  pending: 'esperando aprobación',
  done: 'ejecutada',
  denied: 'rechazada',
  running: 'ejecutando',
  failed: 'fallida',
  submitted: 'enviada · comprueba el resultado',
  interrupted: 'interrumpida · comprueba el resultado',
};

const TOOL_ICONS: Record<string, LucideIcon> = {
  fs_list: FolderOpen,
  fs_read: FileText,
  fs_search: Search,
  fs_write: FilePen,
  fs_edit: FilePen,
  web_open: Globe,
  web_read: BookOpen,
  web_screenshot: Camera,
  web_back: ArrowLeft,
  web_forward: ArrowRight,
  web_reload: RotateCw,
  web_handover: Hand,
  web_text: FileText,
  web_console: Terminal,
  web_network: Network,
  web_click: MousePointerClick,
  web_type: Keyboard,
  web_key: Keyboard,
  web_download: Download,
  web_upload: Upload,
  desktop_observe: Monitor,
  desktop_click: MousePointerClick,
  desktop_type: Keyboard,
  desktop_key: Keyboard,
  desktop_scroll: Mouse,
  desktop_launch: AppWindow,
  desktop_focus: AppWindow,
  ui_click: MousePointerClick,
  ui_type: Keyboard,
  ui_key: Keyboard,
  ui_scroll: Mouse,
  ui_drag: Mouse,
  ui_set_value: Keyboard,
  ui_windows: AppWindow,
  ui_observe: Monitor,
  ui_launch: AppWindow,
  task_plan: ListChecks,
  tools_load: Package,
  skills_list: BookOpen,
  skills_read: BookOpen,
};

const KEY_PARAMS = ['path', 'url', 'query', 'target', 'title', 'keys', 'text', 'name', 'skill_id', 'id'];

function keyArgument(params: Record<string, unknown>): string | null {
  for (const key of KEY_PARAMS) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value.replace(/\s+/g, ' ').trim();
  }
  return null;
}

function prettyJson(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2).replace(/(?<!\\)((?:\\\\)*)\\n/g, '$1\n');
  } catch {
    return text;
  }
}

function ToolCode({ label, children, tone }: { label: string; children: string; tone?: 'error' }) {
  return (
    <div className="group/code">
      <div className="mb-1 flex items-center justify-between text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {label}
        <CopyButton text={children} label={`Copiar ${label.toLowerCase()}`} className="group-hover/code:opacity-100" />
      </div>
      <pre className={`agent-terminal max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--border-subtle)] px-3 py-2 font-mono text-[11.5px] leading-[18px] ${tone === 'error' ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}`}>
        {children}
      </pre>
    </div>
  );
}

function SkillOutput({ method, result }: { method: string; result: string }) {
  const fallback = <ToolCode label="Salida">{prettyJson(result)}</ToolCode>;
  let data: unknown;
  try { data = JSON.parse(result); } catch { return fallback; }
  if (!data || typeof data !== 'object' || 'error' in data) return fallback;
  const original = (
    <details>
      <summary className="cursor-pointer text-[12px] text-[var(--text-secondary)]">Datos originales</summary>
      <ToolCode label="JSON">{result}</ToolCode>
    </details>
  );
  const notice = 'notice' in data && typeof data.notice === 'string' ? data.notice : null;
  if (method === 'skills_list' && 'skills' in data && Array.isArray(data.skills)
    && 'total' in data && typeof data.total === 'number' && 'truncated' in data && typeof data.truncated === 'boolean'
    && 'library' in data && typeof data.library === 'string' && 'warnings' in data && Array.isArray(data.warnings)) {
    const skills = data.skills.map((skill: unknown) => {
      if (!skill || typeof skill !== 'object' || !('id' in skill) || typeof skill.id !== 'string'
        || !('name' in skill) || typeof skill.name !== 'string' || !('description' in skill) || typeof skill.description !== 'string'
        || !('location' in skill) || typeof skill.location !== 'string') return null;
      return { id: skill.id, name: skill.name, description: skill.description, location: skill.location };
    });
    const warnings: unknown[] = data.warnings;
    if (!skills.every((skill) => skill !== null) || !warnings.every((warning) => typeof warning === 'string')) return fallback;
    return (
      <div className="space-y-2 text-[12px] leading-5 text-[var(--text-secondary)]">
        <p className="font-medium">{skills.length} de {data.total} skills{data.truncated ? ' · catálogo parcial' : ''}</p>
        {skills.length === 0 ? <p>No se encontraron skills en los recursos autorizados.</p> : (
          <ul className="space-y-2">
            {skills.map((skill) => <li key={skill.id} className="break-words">
              <p className="font-medium text-[var(--text-primary)]">{skill.name}</p>
              <p>{skill.description}</p>
              <p className="break-all font-mono text-[11px]">{skill.location}</p>
            </li>)}
          </ul>
        )}
        <p className="break-all">Biblioteca local: {data.library}</p>
        {warnings.map((warning, index) => <p key={index} className="break-words">{warning}</p>)}
        {notice && <p className="break-words">{notice}</p>}
        {original}
      </div>
    );
  }
  if (method === 'skills_read' && 'name' in data && typeof data.name === 'string'
    && 'file_path' in data && typeof data.file_path === 'string' && 'content' in data && typeof data.content === 'string'
    && 'offset' in data && typeof data.offset === 'number' && 'total_chars' in data && typeof data.total_chars === 'number'
    && 'next_offset' in data && (data.next_offset === null || typeof data.next_offset === 'number')) {
    return (
      <div className="space-y-2 text-[12px] leading-5 text-[var(--text-secondary)]">
        <p className="break-words font-medium text-[var(--text-primary)]">{data.name}</p>
        <p className="break-all font-mono text-[11px]">{data.file_path}</p>
        <p>Desde el carácter {data.offset} de {data.total_chars}</p>
        <ToolCode label="Contenido">{data.content}</ToolCode>
        <p>{data.next_offset === null ? `Fin del archivo · ${data.total_chars} caracteres en total` : `Lectura parcial · siguiente offset: ${data.next_offset}`}</p>
        {notice && <p className="break-words">{notice}</p>}
        {original}
      </div>
    );
  }
  return fallback;
}

const TASK_ROW = 'flex min-h-6 max-w-full items-center gap-2 py-0.5 text-[13px] leading-5 text-[var(--text-secondary)]';
const TASK_BODY = 'ml-[6.5px] border-l border-[var(--border-subtle)] pl-[15px]';

const TERMINAL_VERB: Record<string, string> = {
  running: 'Ejecutando',
  done: 'Ejecutó',
  failed: 'Falló',
  denied: 'No ejecutó',
  interrupted: 'Interrumpió',
};

function shellOutput(result: string | null | undefined) {
  if (!result) return null;
  try {
    const data = JSON.parse(result) as { exit_code?: unknown; stdout?: unknown; stderr?: unknown; error?: unknown; duration_s?: unknown };
    const clean = (part: unknown) => (typeof part === 'string' ? part.replace(/\n+$/, '') : '');
    const stdout = clean(data.stdout);
    const errors = [clean(data.stderr), clean(data.error)].filter(Boolean).join('\n');
    return {
      exit: typeof data.exit_code === 'number' ? data.exit_code : null,
      text: [stdout, errors].filter(Boolean).join('\n'),
      errorFrom: errors ? (stdout ? stdout.split('\n').length : 0) : Infinity,
      duration: typeof data.duration_s === 'number' ? data.duration_s : null,
    };
  } catch {
    return { exit: null, text: result, errorFrom: Infinity, duration: null };
  }
}

function Elapsed({ since }: { since?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  if (!since) return null;
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="shrink-0 text-[12px] tabular-nums text-[var(--text-muted)]" aria-label={`En curso desde hace ${seconds} s`}>{seconds} s</span>;
}

function TerminalStep({ call }: { call: AgentToolCall }) {
  const command = typeof call.params.command === 'string' ? call.params.command : '';
  const output = shellOutput(call.result);
  const live = call.status === 'running';
  const [open, setOpen] = useState(live || call.status === 'failed' || call.status === 'interrupted');
  const [seen, setSeen] = useState(call.status);
  if (seen !== call.status) {
    setSeen(call.status);
    if (call.status === 'running' || call.status === 'failed' || call.status === 'interrupted') setOpen(true);
  }
  const exitFailed = output?.exit != null && output.exit !== 0;
  const failed = call.status === 'failed' || call.status === 'denied' || exitFailed;
  const text = output ? output.text : (call.output ?? '').replace(/\n+$/, '');
  const lines = text ? text.split('\n') : [];
  const logRef = useRef<HTMLDivElement>(null);
  const followOutputRef = useRef(true);
  useEffect(() => {
    if (logRef.current && followOutputRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [open, text]);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => { if (!open) followOutputRef.current = true; setOpen(!open); }}
        className={`agent-tool-row group ${TASK_ROW} w-full text-left`}
      >
        {live ? <Loader2 size={14} className="shrink-0 animate-spin text-[var(--text-secondary)]" aria-hidden="true" />
          : <Terminal size={14} className={`shrink-0 ${failed ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'}`} aria-hidden="true" />}
        <span title={command} className={`min-w-0 truncate transition-colors ${failed ? 'text-[var(--accent-red)]' : 'group-hover:text-[var(--text-primary)]'}`}>
          {TERMINAL_VERB[call.status] ? `${TERMINAL_VERB[call.status]} ` : ''}<span className="font-mono text-[12px]">{command}</span>
        </span>
        {call.gated && <ShieldCheck size={12} className="shrink-0 text-[var(--text-muted)]" aria-label="Acción sensible" />}
        {!TERMINAL_VERB[call.status] && <span className="shrink-0 text-[12px] text-[var(--text-muted)]">{CALL_STATUS_LABEL[call.status] ?? call.status}</span>}
        {exitFailed && <span className="shrink-0 text-[12px] text-[var(--accent-red)]">código {output?.exit}</span>}
        {output?.duration != null && !live && <span className="shrink-0 text-[12px] tabular-nums text-[var(--text-muted)]">{output.duration} s</span>}
        {live && <Elapsed since={call.started_at} />}
        <ChevronRight size={14} className={`shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className={`${TASK_BODY} group/term mb-1.5 mt-1`}>
          <div className="agent-terminal overflow-hidden rounded-lg border border-[var(--border-subtle)]">
            <div className="flex min-h-7 items-center gap-2 border-b border-[var(--border-subtle)] px-3 text-[11px] text-[var(--text-muted)]">
              <Terminal size={12} className="shrink-0" aria-hidden="true" />
              <span className="shrink-0 font-medium">Terminal</span>
              {typeof call.params.cwd === 'string' && <span className="min-w-0 truncate font-mono" title={call.params.cwd}>{call.params.cwd}</span>}
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                {live ? <span className="agent-shimmer">en curso</span>
                  : output?.exit != null && <span className={exitFailed ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}>salida {output.exit}</span>}
                {!live && output?.text && <CopyButton text={output.text} label="Copiar salida" className="group-hover/term:opacity-100" />}
              </span>
            </div>
            <div ref={logRef} role="log" aria-label={`Salida de ${command}`} aria-busy={live}
              onScroll={(event) => { const log = event.currentTarget; followOutputRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48; }}
              className="max-h-72 overflow-auto px-3 py-2.5 font-mono text-[11.5px] leading-[18px] text-[var(--text-secondary)]">
              <div className="whitespace-pre-wrap break-all text-[var(--text-primary)]"><span className="select-none text-[var(--accent-green)]">$ </span>{command}</div>
              {lines.map((line, i) => (
                <div key={i} className={`whitespace-pre-wrap break-all ${output && i >= output.errorFrom ? 'text-[var(--accent-red)]' : ''}`}>{line || ' '}</div>
              ))}
              {live && <span className="agent-terminal-cursor" aria-hidden="true" />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolCallStep({ call }: { call: AgentToolCall }) {
  if (call.name === 'subagent_run') return <SubagentTrace call={call} />;
  if (call.name === 'shell_run') return <TerminalStep call={call} />;
  if (fileChange(call.name, call.params)) {
    return <FileChangeStep call={call} status={CALL_STATUS_LABEL[call.status] ?? call.status} className={TASK_ROW} />;
  }
  const detail = call.result || null;
  const params = Object.keys(call.params).length > 0 ? JSON.stringify(call.params, null, 2) : null;
  const failed = call.status === 'failed';
  const denied = call.status === 'denied';
  const live = call.status === 'running';
  const Icon = live ? Loader2 : denied ? Ban : TOOL_ICONS[call.name] ?? Wrench;
  const arg = keyArgument(call.params);
  const row = (
    <>
      <Icon size={14} className={`shrink-0 ${live ? 'animate-spin text-[var(--text-secondary)]' : failed ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'}`} aria-hidden="true" />
      <span title={arg ?? undefined} className={`min-w-0 truncate transition-colors ${failed ? 'text-[var(--accent-red)]' : denied ? 'text-[var(--text-muted)]' : 'group-hover:text-[var(--text-primary)]'}`}>
        {METHOD_LABELS[call.name] ?? call.name}
        {arg && <span className={`ml-1.5 font-mono text-[12px] ${failed ? '' : 'text-[var(--text-muted)]'}`}>{arg}</span>}
      </span>
      {call.gated && <ShieldCheck size={12} className="shrink-0 text-[var(--text-muted)]" aria-label="Acción sensible" />}
      <span className={call.status === 'done' ? 'sr-only' : `shrink-0 text-[12px] ${failed ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'}`}>
        {CALL_STATUS_LABEL[call.status] ?? call.status}
      </span>
      {live && <Elapsed since={call.started_at} />}
      {!denied && (params || detail) && <ChevronRight size={14} className="shrink-0 text-[var(--text-muted)] transition-transform duration-200 group-open:rotate-90" aria-hidden="true" />}
    </>
  );
  if (denied || (!params && !detail)) return <div className={`group ${TASK_ROW}`}>{row}</div>;
  return (
    <details className="group" open={failed || call.status === 'interrupted' || undefined}>
      <summary className={`agent-tool-row ${TASK_ROW} cursor-pointer list-none`}>{row}</summary>
      <div className={`${TASK_BODY} mb-1.5 mt-1 space-y-2`}>
        {params && <ToolCode label="Entrada">{params}</ToolCode>}
        {detail && (call.status === 'done' && (call.name === 'skills_list' || call.name === 'skills_read')
          ? <SkillOutput method={call.name} result={detail} />
          : <ToolCode label={failed ? 'Error' : 'Salida'} tone={failed ? 'error' : undefined}>{prettyJson(detail)}</ToolCode>)}
      </div>
    </details>
  );
}

function UserBubble({ msg }: { msg: AgentMessage }) {
  return (
    <div className="agent-trace-in flex justify-end">
      <div className="agent-message-user min-w-0 max-w-[min(600px,88%)] rounded-2xl px-4 py-3 text-[14px] leading-[22px] text-[var(--text-primary)]">
        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.content}</p>
      </div>
    </div>
  );
}

function CopyButton({ text, label = 'Copiar respuesta', className = 'group-hover:opacity-100' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`flex size-5 items-center justify-center rounded-md text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] focus-visible:opacity-100 ${className}`}
      aria-label={copied ? 'Copiado' : label}
      title={copied ? 'Copiado' : 'Copiar'}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
    >
      {copied ? <Check size={13} className="text-[var(--accent-green)]" /> : <Copy size={13} />}
    </button>
  );
}

type ActivityEntry =
  | { kind: 'reasoning'; key: string; text: string; ms?: number; streaming: boolean }
  | { kind: 'note'; key: string; text: string }
  | { kind: 'call'; key: string; call: AgentToolCall };

const NEEDS_REVIEW = ['failed', 'interrupted', 'pending'];

function workDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function liveActivity(entries: ActivityEntry[]): string {
  const calls = entries.flatMap((entry) => (entry.kind === 'call' ? [entry.call] : []));
  const running = [...calls].reverse().find((call) => call.status === 'running');
  if (running) {
    if (running.name === 'shell_run' && typeof running.params.command === 'string') return `Ejecutando ${running.params.command}`;
    return METHOD_LABELS[running.name] ?? running.name;
  }
  if (calls.some((call) => call.status === 'pending')) return 'Esperando tu aprobación';
  if (entries.some((entry) => entry.kind === 'reasoning' && entry.streaming)) return 'Pensando…';
  return 'Trabajando…';
}

function ActivityItem({ entry, onUndo }: { entry: ActivityEntry; onUndo?: (callId: string) => Promise<void> }) {
  if (entry.kind === 'reasoning') return <Reasoning text={entry.text} streaming={entry.streaming} ms={entry.ms} />;
  if (entry.kind === 'note') {
    return (
      <div className="agent-activity-note py-1 text-[13px] leading-5 text-[var(--text-secondary)]">
        <MessageMarkdown text={entry.text} />
      </div>
    );
  }
  return (
    <div>
      <ToolCallStep call={entry.call} />
      {entry.call.gated && <BrokerReceipt call={entry.call} onUndo={onUndo} />}
    </div>
  );
}

function Activity({ entries, working, answering, duration, onUndo }: {
  entries: ActivityEntry[];
  working: boolean;
  answering: boolean;
  duration?: number;
  onUndo?: (callId: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const calls = entries.flatMap((entry) => (entry.kind === 'call' ? [entry.call] : []));
  const live = working && !answering;
  const open = expanded ?? (live || calls.some((call) => NEEDS_REVIEW.includes(call.status)));
  if (entries.length <= 2) {
    return (
      <div className="w-full max-w-[min(620px,100%)] space-y-0.5">
        {entries.map((entry) => <ActivityItem key={entry.key} entry={entry} onUndo={onUndo} />)}
      </div>
    );
  }
  const review = calls.filter((call) => call.status === 'failed' || call.status === 'interrupted').length;
  const icons = [...new Set(calls.map((call) => (call.name === 'shell_run' ? Terminal : TOOL_ICONS[call.name] ?? Wrench)))].slice(0, 4);
  const steps = `${calls.length} ${calls.length === 1 ? 'paso' : 'pasos'}`;
  return (
    <div className="w-full max-w-[min(620px,100%)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setExpanded(!open)}
        className={`agent-tool-row group ${TASK_ROW} w-fit max-w-full pr-2 text-left hover:text-[var(--text-primary)]`}
      >
        {live ? <Loader2 size={14} className="shrink-0 animate-spin text-[var(--text-secondary)]" aria-hidden="true" />
          : (
            <span className="agent-activity-icons flex shrink-0 items-center" aria-hidden="true">
              {icons.map((Icon, index) => (
                <span key={index} className="flex size-[18px] items-center justify-center rounded-full bg-[var(--bg-input)] text-[var(--text-muted)]">
                  <Icon size={11} />
                </span>
              ))}
            </span>
          )}
        <span className={`min-w-0 truncate ${live ? 'agent-shimmer' : ''}`}>
          {live ? liveActivity(entries) : duration ? `Trabajó durante ${workDuration(duration)} · ${steps}` : steps}
        </span>
        {review > 0 && <span className="shrink-0 text-[var(--accent-red)]">· {review} por revisar</span>}
        <ChevronRight size={14} className={`shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className={`${TASK_BODY} agent-activity-body mt-0.5 space-y-0.5`}>
          {entries.map((entry) => <ActivityItem key={entry.key} entry={entry} onUndo={onUndo} />)}
        </div>
      )}
    </div>
  );
}

export type TimelineTurn =
  | { key: number; role: 'user'; message: AgentMessage }
  | { key: number; role: 'assistant'; messages: AgentMessage[]; startedAt?: number };

/** Agrupa los mensajes consecutivos del agente en un único turno: su trabajo y, al final, la respuesta. */
export function groupTurns(messages: AgentMessage[]): TimelineTurn[] {
  const turns: TimelineTurn[] = [];
  let startedAt: number | undefined;
  messages.forEach((message, index) => {
    if (message.role === 'tool_result') return;
    if (message.role === 'user') {
      startedAt = message.ts;
      turns.push({ key: index, role: 'user', message });
      return;
    }
    const last = turns[turns.length - 1];
    if (last?.role === 'assistant') last.messages.push(message);
    else turns.push({ key: index, role: 'assistant', messages: [message], startedAt });
  });
  return turns;
}

function resultArtifactId(result?: string | null): string | null {
  if (!result) return null;
  try {
    const data: unknown = JSON.parse(result);
    if (data && typeof data === 'object' && 'artifact' in data && data.artifact && typeof data.artifact === 'object'
      && 'id' in data.artifact && typeof data.artifact.id === 'string') return data.artifact.id;
  } catch {
    return null;
  }
  return null;
}

/** Sitúa cada resultado en el turno que lo produjo; un mismo archivo repetido solo aparece en su última versión. */
export function placeArtifacts(turns: TimelineTurn[], artifacts: AgentArtifact[]): Map<number, AgentArtifact[]> {
  const latest = new Map<string, AgentArtifact>();
  for (const artifact of artifacts) {
    if (artifact.files.length === 0) continue;
    const signature = artifact.files.map((file) => file.sha256).join(',');
    latest.delete(signature);
    latest.set(signature, artifact);
  }
  const owner = new Map<string, number>();
  for (const turn of turns) {
    if (turn.role !== 'assistant') continue;
    for (const call of turn.messages.flatMap((message) => message.tool_calls ?? [])) {
      const id = resultArtifactId(call.result);
      if (id) owner.set(id, turn.key);
    }
  }
  const fallback = [...turns].reverse().find((turn) => turn.role === 'assistant')?.key ?? -1;
  const placed = new Map<number, AgentArtifact[]>();
  for (const artifact of latest.values()) {
    const key = owner.get(artifact.id) ?? fallback;
    placed.set(key, [...(placed.get(key) ?? []), artifact]);
  }
  return placed;
}

export function AssistantTurn({ messages, agent, onUndo, startedAt, results }: {
  messages: AgentMessage[];
  agent?: AgentIdentity;
  onUndo?: (callId: string) => Promise<void>;
  startedAt?: number;
  results?: ReactNode;
}) {
  const last = messages[messages.length - 1];
  const answer = last?.content && !last.tool_calls?.length ? last : null;
  const entries: ActivityEntry[] = [];
  messages.forEach((message, index) => {
    if (message.reasoning) {
      entries.push({ kind: 'reasoning', key: `reasoning-${index}`, text: message.reasoning, ms: message.reasoning_ms,
        streaming: !!message.partial && !message.content });
    }
    if (message.content && message !== answer) entries.push({ kind: 'note', key: `note-${index}`, text: message.content });
    for (const call of message.tool_calls ?? []) entries.push({ kind: 'call', key: call.id, call });
  });
  const working = messages.some((message) => message.partial)
    || entries.some((entry) => entry.kind === 'call' && ['running', 'queued'].includes(entry.call.status));
  const duration = !working && startedAt && last && last.ts > startedAt ? last.ts - startedAt : undefined;
  const thought = entries.length === 1 && entries[0].kind === 'reasoning' ? entries[0] : null;
  return (
    <div className="agent-trace-in agent-turn group space-y-1.5">
      <div className="flex items-center gap-1.5">
        {agent && <AgentAvatar seed={agent.seed} color={agent.color} name={agent.name} size={18} working={working} />}
        <span className="text-[12px] font-medium leading-5 text-[var(--text-secondary)]">{agent?.name ?? 'Agente'}</span>
        {answer && !answer.partial && <CopyButton text={answer.content} />}
      </div>
      {thought
        ? <Reasoning text={thought.text} streaming={thought.streaming} ms={thought.ms} />
        : entries.length > 0 && <Activity entries={entries} working={working} answering={!!answer} duration={duration} onUndo={onUndo} />}
      {answer && (
        <div className="agent-message-answer min-w-0 max-w-full py-1 text-[14px] leading-[23px] text-[var(--text-primary)]">
          <MessageMarkdown text={answer.content} streaming={!!answer.partial} />
        </div>
      )}
      {results}
    </div>
  );
}

export function MessageRow({ msg, agent, onUndo }: {
  msg: AgentMessage;
  agent?: AgentIdentity;
  onUndo?: (callId: string) => Promise<void>;
}) {
  if (msg.role === 'tool_result') return null;
  return msg.role === 'user' ? <UserBubble msg={msg} /> : <AssistantTurn messages={[msg]} agent={agent} onUndo={onUndo} />;
}

export function ApprovalCard({
  approval,
  busy,
  decision,
  onDecide,
  onRule,
}: {
  approval: AgentApproval;
  busy: boolean;
  decision?: 'approve' | 'deny';
  onDecide: (id: string, ok: boolean, opts?: Parameters<typeof agentApi.agentApprove>[1]) => void;
  onRule?: (channel: AgentChannel, rule: 'allow' | 'deny') => void;
}) {
  const { params, context } = approval;
  const [remember, setRemember] = useState(false);
  const alwaysDomain = approval.method.startsWith('web_') && context?.policy_blocked === false
    && typeof context?.domain === 'string' && context.domain ? context.domain : null;
  const label = Object.prototype.hasOwnProperty.call(METHOD_LABELS, approval.method) ? METHOD_LABELS[approval.method] : undefined;
  const filename = typeof params.filename === 'string' && params.filename ? params.filename : params.name;
  const appGrant = typeof context?.computer?.app === 'string' ? context.computer.app : null;
  const action = approval.method === 'drafts_save' && typeof filename === 'string'
    ? `Guardar ${filename}` : label;
  const ruleChannel = approval.channel ?? null;
  const channel = channelLabel(ruleChannel);
  const facts = [
    typeof params.id === 'string' && `Elemento: ${params.id}`,
    typeof params.name === 'string' && `Nombre: ${params.name}`,
    typeof context?.filename === 'string' && `PDF: ${context.filename}`,
    typeof params.printer_name === 'string' && `Impresora: ${params.printer_name}`,
    typeof params.copies === 'number' && `Copias: ${params.copies} · Páginas: ${String(params.pages || 'Todas')}`,
    typeof params.filename === 'string' && `Nombre de salida: ${params.filename}`,
    typeof params.draft === 'string' && `Borrador: ${params.draft}`,
    approval.method === 'gdrive_upload' && typeof params.replace_file_id === 'string' && `Archivo que se reemplaza: ${params.replace_file_id}`,
    approval.method === 'onedrive_upload' && typeof params.replace_item_id === 'string' && `Archivo que se reemplaza: ${params.replace_item_id}`,
    typeof params.destination_folder === 'string' && `Destino: ${params.destination_folder}`,
    typeof params.folder_id === 'string' && `Carpeta remota: ${params.folder_id}`,
    typeof params.spreadsheet_id === 'string' && `Hoja de cálculo: ${params.spreadsheet_id}`,
    typeof params.item_id === 'string' && `Elemento remoto: ${params.item_id}`,
    typeof params.worksheet === 'string' && `Pestaña: ${params.worksheet}`,
    typeof params.range === 'string' && `Rango: ${params.range}`,
    typeof params.url === 'string' && `Página: ${params.url}`,
    typeof params.cwd === 'string' && `Carpeta: ${params.cwd}`,
    typeof params.path === 'string' && `Ruta: ${params.path}`,
    typeof params.target === 'string' && `Abrir: ${params.target}${typeof params.args === 'string' ? ` ${params.args}` : ''}`,
    typeof params.title === 'string' && `Ventana: ${params.title}`,
    typeof params.keys === 'string' && `Teclas: ${params.keys}`,
    typeof params.text === 'string' && `Texto: ${params.text.slice(0, 200)}`,
    typeof params.x === 'number' && typeof params.y === 'number' && `Punto: (${params.x}, ${params.y})`,
    typeof params.ref === 'string' && `Elemento de la página: ${params.ref}`,
    typeof context?.page_url === 'string' && context.page_url !== params.url && `Página actual: ${context.page_url}`,
    context?.account && `Cuenta: ${context.account}`,
    context?.sheet_id && `Hoja: ${context.sheet_id}`,
    context?.computer?.app && `Aplicación: ${context.computer.app}`,
    context?.computer?.window && `Ventana: ${context.computer.window}`,
    context?.computer?.element && `Elemento: ${context.computer.element}`,
    context?.subagent && `Solicitada por el subagente: ${context.subagent}${context.subagent_role === 'worker' ? ' (worker)' : ''}`,
    ...(approval.resources ?? []).map((resource) => `Archivo: ${resource.path}`),
  ].filter((fact): fact is string => !!fact);
  const Icon = approval.method === 'shell_run' ? Terminal
    : Object.prototype.hasOwnProperty.call(TOOL_ICONS, approval.method) ? TOOL_ICONS[approval.method] : ShieldCheck;
  const ruleButtons = !!(onRule && ruleChannel && channel);
  const change = fileChange(approval.method, params);
  return (
    <div role="group" aria-label="Confirmación de acción" className="agent-approval agent-trace-in">
      <div className="w-full max-w-[min(620px,100%)] overflow-hidden rounded-xl border border-[var(--border-medium)] bg-[var(--bg-surface)]">
        <div className="min-w-0 space-y-2.5 p-3 pb-2">
          <div className="flex items-start gap-2.5">
            <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--text-secondary)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-5 text-[var(--text-primary)]">{action ?? 'Acción sin descripción disponible'}</p>
              <p className="flex min-w-0 items-center gap-1.5 text-[11.5px] leading-4 text-[var(--text-muted)]">
                <span role={decision ? 'status' : undefined} aria-label={decision ? 'Estado de la aprobación' : undefined} className="shrink-0">
                  {decision === 'approve' ? 'Aprobando…' : decision === 'deny' ? 'Rechazando…' : 'Aprobación necesaria'}
                </span>
                {channel && <><span aria-hidden="true">·</span><span className="truncate">{channel}</span></>}
              </p>
            </div>
          </div>
          {approval.method === 'shell_run' && <p className="flex gap-2 text-[12px] leading-[18px] text-[var(--text-secondary)]">
            <TriangleAlert size={13} strokeWidth={1.75} aria-hidden="true" className="mt-[3px] shrink-0 text-[var(--accent-yellow)]" />
            <span>
              Este comando puede acceder al equipo completo con tus permisos, fuera de las carpetas adjuntas.
              Requiere tu aprobación también en Acceso completo.
            </span>
          </p>}
          {(typeof params.command === 'string' || facts.length > 0) && (
            <ul className="space-y-0.5 rounded-lg bg-[var(--bg-base)] px-3 py-2 font-mono text-[11.5px] leading-[18px] text-[var(--text-secondary)]">
              {typeof params.command === 'string' && (
                <li className="break-all text-[var(--text-primary)]"><span aria-hidden="true" className="select-none text-[var(--text-muted)]">$ </span><span>{params.command}</span></li>
              )}
              {facts.map((fact) => <li key={fact} className="break-all">{fact}</li>)}
            </ul>
          )}
          {change && (
            <div className="space-y-1">
              <p className="flex items-center gap-2 text-[11.5px] leading-4 text-[var(--text-muted)]">
                {change.whole ? 'Contenido que se escribirá' : 'Cambios que se aplicarán'}
                <DiffStats change={change} />
              </p>
              <FileDiff change={change} className="max-h-56" />
            </div>
          )}
          <details className="group text-[11.5px] text-[var(--text-muted)]">
            <summary aria-label="Ver detalles de la acción" className="flex w-fit cursor-pointer list-none items-center gap-1 transition-colors hover:text-[var(--text-secondary)]">
              <ChevronRight size={12} className="transition-transform duration-200 group-open:rotate-90" />
              Detalles
            </summary>
            <p className="mt-1.5 leading-[17px] text-[var(--text-secondary)]">
              {action ? 'Permitir autoriza solo esta acción.' : 'Revisa los detalles antes de permitir esta acción.'}
              {' '}Rechazar la omite e informa al agente.
            </p>
            <code className="mt-1 block text-[11px]">{approval.method}</code>
            {Object.keys(params).length > 0 && (
              <pre className="agent-terminal mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--border-subtle)] p-2 text-[11px] text-[var(--text-secondary)]">
                {JSON.stringify(params, null, 2)}
              </pre>
            )}
          </details>
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 px-3 pb-3">
          <div className="mr-auto flex min-w-0 flex-wrap items-center gap-1 text-[var(--text-muted)]">
            {ruleButtons && ruleChannel && (
              <>
                {ruleChannel !== 'terminal' && ruleChannel !== 'other' && (
                  <Button size="sm" variant="ghost" className="!text-[11.5px] !text-[var(--text-muted)] hover:!text-[var(--text-primary)]"
                    aria-label={`Permitir siempre este canal en esta conversación: ${channel}`}
                    disabled={busy || !!decision} onClick={() => onRule?.(ruleChannel, 'allow')}>
                    Siempre en este chat
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="!text-[11.5px] !text-[var(--text-muted)] hover:!text-[var(--text-primary)]"
                  aria-label="Bloquear este canal en esta conversación"
                  disabled={busy || !!decision} onClick={() => onRule?.(ruleChannel, 'deny')}>
                  Bloquear en este chat
                </Button>
              </>
            )}
            {alwaysDomain ? (
              <label className="flex cursor-pointer items-center gap-2 px-1 text-[11.5px] leading-5 text-[var(--text-secondary)]">
                <Toggle checked={remember} disabled={busy} aria-label={`Permitir siempre en ${alwaysDomain}`}
                  onChange={setRemember} />
                Permitir siempre en {alwaysDomain}
              </label>
            ) : !ruleButtons && (
              <span className="px-1 text-[11.5px] leading-5">{appGrant ? 'Solo esta acción · o siempre en esta app' : 'Solo esta acción'}</span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" aria-label="Rechazar esta acción" disabled={busy} onClick={() => onDecide(approval.id, false)}>
              {decision === 'deny' && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
              Rechazar
            </Button>
            {appGrant && (
              <Button size="sm" variant="secondary" aria-label={`Permitir esta acción y las siguientes sobre ${appGrant} durante la sesión`} disabled={busy}
                onClick={() => onDecide(approval.id, true, { grantApp: true })}>
                {decision === 'approve' && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
                Siempre esta app
              </Button>
            )}
            <Button size="sm" aria-label="Permitir esta acción" disabled={busy}
              onClick={() => alwaysDomain ? onDecide(approval.id, true, { remember }) : onDecide(approval.id, true)}>
              {decision === 'approve' && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
              Permitir
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanStepIcon({ status }: { status: AgentPlan['steps'][number]['status'] }) {
  if (status === 'done') return <CircleCheck size={14} className="text-[var(--text-secondary)]" aria-label="Hecho" />;
  if (status === 'failed') return <CircleX size={14} className="text-[var(--accent-red)]" aria-label="Fallido" />;
  if (status === 'in_progress') return <CircleDot size={14} className="text-[var(--text-primary)]" aria-label="En curso" />;
  return <Circle size={14} className="text-[var(--text-muted)] opacity-70" aria-label="Pendiente" />;
}

export function PlanCard({ plan, running }: { plan: AgentPlan; running: boolean }) {
  const [open, setOpen] = useState(true);
  const done = plan.steps.filter((step) => step.status === 'done').length;
  return (
    <section aria-label="Plan del agente" className="agent-trace-in max-w-[min(620px,100%)] text-[13px] leading-5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group flex max-w-full items-center gap-2 rounded-md py-0.5 text-left text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <Route size={14} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate" title={plan.goal}>Plan: {plan.goal}</span>
        <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{done} de {plan.steps.length} hechos</span>
        <ChevronDown size={14} className={`shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
      </button>
      {open && (
        <ol className="ml-[6.5px] mt-1 space-y-1 border-l border-[var(--border-subtle)] pl-[13px]">
          {plan.steps.map((step, index) => (
            <li key={`${index}-${step.title}`} className="flex items-start gap-2">
              <span className="flex h-5 shrink-0 items-center"><PlanStepIcon status={step.status} /></span>
              <span className="min-w-0">
                <span className={
                  step.status === 'in_progress' && running ? 'agent-shimmer'
                    : step.status === 'pending' ? 'text-[var(--text-muted)]'
                      : step.status === 'failed' ? 'text-[var(--accent-red)]'
                        : 'text-[var(--text-secondary)]'
                }>{step.title}</span>
                {step.evidence && <span className="block text-[11.5px] leading-4 text-[var(--text-muted)]">{step.evidence}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ThinkingRow({ elapsedSeconds, agent, label = 'El agente está trabajando' }: { elapsedSeconds: number; agent?: AgentIdentity; label?: string }) {
  const mm = Math.floor(elapsedSeconds / 60);
  const ss = elapsedSeconds % 60;
  const elapsed = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
  return (
    <div role="status" aria-live="off" className="agent-trace-in flex items-center gap-2 text-[13px] leading-5">
      {agent ? <AgentAvatar seed={agent.seed} color={agent.color} name={agent.name} size={16} working /> : <Loader2 size={14} className="animate-spin text-[var(--text-muted)]" />}
      <span className="agent-shimmer">{label}</span>
      <span className="tabular-nums text-[12px] text-[var(--text-muted)]">{elapsed}</span>
    </div>
  );
}

export function ToolGroup({ label, names, enabledNames, onToggle, disabled, expanded }: {
  label: string;
  names: string[];
  enabledNames?: Set<string>;
  onToggle?: (name: string, enabled: boolean) => void;
  disabled?: boolean;
  expanded?: boolean;
}) {
  if (names.length === 0) return null;
  return (
    <details open={expanded || undefined} className="group rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
        <ChevronRight size={11} className="shrink-0 transition-transform group-open:rotate-90" />
        {label}
        <span className="ml-auto tabular-nums text-[var(--text-muted)]">{names.length}</span>
      </summary>
      <ul className="mt-1.5 max-h-44 space-y-1 overflow-auto">
        {names.map((n) => (
          <li key={n} className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]" title={n}>
            <span className="min-w-0 flex-1 truncate">{METHOD_LABELS[n] ?? n}</span>
            {onToggle && <Toggle checked={enabledNames?.has(n) ?? true} onChange={(enabled) => onToggle(n, enabled)} disabled={disabled} aria-label={`Habilitar ${n}`} />}
          </li>
        ))}
      </ul>
    </details>
  );
}
