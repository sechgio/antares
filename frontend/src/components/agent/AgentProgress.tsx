import { X } from 'lucide-react';
import Button from '../ui/Button';
import { statusLabel } from './agentStatus';

export type AgentProgressItem = {
  key: string;
  source: 'subagent' | 'shell_job';
  id: string;
  name: string;
  event: 'start' | 'step' | 'finish' | 'error';
  status: string;
  detail: string;
  output: string;
  cancellable: boolean;
};

export const PROGRESS_LIMIT = 6;

export function isActiveProgress(item: AgentProgressItem): boolean {
  return item.event === 'start' || item.event === 'step';
}

export function parseAgentProgress(session: string, params: unknown): AgentProgressItem | null {
  if (!params || typeof params !== 'object') return null;
  const raw = params as Record<string, unknown>;
  if (raw.session_id !== session) return null;
  const source = raw.source === 'shell_job' ? 'shell_job' : raw.source === 'subagent' ? 'subagent' : null;
  const event = (['start', 'step', 'finish', 'error'] as const).find((phase) => phase === raw.event) ?? null;
  const id = typeof raw.id === 'string' ? raw.id : typeof raw.job_id === 'string' ? raw.job_id : '';
  if (!source || !event || !id) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '';
  const detail = [raw.detail, raw.tool, raw.task]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
  const output = [raw.stdout, raw.stderr]
    .filter((value): value is string => typeof value === 'string' && value.length > 0).join('\n').trim();
  return {
    key: `${source}:${id}`,
    source,
    id,
    name,
    event,
    status: typeof raw.status === 'string' ? raw.status : event,
    detail,
    output,
    cancellable: raw.cancellable !== false && (event === 'start' || event === 'step'),
  };
}

export function mergeAgentProgress(current: AgentProgressItem[], next: AgentProgressItem): AgentProgressItem[] {
  const index = current.findIndex((item) => item.key === next.key);
  const merged = index < 0 ? next : {
    ...current[index],
    ...next,
    name: next.name || current[index].name,
    detail: next.detail || current[index].detail,
    output: next.output || current[index].output,
  };
  const items = index < 0 ? [...current, merged] : current.map((item, at) => at === index ? merged : item);
  if (items.length <= PROGRESS_LIMIT) return items;
  const active = items.filter(isActiveProgress);
  const allowance = PROGRESS_LIMIT - active.length;
  const terminal = allowance > 0
    ? items.filter((item) => !isActiveProgress(item)).slice(-allowance)
    : [];
  return items.filter((item) => active.includes(item) || terminal.includes(item));
}

export function progressName(item: AgentProgressItem): string {
  return item.name || (item.source === 'shell_job' ? 'Job' : 'Subagente');
}

export function progressLabel(item: AgentProgressItem): string {
  if (item.event === 'start') return item.detail ? `inicio · ${item.detail}` : 'inicio';
  if (item.event === 'step') return item.detail ? `paso · ${item.detail}` : 'paso';
  const phase = item.event === 'error' ? 'error' : 'fin';
  return `${phase} · ${statusLabel(item.status)}${item.detail ? ` · ${item.detail}` : ''}`;
}

export default function AgentProgress({ items, cancelling, onCancel }: {
  items: AgentProgressItem[];
  cancelling: string;
  onCancel: (item: AgentProgressItem) => void;
}) {
  if (items.length === 0) return null;
  const active = items.filter(isActiveProgress).length;
  return (
    <section aria-label="Progreso en vivo" className="agent-progress mb-2 overflow-hidden rounded-xl border border-[var(--border-subtle)]">
      <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)]" />
        <span className="font-medium">Progreso</span>
        <span className="text-[11px] text-[var(--text-muted)]">{active > 0 ? `${active} en curso` : 'sin actividad'}</span>
      </div>
      <ul className="custom-scrollbar max-h-40 overflow-y-auto px-1 pb-1">
        {items.map((item) => {
          return (
            <li key={item.key} className="agent-progress-item flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5">
              <span className="mt-0.5 shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                {item.source === 'shell_job' ? 'Job' : 'Subagente'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-[var(--text-primary)]" title={progressName(item)}>{progressName(item)}</p>
                <p className="truncate text-[11px] text-[var(--text-muted)]" title={progressLabel(item)}>{progressLabel(item)}</p>
                {item.output && (
                  <pre className="mt-0.5 max-h-16 overflow-hidden whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-[var(--text-muted)]">{item.output.slice(-400)}</pre>
                )}
              </div>
              {item.cancellable && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-[11px]"
                  aria-label={`Cancelar ${progressName(item)}`}
                  title="Cancelar"
                  disabled={cancelling === item.key}
                  onClick={() => onCancel(item)}
                >
                  <X size={11} aria-hidden="true" />
                  {cancelling === item.key ? 'Cancelando…' : 'Cancelar'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
