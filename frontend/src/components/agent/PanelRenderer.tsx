import { useCallback, useEffect, useId, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { AppWindow, ArrowRight, Check, ExternalLink, Maximize2, Search, Table2, X, type LucideIcon } from 'lucide-react';
import { z } from 'zod';
import { agentApi, type AgentPanel, type AgentPanelResponse } from '../../api/agentApi';
import { useToast } from '../../hooks/useToast';
import { errorMessage } from '../../utils/errors';
import { DialogSurface } from '../ui/Dialog';
import ThemedSelect from '../ui/ThemedSelect';
import Toggle from '../ui/Toggle';

export type PanelRespond = (panel: AgentPanel, response: AgentPanelResponse) => Promise<void>;
type PanelViewProps<P> = { panel: AgentPanel; props: P; sessionId: string; onRespond: PanelRespond };

const choiceSchema = z.object({ prompt: z.string().min(1), options: z.array(z.string().min(1)).min(1).max(12) });
const formSchema = z.object({
  title: z.string().optional(),
  submit_label: z.string().optional(),
  fields: z.array(z.object({
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(['text', 'number', 'textarea', 'select', 'checkbox']).default('text'),
    options: z.array(z.string()).optional(),
    required: z.boolean().optional(),
  })).min(1).max(30),
});
const tableSchema = z.object({
  title: z.string().optional(),
  columns: z.array(z.string()).min(1),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
});
const pageSchema = z.object({ artifact_id: z.string().min(1), sha256: z.string().min(1), title: z.string().min(1) });

const TABLE_ROW_LIMIT = 500;
const TABLE_PREVIEW_ROWS = 8;
const PAGE_HEIGHT = { initial: 360, min: 120, max: 20000 };
const PAGE_INLINE_MAX = 640;
const PAGE_THEME = { '--page-text': '--text-primary', '--page-muted': '--text-secondary', '--page-line': '--border-subtle',
  '--page-field': '--bg-input', '--page-accent': '--accent-primary' };
const NUMBER = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });

function PanelFrame({ title, answered, meta, children }: { title: string; answered?: boolean; meta?: ReactNode; children: ReactNode }) {
  return <section aria-label={title} data-panel-state={answered ? 'answered' : 'open'} className="agent-panel">
    <p className="agent-panel__title">{title}{answered
      ? <span className="agent-panel__meta"><Check size={11} className="mr-0.5 inline" aria-hidden="true" />Respondido</span>
      : meta && <span className="agent-panel__meta">{meta}</span>}</p>
    {children}
  </section>;
}

function ChoicePanel({ panel, props, onRespond }: PanelViewProps<z.infer<typeof choiceSchema>>) {
  const [pending, setPending] = useState<string | null>(null);
  const answered = panel.status === 'answered';
  const chosen = panel.response && 'choice' in panel.response ? panel.response.choice : pending;
  const choose = async (choice: string) => {
    setPending(choice);
    try { await onRespond(panel, { choice }); } finally { setPending(null); }
  };
  return <PanelFrame title={props.prompt} answered={answered}>
    <div className="agent-panel__options">
      {props.options.map((option) => <button key={option} type="button" className="agent-panel__option" aria-pressed={chosen === option}
        disabled={answered || pending !== null} onClick={() => void choose(option)}>
        {chosen === option && <Check size={13} strokeWidth={2.5} aria-hidden="true" />}{option}
      </button>)}
    </div>
  </PanelFrame>;
}

function FormPanel({ panel, props, onRespond }: PanelViewProps<z.infer<typeof formSchema>>) {
  const answered = panel.status === 'answered';
  const initial = panel.response && 'values' in panel.response ? panel.response.values : {};
  const [values, setValues] = useState<Record<string, string | number | boolean>>(initial);
  const [busy, setBusy] = useState(false);
  const set = (name: string, value: string | number | boolean) => setValues((current) => ({ ...current, [name]: value }));
  const missing = props.fields.some((field) => field.required && field.type !== 'checkbox' && !String(values[field.name] ?? '').trim());
  const submit = async () => {
    setBusy(true);
    try { await onRespond(panel, { values }); } finally { setBusy(false); }
  };
  const title = props.title || 'Completa los datos';
  if (answered) {
    return <PanelFrame title={title} answered>
      <dl className="agent-panel__summary">
        {props.fields.map((field) => {
          const value = values[field.name];
          const shown = field.type === 'checkbox' ? (value === true ? 'Sí' : 'No') : String(value ?? '').trim();
          return <div key={field.name}><dt>{field.label}</dt><dd className={shown ? undefined : 'is-empty'}>{shown || '—'}</dd></div>;
        })}
      </dl>
    </PanelFrame>;
  }
  return <PanelFrame title={title}>
    <form className="agent-panel__fields" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {props.fields.map((field) => {
        const id = `panel-${panel.id}-${field.name}`;
        const value = values[field.name];
        if (field.type === 'checkbox') {
          return <div key={field.name} className="agent-panel__check">
            <label htmlFor={id}>{field.label}</label>
            <Toggle id={id} checked={value === true} disabled={busy} onChange={(checked) => set(field.name, checked)} />
          </div>;
        }
        return <div key={field.name} className={field.type === 'textarea' ? 'agent-panel__wide' : undefined}>
          <label htmlFor={id} className="agent-panel__label">{field.label}{field.required && <span aria-hidden="true"> *</span>}</label>
          {field.type === 'select'
            ? <ThemedSelect aria-label={field.label} value={String(value ?? '')} disabled={busy} placeholder="Elige una opción" triggerClassName="agent-panel__select"
              options={(field.options ?? []).map((option) => ({ value: option, label: option }))} onChange={(next) => set(field.name, next)} />
            : field.type === 'textarea'
              ? <textarea id={id} rows={3} value={String(value ?? '')} disabled={busy} className="agent-panel__input" onChange={(event) => set(field.name, event.target.value)} />
              : <input id={id} type={field.type} value={String(value ?? '')} disabled={busy} className="agent-panel__input"
                onChange={(event) => set(field.name, field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />}
        </div>;
      })}
      <div className="agent-panel__wide">
        <button type="submit" className="agent-panel__submit" disabled={busy || missing}>
          {props.submit_label || 'Enviar'}<ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    </form>
  </PanelFrame>;
}

function PanelViewer({ title, icon: Icon, actions, onClose, children }: {
  title: string; icon: LucideIcon; actions?: ReactNode; onClose: () => void; children: ReactNode;
}) {
  const titleId = useId();
  return <DialogSurface portal onClose={onClose} labelledBy={titleId} className="agent-panel-viewer">
    <header className="agent-panel-viewer__bar">
      <button type="button" className="agent-panel__tool" aria-label="Cerrar vista completa" title="Cerrar (Esc)" onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </button>
      <p id={titleId} className="agent-panel-viewer__title"><Icon size={14} aria-hidden="true" /><span>{title}</span></p>
      <div className="agent-panel-viewer__actions">{actions}</div>
    </header>
    <div className="agent-panel-viewer__body">{children}</div>
  </DialogSurface>;
}

function DataTable({ columns, rows, numeric, limit }: { columns: string[]; rows: (string | number | null)[][]; numeric: boolean[]; limit: number }) {
  return <table>
    <thead><tr>{columns.map((column, cell) => <th key={column} className={numeric[cell] ? 'is-numeric' : undefined}>{column}</th>)}</tr></thead>
    <tbody>{rows.slice(0, limit).map((row, index) => <tr key={index}>
      {columns.map((column, cell) => {
        const value = row[cell];
        return <td key={column} className={[numeric[cell] && 'is-numeric', value === null && 'is-empty'].filter(Boolean).join(' ') || undefined}>
          {value === null ? '—' : typeof value === 'number' ? NUMBER.format(value) : value}
        </td>;
      })}
    </tr>)}</tbody>
  </table>;
}

function TablePanel({ props }: PanelViewProps<z.infer<typeof tableSchema>>) {
  const [query, setQuery] = useState('');
  const [full, setFull] = useState(false);
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('es');
    return needle ? props.rows.filter((row) => row.some((cell) => String(cell ?? '').toLocaleLowerCase('es').includes(needle))) : props.rows;
  }, [props.rows, query]);
  const title = props.title || 'Tabla';
  const numeric = props.columns.map((_, cell) => props.rows.some((row) => typeof row[cell] === 'number')
    && props.rows.every((row) => row[cell] === null || typeof row[cell] === 'number'));
  const search = <label className="agent-panel__search">
    <Search size={12} aria-hidden="true" />
    <input aria-label="Filtrar filas" value={query} placeholder="Filtrar…" onChange={(event) => setQuery(event.target.value)} />
  </label>;
  const empty = rows.length === 0 && <p className="agent-panel__note">Ninguna fila coincide con «{query.trim()}».</p>;
  const count = <span className="agent-panel__meta">{rows.length} de {props.rows.length}</span>;
  return <section aria-label={title} data-panel-state="open" className="agent-panel">
    <div className="agent-panel__head">
      <p className="agent-panel__title">{title}{count}</p>
      {search}
      <button type="button" className="agent-panel__tool" aria-label={`Ver ${title} a pantalla completa`} title="Pantalla completa"
        onClick={() => setFull(true)}><Maximize2 size={14} aria-hidden="true" /></button>
    </div>
    <div className="agent-panel__table"><DataTable columns={props.columns} rows={rows} numeric={numeric} limit={TABLE_PREVIEW_ROWS} /></div>
    {empty}
    {rows.length > TABLE_PREVIEW_ROWS && <button type="button" className="agent-panel__more" onClick={() => setFull(true)}>
      Ver las {rows.length} filas<ArrowRight size={13} aria-hidden="true" />
    </button>}
    {full && <PanelViewer title={title} icon={Table2} onClose={() => setFull(false)}>
      <div className="agent-panel-viewer__content">
        <div className="agent-panel__head"><p className="agent-panel__title">{title}{count}</p>{search}</div>
        <div className="agent-panel__table is-full"><DataTable columns={props.columns} rows={rows} numeric={numeric} limit={TABLE_ROW_LIMIT} /></div>
        {empty}
        {rows.length > TABLE_ROW_LIMIT && <p className="agent-panel__note">Mostrando {TABLE_ROW_LIMIT} de {rows.length} filas; filtra para acotar.</p>}
      </div>
    </PanelViewer>}
  </section>;
}

function PageFrame({ url, title, colorScheme, onHeight }: { url: string; title: string; colorScheme: 'light' | 'dark'; onHeight?: (height: number) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(PAGE_HEIGHT.initial);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'antares-page-height') return;
      const next = Number(event.data.height);
      if (!Number.isFinite(next)) return;
      const clamped = Math.min(PAGE_HEIGHT.max, Math.max(PAGE_HEIGHT.min, Math.ceil(next)));
      setHeight(clamped);
      setReady(true);
      onHeight?.(clamped);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onHeight]);
  const sendTheme = () => {
    const tokens = getComputedStyle(document.documentElement);
    const vars = Object.fromEntries(Object.entries(PAGE_THEME).map(([name, token]) => [name, tokens.getPropertyValue(token).trim()]));
    frame.current?.contentWindow?.postMessage({ type: 'antares-page-theme', vars }, '*');
  };
  return <iframe ref={frame} title={title} src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" className={ready ? undefined : 'is-loading'}
    aria-busy={!ready} style={{ height, colorScheme }} onLoad={sendTheme} />;
}

function PagePanel({ props, sessionId }: PanelViewProps<z.infer<typeof pageSchema>>) {
  const { addToast } = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [clipped, setClipped] = useState(false);
  const [full, setFull] = useState(false);
  const colorScheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const request = { session_id: sessionId, artifact_id: props.artifact_id, file_index: 0, sha256: props.sha256, color_scheme: colorScheme } as const;
  useEffect(() => {
    let active = true;
    void agentApi.agentArtifactAction({ ...request, action: 'embed' }).then(
      (result) => { if (active) { if (result.url) setUrl(result.url); else setFailed(true); } },
      () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [sessionId, props.artifact_id, props.sha256]);
  const onHeight = useCallback((height: number) => setClipped(height > PAGE_INLINE_MAX), []);
  const openWindow = async () => {
    try { await agentApi.agentArtifactAction({ ...request, action: 'open' }); } catch (error) {
      addToast({ message: errorMessage(error, 'No se pudo abrir la página'), type: 'error' });
    }
  };
  return <section aria-label={`Página ${props.title}`} className="agent-panel agent-panel__page">
    {url && <div className="agent-panel__toolbar">
      <button type="button" className="agent-panel__tool" aria-label={`Abrir página ${props.title} en vista completa`} title="Pantalla completa"
        onClick={() => setFull(true)}><Maximize2 size={14} aria-hidden="true" /></button>
    </div>}
    {failed
      ? <p role="status" className="agent-panel__note">Esta versión de la página ya no está disponible.</p>
      : url
        ? <div className={`agent-panel__clip${clipped ? ' is-clipped' : ''}`} style={{ maxHeight: PAGE_INLINE_MAX }}>
          <PageFrame url={url} title={props.title} colorScheme={colorScheme} onHeight={onHeight} />
          {clipped && <button type="button" className="agent-panel__more is-floating" onClick={() => setFull(true)}>
            Ver todo<Maximize2 size={12} aria-hidden="true" />
          </button>}
        </div>
        : <div className="agent-panel__skeleton" aria-busy="true" />}
    {full && url && <PanelViewer title={props.title} icon={AppWindow} onClose={() => setFull(false)}
      actions={<button type="button" className="agent-panel__tool" aria-label="Abrir en una ventana aparte" title="Abrir en una ventana aparte"
        onClick={() => void openWindow()}><ExternalLink size={15} aria-hidden="true" /></button>}>
      <div className="agent-panel-viewer__content"><PageFrame url={url} title={`${props.title} (pantalla completa)`} colorScheme={colorScheme} /></div>
    </PanelViewer>}
  </section>;
}

function entry<S extends z.ZodTypeAny>(schema: S, View: ComponentType<PanelViewProps<z.infer<S>>>) {
  return (panel: AgentPanel, context: Omit<PanelViewProps<unknown>, 'panel' | 'props'>) => {
    const parsed = schema.safeParse(panel.props);
    return parsed.success ? <View panel={panel} props={parsed.data} {...context} /> : null;
  };
}

const PANELS: Record<string, ReturnType<typeof entry>> = {
  choice: entry(choiceSchema, ChoicePanel),
  form: entry(formSchema, FormPanel),
  table: entry(tableSchema, TablePanel),
  page: entry(pageSchema, PagePanel),
};

export default function PanelRenderer({ panel, sessionId, onRespond }: { panel: AgentPanel; sessionId: string; onRespond: PanelRespond }) {
  const render = Object.prototype.hasOwnProperty.call(PANELS, panel.type) ? PANELS[panel.type] : undefined;
  const view = render?.(panel, { sessionId, onRespond });
  if (view) return <div id={`agent-panel-${panel.id}`}>{view}</div>;
  return <PanelFrame title="No se pudo mostrar el panel">
    <details className="agent-panel__fallback">
      <summary>El agente envió datos con un formato no compatible. Ver datos</summary>
      <pre>{JSON.stringify({ type: panel.type, props: panel.props }, null, 2)}</pre>
    </details>
  </PanelFrame>;
}
