import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Ban, ChevronRight, FilePen, FilePlus, Loader2, ShieldCheck } from 'lucide-react';
import type { AgentToolCall } from '../../api/agentApi';
import { fileChange } from './diffLines';
import type { DiffLine, FileChange } from './diffLines';

const MAX_LINES = 400;
const MAX_STAGGER = 24;
const SMALL_CHANGE = 16;
const FOLD_KEEP = 3;
const MIN_FOLD = 4;

const MARK = { add: '+', remove: '−', context: ' ' } as const;

type Row = { type: 'line'; line: DiffLine; number: number | null; key: string }
  | { type: 'fold'; count: number; key: string };

function hunkRows(hunk: DiffLine[], start: number | null, prefix: string, unfolded: Set<string>): Row[] {
  let oldNumber = start ?? 0;
  let newNumber = start ?? 0;
  const lines = hunk.map((line, index): Row => {
    let number: number;
    if (line.kind === 'remove') number = oldNumber++;
    else if (line.kind === 'add') number = newNumber++;
    else { number = newNumber++; oldNumber += 1; }
    return { type: 'line', line, number: start === null ? null : number, key: `${prefix}:${index}` };
  });
  const rows: Row[] = [];
  let index = 0;
  while (index < lines.length) {
    if (hunk[index].kind !== 'context') { rows.push(lines[index]); index += 1; continue; }
    let end = index;
    while (end < lines.length && hunk[end].kind === 'context') end += 1;
    const head = index === 0 ? 0 : FOLD_KEEP;
    const tail = end === lines.length ? 0 : FOLD_KEEP;
    const key = `${prefix}:fold:${index}`;
    const hidden = end - index - head - tail;
    if (hidden >= MIN_FOLD && !unfolded.has(key)) {
      rows.push(...lines.slice(index, index + head), { type: 'fold', count: hidden, key }, ...lines.slice(end - tail, end));
    } else {
      rows.push(...lines.slice(index, end));
    }
    index = end;
  }
  return rows;
}

function LineText({ line }: { line: DiffLine }) {
  if (!line.change) return <>{line.text || ' '}</>;
  const [from, to] = line.change;
  return (
    <>
      {line.text.slice(0, from)}
      <span className="agent-diff-word">{line.text.slice(from, to)}</span>
      {line.text.slice(to)}
    </>
  );
}

export function DiffStats({ change, applied = false }: { change: FileChange; applied?: boolean }) {
  return (
    <span data-applied={applied || undefined} aria-label={`${change.added} líneas añadidas, ${change.removed} eliminadas`}
      className="agent-diff-stats shrink-0 font-mono text-[11.5px] tabular-nums">
      {change.added > 0 && <span className="text-[var(--accent-green)]">+{change.added}</span>}
      {change.added > 0 && change.removed > 0 && ' '}
      {change.removed > 0 && <span className="text-[var(--accent-red)]">−{change.removed}</span>}
    </span>
  );
}

export function FileDiff({ change, applied = false, className = 'max-h-72' }: {
  change: FileChange;
  applied?: boolean;
  className?: string;
}) {
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set());
  const numbered = change.starts.some((start) => start !== null);
  let shown = 0;
  let hidden = 0;
  return (
    <div role="group" aria-label="Cambios del archivo" data-applied={applied || undefined}
      className={`agent-terminal agent-diff overflow-auto rounded-lg border border-[var(--border-subtle)] py-1.5 font-mono text-[11.5px] leading-[18px] text-[var(--text-secondary)] ${className}`}>
      {change.hunks.map((hunk, h) => (
        <div key={h}>
          {h > 0 && <div className="agent-diff-gap select-none px-3 text-[var(--text-muted)]" aria-hidden="true">⋯</div>}
          {hunkRows(hunk, change.starts[h] ?? null, String(h), unfolded).map((row) => {
            if (shown >= MAX_LINES) { hidden += row.type === 'fold' ? row.count : 1; return null; }
            const index = shown++;
            const style = { '--i': Math.min(index, MAX_STAGGER) } as CSSProperties;
            if (row.type === 'fold') {
              return (
                <button key={row.key} type="button" style={style}
                  onClick={() => setUnfolded((current) => new Set(current).add(row.key))}
                  className="agent-diff-line agent-diff-fold flex w-full items-center gap-2 px-3 text-left text-[var(--text-muted)]">
                  <ChevronRight size={11} className="shrink-0" aria-hidden="true" />
                  {row.count} líneas sin cambios
                </button>
              );
            }
            const { line } = row;
            return (
              <div key={row.key} data-kind={line.kind} style={style}
                className="agent-diff-line flex whitespace-pre-wrap break-all px-3">
                {numbered && (
                  <span className="agent-diff-number w-[4ch] shrink-0 select-none pr-2 text-right tabular-nums" aria-hidden="true">
                    {row.number ?? ''}
                  </span>
                )}
                <span className="w-4 shrink-0 select-none" aria-hidden="true">{MARK[line.kind]}</span>
                <span className="sr-only">{line.kind === 'add' ? 'Añadida: ' : line.kind === 'remove' ? 'Eliminada: ' : ''}</span>
                <span className="min-w-0 flex-1"><LineText line={line} /></span>
              </div>
            );
          })}
        </div>
      ))}
      {hidden > 0 && <div className="px-3 pt-1 text-[var(--text-muted)]">{hidden} líneas más sin mostrar</div>}
    </div>
  );
}

function verb(call: AgentToolCall, change: FileChange): string {
  let replaced = call.params.overwrite === true;
  try {
    const data: unknown = call.result ? JSON.parse(call.result) : null;
    if (data && typeof data === 'object' && 'replaced' in data) replaced = data.replaced === true;
  } catch {}
  const [present, past, base] = !change.whole ? ['Editando', 'Editó', 'Editar']
    : replaced ? ['Reemplazando', 'Reemplazó', 'Reemplazar'] : ['Creando', 'Creó', 'Crear'];
  if (call.status === 'running') return present;
  if (call.status === 'done') return past;
  if (call.status === 'failed') return `No pudo ${base.toLowerCase()}`;
  if (call.status === 'denied') return `No se permitió ${base.toLowerCase()}`;
  return base;
}

function errorText(result: string | null | undefined): string | null {
  if (!result) return null;
  try {
    const data: unknown = JSON.parse(result);
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') return data.error;
  } catch {}
  return result;
}

export function FileChangeStep({ call, status, className }: {
  call: AgentToolCall;
  status: string;
  className: string;
}) {
  const change = fileChange(call.name, call.params, call.status === 'done' ? call.result : null);
  const failed = call.status === 'failed';
  const denied = call.status === 'denied';
  const live = call.status === 'running';
  const [open, setOpen] = useState(() => live || failed
    || (!denied && !!change && change.added + change.removed <= SMALL_CHANGE));
  const [mounted, setMounted] = useState(open);
  const [seen, setSeen] = useState(call.status);
  const [applied, setApplied] = useState(false);
  if (open && !mounted) setMounted(true);
  if (seen !== call.status) {
    setSeen(call.status);
    if (call.status === 'done') setApplied(true);
    if (call.status === 'running' || call.status === 'failed') setOpen(true);
  }
  if (!change) return null;
  const path = typeof call.params.path === 'string' ? call.params.path : '';
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const Icon = live ? Loader2 : denied ? Ban : change.whole ? FilePlus : FilePen;
  const error = failed ? errorText(call.result) : null;
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className={`agent-tool-row group ${className} w-full text-left`}>
        <Icon size={14} aria-hidden="true"
          className={`shrink-0 ${live ? 'animate-spin text-[var(--text-secondary)]' : failed ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'}`} />
        <span title={path} className={`min-w-0 truncate transition-colors ${failed ? 'text-[var(--accent-red)]' : denied ? 'text-[var(--text-muted)]' : 'group-hover:text-[var(--text-primary)]'}`}>
          {verb(call, change)} <span className="font-mono text-[12px]">{name}</span>
        </span>
        <DiffStats change={change} applied={applied} />
        {call.gated && <ShieldCheck size={12} className="shrink-0 text-[var(--text-muted)]" aria-label="Acción sensible" />}
        {['pending', 'queued', 'submitted', 'interrupted'].includes(call.status) && (
          <span className="shrink-0 text-[12px] text-[var(--text-muted)]">{status}</span>
        )}
        <ChevronRight size={14} aria-hidden="true"
          className={`shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      <div className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="agent-subagent-body overflow-hidden" inert={!open} aria-hidden={!open}>
          {mounted && (
            <div className="agent-diff-body mb-1.5 ml-[6.5px] mt-1 space-y-1.5 border-l border-[var(--border-subtle)] pl-[15px]">
              <FileDiff change={change} applied={applied} />
              {error && <p className="whitespace-pre-wrap break-words text-[12px] leading-[18px] text-[var(--accent-red)]">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
