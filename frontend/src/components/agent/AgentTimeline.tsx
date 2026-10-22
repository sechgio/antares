import { useEffect, useRef, useState } from 'react';
import { AppWindow, ArrowLeft, Ban, BookOpen, Camera, Check, ChevronDown, ChevronRight, Circle, CircleCheck, CircleDot, CircleX, Copy, FilePen, FileText, FolderOpen, Globe, Keyboard, ListChecks, Loader2, Monitor, Mouse, MousePointerClick, Package, Route, Search, ShieldCheck, Terminal, Wrench, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AgentApproval, AgentMessage, AgentPlan, AgentToolCall } from '../../api/agentApi';
import Button from '../ui/Button';
import Toggle from '../ui/Toggle';
import AgentAvatar from './AgentAvatar';
import MessageMarkdown from './MessageMarkdown';
import Reasoning from './Reasoning';
import SubagentTrace from './SubagentTrace';
import { METHOD_LABELS } from './methodLabels';

interface AgentIdentity {
  seed: string;
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
  web_click: MousePointerClick,
  web_type: Keyboard,
  web_key: Keyboard,
  desktop_observe: Monitor,
  desktop_click: MousePointerClick,
  desktop_type: Keyboard,
  desktop_key: Keyboard,
  desktop_scroll: Mouse,
  desktop_launch: AppWindow,
  desktop_focus: AppWindow,
  task_plan: ListChecks,
  tools_load: Package,
  skills_list: BookOpen,
  skills_read: BookOpen,
};

const KEY_PARAMS = ['path', 'url', 'query', 'target', 'title', 'keys', 'text', 'name', 'id'];

function keyArgument(params: Record<string, unknown>): string | null {
  for (const key of KEY_PARAMS) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value.replace(/\s+/g, ' ').trim();
  }
  return null;
}

// Los textos largos (páginas, archivos) se leen con sus saltos de línea reales
// en vez de «\n» escapados; una barra invertida escapada se respeta.
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
      // Las líneas desde aquí son stderr o el error de la herramienta y se pintan en rojo.
      errorFrom: errors ? (stdout ? stdout.split('\n').length : 0) : Infinity,
      duration: typeof data.duration_s === 'number' ? data.duration_s : null,
    };
  } catch {
    return { exit: null, text: result, errorFrom: Infinity, duration: null };
  }
}

// Segundos que lleva en curso una herramienta, desde el inicio que marca el motor.
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
  const [open, setOpen] = useState(live || call.status === 'pending');
  const [seen, setSeen] = useState(call.status);
  if (seen !== call.status) {
    setSeen(call.status);
    if (call.status === 'running' || call.status === 'pending') setOpen(true);
  }
  const exitFailed = output?.exit != null && output.exit !== 0;
  const failed = call.status === 'failed' || call.status === 'denied' || exitFailed;
  const text = output ? output.text : (call.output ?? '').replace(/\n+$/, '');
  const lines = text ? text.split('\n') : [];
  // Como una terminal, se ve el final de la salida: ahí suelen estar el error o el resumen.
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [open, text]);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`group ${TASK_ROW} w-fit text-left`}
      >
        <Terminal size={14} className={`shrink-0 ${failed ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'}`} aria-hidden="true" />
        <span className={`min-w-0 truncate transition-colors ${failed ? 'text-[var(--accent-red)]' : 'group-hover:text-[var(--text-primary)]'} ${live ? 'agent-shimmer' : ''}`}>
          {TERMINAL_VERB[call.status] ? `${TERMINAL_VERB[call.status]} ` : ''}<span className="font-mono text-[12px]">{command}</span>
        </span>
        {call.gated && <ShieldCheck size={12} className="shrink-0 text-[var(--text-muted)]" aria-label="Requiere aprobación" />}
        {!TERMINAL_VERB[call.status] && <span className="shrink-0 text-[12px] text-[var(--text-muted)]">{CALL_STATUS_LABEL[call.status] ?? call.status}</span>}
        {exitFailed && <span className="shrink-0 text-[12px] text-[var(--accent-red)]">código {output?.exit}</span>}
        {output?.duration != null && !live && <span className="shrink-0 text-[12px] tabular-nums text-[var(--text-muted)]">{output.duration} s</span>}
        {live && <Elapsed since={call.started_at} />}
        <ChevronRight size={14} className={`shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className={`${TASK_BODY} group/term relative mb-1.5 mt-1`}>
          {!live && output?.text && (
            <div className="absolute right-4 top-1.5 z-10">
              <CopyButton text={output.text} label="Copiar salida" className="group-hover/term:opacity-100" />
            </div>
          )}
          <div ref={logRef} role="log" aria-label={`Salida de ${command}`} className="agent-terminal max-h-64 overflow-auto rounded-lg border border-[var(--border-subtle)] px-3 py-2.5 font-mono text-[11.5px] leading-[18px] text-[var(--text-secondary)]">
            <div className="whitespace-pre-wrap break-all text-[var(--text-primary)]"><span className="select-none text-[var(--text-muted)]">&gt; </span>{command}</div>
            {lines.map((line, i) => (
              <div key={i} className={`agent-terminal-line whitespace-pre-wrap break-all ${output && i >= output.errorFrom ? 'text-[var(--accent-red)]' : ''}`} style={{ animationDelay: `${Math.min(i, 40) * 18}ms` }}>{line || ' '}</div>
            ))}
            {live && <span className="agent-terminal-cursor" aria-hidden="true" />}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolCallStep({ call }: { call: AgentToolCall }) {
  if (call.name === 'subagent_run') return <SubagentTrace call={call} />;
  if (call.name === 'shell_run') return <TerminalStep call={call} />;
  const detail = call.result || null;
  const params = Object.keys(call.params).length > 0 ? JSON.stringify(call.params, null, 2) : null;
  const failed = call.status === 'failed';
  const denied = call.status === 'denied';
  const live = call.status === 'running';
  const Icon = denied ? Ban : TOOL_ICONS[call.name] ?? Wrench;
  const arg = keyArgument(call.params);
  const row = (
    <>
      <Icon size={14} className={`shrink-0 ${failed ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'}`} aria-hidden="true" />
      <span className={`min-w-0 truncate transition-colors ${failed ? 'text-[var(--accent-red)]' : denied ? 'text-[var(--text-muted)]' : 'group-hover:text-[var(--text-primary)]'} ${live ? 'agent-shimmer' : ''}`}>
        {METHOD_LABELS[call.name] ?? call.name}
        {arg && <span className={`ml-1.5 font-mono text-[12px] ${failed ? '' : 'text-[var(--text-muted)]'}`}>{arg}</span>}
      </span>
      {call.gated && <ShieldCheck size={12} className="shrink-0 text-[var(--text-muted)]" aria-label="Requiere aprobación" />}
      <span className={call.status === 'done' ? 'sr-only' : `shrink-0 text-[12px] ${failed ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'}`}>
        {CALL_STATUS_LABEL[call.status] ?? call.status}
      </span>
      {live && <Elapsed since={call.started_at} />}
      {!denied && (params || detail) && <ChevronRight size={14} className="shrink-0 text-[var(--text-muted)] transition-transform duration-200 group-open:rotate-90" aria-hidden="true" />}
    </>
  );
  if (denied || (!params && !detail)) return <div className={`group ${TASK_ROW}`}>{row}</div>;
  return (
    <details className="group">
      <summary className={`${TASK_ROW} w-fit cursor-pointer list-none`}>{row}</summary>
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
      <div className="agent-message-user max-w-[min(600px,85%)] rounded-[18px] bg-[var(--bg-input)] px-4 py-2.5 text-[14px] leading-[21px] text-[var(--text-primary)]">
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
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

function ToolSteps({ calls }: { calls: AgentToolCall[] }) {
  const attention = calls.some((c) => !['done', 'submitted'].includes(c.status));
  if (calls.length <= 2) return <>{calls.map((c) => <ToolCallStep key={c.id} call={c} />)}</>;
  const done = calls.filter((c) => c.status === 'done').length;
  return (
    <details className="group/steps" open={attention}>
      <summary className={`${TASK_ROW} w-fit cursor-pointer list-none hover:text-[var(--text-primary)]`}>
        <Wrench size={14} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        {calls.length} pasos · {done} completados
        <ChevronRight size={14} className="shrink-0 text-[var(--text-muted)] transition-transform duration-200 group-open/steps:rotate-90" aria-hidden="true" />
      </summary>
      <div className={`${TASK_BODY} mt-0.5`}>{calls.map((c) => <ToolCallStep key={c.id} call={c} />)}</div>
    </details>
  );
}

function AssistantBlock({ msg, agent }: { msg: AgentMessage; agent?: AgentIdentity }) {
  const calls = msg.tool_calls ?? [];
  return (
    <div className="agent-trace-in group flex items-start gap-2.5" data-tools-only={!msg.content && !msg.reasoning && calls.length > 0 ? '' : undefined}>
      <div className="min-w-0 flex-1 space-y-1.5">
        {(msg.content || msg.reasoning) && (
          <div className="flex items-center gap-1.5">
            {agent && <AgentAvatar seed={agent.seed} name={agent.name} size={18} working={!!msg.partial} />}
            <span className="text-[12px] font-medium leading-5 text-[var(--text-secondary)]">
              {agent?.name ?? 'Agente'}
            </span>
            {!msg.partial && msg.content && <CopyButton text={msg.content} />}
          </div>
        )}
        {msg.reasoning && <Reasoning text={msg.reasoning} streaming={!!msg.partial && !msg.content} ms={msg.reasoning_ms} />}
        {msg.content && (
          <div className="agent-message-answer w-fit max-w-[min(620px,100%)] rounded-[18px] bg-[var(--bg-input)] px-4 py-3 text-[14px] leading-[22px] text-[var(--text-primary)]">
            <MessageMarkdown text={msg.content} streaming={!!msg.partial} />
          </div>
        )}
        {calls.length > 0 && (
          <div className="w-full max-w-[min(620px,100%)] space-y-0.5">
            <ToolSteps calls={calls} />
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageRow({ msg, agent }: { msg: AgentMessage; agent?: AgentIdentity }) {
  if (msg.role === 'tool_result') return null;
  return msg.role === 'user' ? <UserBubble msg={msg} /> : <AssistantBlock msg={msg} agent={agent} />;
}

export function ApprovalCard({
  approval,
  busy,
  onDecide,
}: {
  approval: AgentApproval;
  busy: boolean;
  onDecide: (id: string, ok: boolean) => void;
}) {
  const action = METHOD_LABELS[approval.method];
  const { params, context } = approval;
  const facts = [
    typeof params.id === 'string' && `Elemento: ${params.id}`,
    typeof params.name === 'string' && `Nombre: ${params.name}`,
    typeof context?.filename === 'string' && `PDF: ${context.filename}`,
    typeof params.printer_name === 'string' && `Impresora: ${params.printer_name}`,
    typeof params.copies === 'number' && `Copias: ${params.copies} · Páginas: ${String(params.pages || 'Todas')}`,
    typeof params.destination_folder === 'string' && `Destino: ${params.destination_folder}\\${String(params.filename || params.name || '')}`,
    typeof params.command === 'string' && `Comando: ${params.command.slice(0, 400)}`,
    typeof params.cwd === 'string' && `Carpeta: ${params.cwd}`,
    typeof params.path === 'string' && `Ruta: ${params.path}`,
    typeof params.target === 'string' && `Abrir: ${params.target}${typeof params.args === 'string' ? ` ${params.args}` : ''}`,
    typeof params.title === 'string' && `Ventana: ${params.title}`,
    typeof params.keys === 'string' && `Teclas: ${params.keys}`,
    typeof params.text === 'string' && `Texto: ${params.text.slice(0, 200)}`,
    typeof params.x === 'number' && typeof params.y === 'number' && `Punto: (${params.x}, ${params.y})`,
    typeof params.ref === 'string' && `Elemento de la página: ${params.ref}`,
    context?.account && `Cuenta: ${context.account}`,
    context?.sheet_id && `Hoja: ${context.sheet_id}`,
    ...(approval.resources ?? []).map((resource) => `Archivo: ${resource.path}`),
  ].filter((fact): fact is string => !!fact);
  const Icon = approval.method === 'shell_run' ? Terminal : TOOL_ICONS[approval.method] ?? ShieldCheck;
  return (
    <div role="group" aria-label="Confirmación de acción" className="agent-trace-in">
      <div className="flex w-fit max-w-full flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2.5">
        <Icon size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--accent-yellow)]" />
        <div className="min-w-0 max-w-[460px] flex-1">
          <p className="text-[13px] font-medium leading-5 text-[var(--text-primary)]">
            {action ? `¿Ejecutar «${action}»?` : '¿Permitir una acción avanzada?'}
          </p>
          <p className="text-[12px] leading-[18px] text-[var(--text-muted)]">
            {action ? 'El turno sigue en pausa hasta que decidas.' : 'Revisa sus detalles antes de aprobar; el turno sigue en pausa.'}
          </p>
          {facts.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 font-mono text-[11.5px] leading-[17px] text-[var(--text-secondary)]">
              {facts.map((fact) => <li key={fact} className="break-all">{fact}</li>)}
            </ul>
          )}
          <details className="group mt-1.5 text-[11.5px] text-[var(--text-muted)]">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1 transition-colors hover:text-[var(--text-secondary)]">
              Ver detalles de la acción
              <ChevronRight size={12} className="transition-transform duration-200 group-open:rotate-90" />
            </summary>
            <code className="mt-1 block text-[11px]">{approval.method}</code>
            {Object.keys(params).length > 0 && (
              <pre className="agent-terminal mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--border-subtle)] p-2 text-[11px] text-[var(--text-secondary)]">
                {JSON.stringify(params, null, 2)}
              </pre>
            )}
          </details>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onDecide(approval.id, false)}>
            <X size={13} aria-hidden="true" />
            Rechazar
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onDecide(approval.id, true)}>
            <Check size={13} aria-hidden="true" />
            Aprobar
          </Button>
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

export function ThinkingRow({ elapsedSeconds, agent }: { elapsedSeconds: number; agent?: AgentIdentity }) {
  const mm = Math.floor(elapsedSeconds / 60);
  const ss = elapsedSeconds % 60;
  const elapsed = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
  return (
    <div role="status" className="agent-trace-in flex items-center gap-2 text-[13px] leading-5">
      {agent ? <AgentAvatar seed={agent.seed} name={agent.name} size={16} working /> : <Loader2 size={14} className="animate-spin text-[var(--text-muted)]" />}
      <span className="agent-shimmer">El agente está trabajando</span>
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
