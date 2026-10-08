import { AlertTriangle, Bot, Check, ChevronRight, Clock3, Loader2, ShieldCheck, Wrench, X } from 'lucide-react';
import type { AgentApproval, AgentMessage, AgentSession, AgentToolCall } from '../../api/agentApi';
import type { AiProviderSpec } from '../../api/aiProvidersApi';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ThemedSelect from '../ui/ThemedSelect';
import { METHOD_LABELS } from './nodeDefs';
import { useEffect, useState } from 'react';
import { flowsApi } from '../../api/flowsApi';

const CALL_STATUS_LABEL: Record<string, string> = {
  queued: 'en cola',
  pending: 'esperando aprobación',
  done: 'ejecutada',
  denied: 'rechazada',
  running: 'ejecutando',
  failed: 'fallida',
  interrupted: 'interrumpida · comprueba el resultado',
};

function CallStatusIcon({ status }: { status: string }) {
  if (status === 'done') return <Check size={12} className="text-[var(--accent-green)]" />;
  if (status === 'denied' || status === 'failed') return <X size={12} className="text-[var(--accent-red)]" />;
  if (status === 'interrupted') return <AlertTriangle size={12} className="text-[var(--accent-yellow)]" />;
  if (status === 'pending') return <ShieldCheck size={12} className="text-[var(--accent-yellow)]" />;
  return <Loader2 size={12} className="animate-spin text-[var(--text-muted)]" />;
}

function ToolCallStep({ call }: { call: AgentToolCall }) {
  const detail = call.result || null;
  const params = Object.keys(call.params).length > 0 ? JSON.stringify(call.params) : null;
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)]">
          <Wrench size={11} />
        </span>
        <span className="truncate text-[var(--text-primary)]">{METHOD_LABELS[call.name] ?? call.name}</span>
        {call.gated && <ShieldCheck size={12} className="shrink-0 text-[var(--accent-yellow)]" aria-label="Requiere aprobación" />}
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-[var(--text-muted)]">
          <CallStatusIcon status={call.status} />
          {CALL_STATUS_LABEL[call.status] ?? call.status}
        </span>
      </div>
      {(params || detail) && (
        <details className="group mt-1.5">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]">
            <ChevronRight size={11} className="transition-transform group-open:rotate-90" />
            {detail ? 'resultado' : 'parámetros'}
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--bg-base)] p-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            {detail ?? params}
          </pre>
        </details>
      )}
    </div>
  );
}

function UserBubble({ msg }: { msg: AgentMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-[var(--accent-primary)] px-3.5 py-2 text-[13px] leading-relaxed text-[var(--text-on-accent)]">
        <p className="whitespace-pre-wrap">{msg.content}</p>
      </div>
    </div>
  );
}

function AssistantBlock({ msg }: { msg: AgentMessage }) {
  return (
    <div className="space-y-2">
      {msg.content && (
        <p className="max-w-[90%] whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-primary)]">
          {msg.content}
          {msg.partial && <span className="ml-0.5 animate-pulse text-[var(--text-muted)]">▍</span>}
        </p>
      )}
      {(msg.tool_calls ?? []).length > 0 && (
        <div className="max-w-[90%] space-y-1.5">
          {(msg.tool_calls ?? []).map((c) => (
            <ToolCallStep key={c.id} call={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export function MessageRow({ msg }: { msg: AgentMessage }) {
  if (msg.role === 'tool_result') return null; // ya se muestra dentro de la llamada
  return msg.role === 'user' ? <UserBubble msg={msg} /> : <AssistantBlock msg={msg} />;
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
  const [flowName, setFlowName] = useState('');
  useEffect(() => {
    let alive = true;
    setFlowName('');
    if (typeof approval.params.id === 'string' && ['flows_update', 'flows_delete', 'flows_duplicate', 'flows_run'].includes(approval.method)) {
      flowsApi.flowsGet(approval.params.id)
        .then((res) => { if (alive) setFlowName(res.flow.name); })
        .catch(() => undefined);
    }
    return () => { alive = false; };
  }, [approval.method, approval.params.id]);
  return (
    <div className="max-w-[90%] overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent-yellow)_40%,transparent)] bg-[var(--bg-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--accent-yellow)_10%,transparent)] px-3 py-2 text-[12px] font-medium text-[var(--text-primary)]">
        <AlertTriangle size={13} className="text-[var(--accent-yellow)]" />
        El agente quiere ejecutar una acción
      </div>
      <div className="px-3 py-2.5">
        <p className="text-[12px] font-medium text-[var(--text-primary)]">
          {METHOD_LABELS[approval.method] ?? 'Acción avanzada: revisa sus detalles antes de aprobar'}
        </p>
        {typeof approval.params.id === 'string' && <p className="mt-1 text-xs text-[var(--text-secondary)]">Elemento: <span>{flowName || approval.params.id}</span></p>}
        {typeof approval.params.name === 'string' && <p className="mt-1 text-xs text-[var(--text-secondary)]">Nombre: {approval.params.name}</p>}
        {approval.method === 'flows_delete' && <p className="mt-1 text-xs text-[var(--text-secondary)]">Se borrarán el flujo y su historial de ejecuciones. No se puede deshacer.</p>}
        <details className="mt-2 text-xs text-[var(--text-secondary)]">
          <summary className="cursor-pointer">Ver detalles de la acción</summary>
          <code>{approval.method}</code>
          {Object.keys(approval.params).length > 0 && (
            <pre className="mt-1.5 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--bg-base)] p-2 text-[11px] text-[var(--text-secondary)]">
              {JSON.stringify(approval.params, null, 2)}
            </pre>
          )}
        </details>
        <div className="mt-2.5 flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => onDecide(approval.id, true)}>
            <Check size={13} className="mr-1" />
            Aprobar
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(approval.id, false)}>
            <X size={13} className="mr-1" />
            Rechazar
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ThinkingRow({ elapsedSeconds }: { elapsedSeconds: number }) {
  const mm = Math.floor(elapsedSeconds / 60);
  const ss = elapsedSeconds % 60;
  const elapsed = mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
  return (
    <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
      <Loader2 size={12} className="animate-spin" />
      El agente está trabajando
      <span className="inline-flex items-center gap-1 tabular-nums">
        <Clock3 size={11} />
        {elapsed}
      </span>
    </div>
  );
}

export interface AgentToolGroups {
  direct: string[];
  gated: string[];
  mcp: string[];
}

function SectionCard({
  icon,
  title,
  badge,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3.5 py-2.5 text-[12px] font-medium text-[var(--text-primary)]">
        <span className="text-[var(--text-secondary)]">{icon}</span>
        {title}
        {badge && (
          <span className="ml-auto rounded-full bg-[var(--accent-primary-glow)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-primary-hover)]">
            {badge}
          </span>
        )}
      </header>
      <div className="space-y-2.5 px-3.5 py-3">{children}</div>
    </section>
  );
}

function ToolGroup({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <details className="group rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
        <ChevronRight size={11} className="shrink-0 transition-transform group-open:rotate-90" />
        {label}
        <span className="ml-auto tabular-nums text-[var(--text-muted)]">{names.length}</span>
      </summary>
      <ul className="mt-1.5 max-h-44 space-y-1 overflow-auto">
        {names.map((n) => (
          <li key={n} className="truncate font-mono text-[11px] text-[var(--text-muted)]" title={n}>
            {METHOD_LABELS[n] ?? n}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function AgentContextPanel({
  session,
  providers,
  provider,
  model,
  messageCount,
  toolGroups,
  onProviderPick,
  onModelChange,
}: {
  session: AgentSession | null;
  providers: AiProviderSpec[];
  provider: string;
  model: string;
  messageCount: number;
  toolGroups: AgentToolGroups;
  onProviderPick: (id: string) => void;
  onModelChange: (v: string) => void;
}) {
  const toolCount = toolGroups.direct.length + toolGroups.gated.length + toolGroups.mcp.length;
  return (
    <aside className="hidden w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-[var(--border-medium)] p-3 xl:flex">
      <SectionCard icon={<Bot size={14} />} title="Agente" badge={session ? session.provider : undefined}>
        {session ? (
          <dl className="space-y-1.5 text-[12px]">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Proveedor</dt>
              <dd className="truncate font-mono text-[var(--text-secondary)]">{session.provider}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Modelo</dt>
              <dd className="truncate font-mono text-[var(--text-secondary)]">{session.model || 'por defecto'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">Mensajes</dt>
              <dd className="tabular-nums text-[var(--text-secondary)]">{messageCount}</dd>
            </div>
          </dl>
        ) : (
          <div className="space-y-2">
            <ThemedSelect
              value={provider}
              onChange={onProviderPick}
              options={providers.map((p) => ({ value: p.id, label: p.label }))}
              aria-label="Proveedor IA"
              placeholder="Proveedor…"
            />
            <Input
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              placeholder="Modelo (opcional)"
              spellCheck={false}
              aria-label="Modelo"
            />
            <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
              Se aplican a la próxima conversación.
            </p>
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
          Las acciones que modifican datos se pausan hasta que las apruebes. Las claves se guardan cifradas en este equipo.
        </p>
      </SectionCard>

      <SectionCard icon={<Wrench size={14} />} title="Herramientas" badge={toolCount ? String(toolCount) : undefined}>
        <ToolGroup label="Lectura directa" names={toolGroups.direct} />
        <ToolGroup label="Con aprobación" names={toolGroups.gated} />
        <ToolGroup label="MCP" names={toolGroups.mcp} />
        {toolCount === 0 && (
          <p className="text-[11px] text-[var(--text-muted)]">
            Las herramientas disponibles aparecen aquí al cargar la vista.
          </p>
        )}
      </SectionCard>
    </aside>
  );
}
