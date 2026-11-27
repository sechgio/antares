import { useCallback, useEffect, useId, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { AppWindow, ArrowDown, ArrowRight, ArrowUp, Check, Copy, ExternalLink, Maximize2, Save, Search, Table2, X, type LucideIcon } from 'lucide-react';
import { z } from 'zod';
import { agentApi, type AgentPanel, type AgentPanelResponse } from '../../api/agentApi';
import { useToast } from '../../hooks/useToast';
import { errorMessage } from '../../utils/errors';
import { DialogSurface } from '../ui/Dialog';
import ErrorBoundary from '../ui/ErrorBoundary';
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
const COLLATOR = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const formDrafts = new Map<string, Record<string, string | number | boolean>>();

function currentPageColorScheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

type Cell = string | number | null;
type TableSort = { column: number; dir: 'asc' | 'desc' } | null;

function compareCells(a: Cell, b: Cell, dir: 'asc' | 'desc'): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const order = typeof a === 'number' && typeof b === 'number' ? a - b : COLLATOR.compare(String(a), String(b));
  return dir === 'asc' ? order : -order;
}

export function tableTsv(columns: string[], rows: Cell[][]): string {
  const clean = (value: Cell) => (value === null ? '' : String(value).replace(/[\t\r\n]+/g, ' '));
  return [columns, ...rows].map((row) => row.map(clean).join('\t')).join('\n');
}

function PanelFrame({ title, answered, dismissed, onDismiss, meta, children }: {
  title: string; answered?: boolean; dismissed?: boolean; onDismiss?: () => void; meta?: ReactNode; children: ReactNode;
}) {
  return <section aria-label={title} data-panel-state={answered ? 'answered' : dismissed ? 'dismissed' : 'open'} className="agent-panel">
    <p className="agent-panel__title">{title}{answered
      ? <span className="agent-panel__meta"><Check size={11} className="mr-0.5 inline" aria-hidden="true" />Respondido</span>
      : dismissed
        ? <span className="agent-panel__meta">Omitido</span>
        : meta && <span className="agent-panel__meta">{meta}</span>}
    {onDismiss && <button type="button" className="agent-panel__dismiss" aria-label={`Omitir ${title}`} title="Seguir sin responder" onClick={onDismiss}>Omitir</button>}</p>
    {children}
  </section>;
}

function ChoicePanel({ panel, props, onRespond }: PanelViewProps<z.infer<typeof choiceSchema>>) {
  const [pending, setPending] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const answered = panel.status === 'answered';
  const closed = panel.status !== 'open';
  const chosen = panel.response && 'choice' in panel.response ? panel.response.choice : pending;
  const custom = chosen && !props.options.includes(chosen) ? chosen : null;
  const choose = async (choice: string) => {
    setPending(choice);
    try { await onRespond(panel, { choice }); } finally { setPending(null); }
  };
  const shortcuts = !closed && props.options.length <= 9;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = Number(event.key) - 1;
    if (!shortcuts || pending !== null || event.altKey || event.ctrlKey || event.metaKey || !(index >= 0 && index < props.options.length)) return;
    event.preventDefault();
    void choose(props.options[index]);
  };
  const dismiss = closed || pending !== null ? undefined : () => {
    setPending('');
    void onRespond(panel, { dismissed: true }).finally(() => setPending(null));
  };
  return <PanelFrame title={props.prompt} answered={answered} dismissed={panel.status === 'dismissed'} onDismiss={dismiss}>
    <div className="agent-panel__options" onKeyDown={onKeyDown}>
      {props.options.map((option, index) => <button key={option} type="button" className="agent-panel__option" aria-pressed={chosen === option}
        aria-keyshortcuts={shortcuts ? String(index + 1) : undefined} disabled={closed || pending !== null} onClick={() => void choose(option)}>
        {chosen === option && <Check size={13} strokeWidth={2.5} aria-hidden="true" />}
        {shortcuts && <kbd aria-hidden="true" className="agent-panel__key">{index + 1}</kbd>}{option}
      </button>)}
      {custom && <button type="button" className="agent-panel__option" aria-pressed="true" disabled>
        <Check size={13} strokeWidth={2.5} aria-hidden="true" />{custom}
      </button>}
    </div>
    {!closed && <form className="agent-panel__other" onSubmit={(event) => {
      event.preventDefault();
      if (other.trim()) void choose(other.trim());
    }}>
      <input aria-label="Otra respuesta" value={other} maxLength={2000} placeholder="Otra respuesta…" disabled={pending !== null}
        className="agent-panel__input" onChange={(event) => setOther(event.target.value)} />
      <button type="submit" className="agent-panel__tool" aria-label="Enviar otra respuesta" title="Enviar"
        disabled={pending !== null || !other.trim()}><ArrowRight size={14} aria-hidden="true" /></button>
    </form>}
  </PanelFrame>;
}

function FormPanel({ panel, props, onRespond }: PanelViewProps<z.infer<typeof formSchema>>) {
  const answered = panel.status === 'answered';
  const initial = panel.response && 'values' in panel.response ? panel.response.values : formDrafts.get(panel.id) ?? {};
  const [values, setValues] = useState<Record<string, string | number | boolean>>(initial);
  const [busy, setBusy] = useState(false);
  const set = (name: string, value: string | number | boolean) => setValues((current) => {
    const next = { ...current, [name]: value };
    formDrafts.set(panel.id, next);
    return next;
  });
  const missing = props.fields.some((field) => field.required && field.type !== 'checkbox' && !String(values[field.name] ?? '').trim());
  const submit = async () => {
    setBusy(true);
    try { await onRespond(panel, { values }); } finally {
      formDrafts.delete(panel.id);
      setBusy(false);
    }
  };
  const title = props.title || 'Completa los datos';
  if (panel.status === 'dismissed') {
    return <PanelFrame title={title} dismissed><p className="agent-panel__note">Seguiste sin completar este formulario.</p></PanelFrame>;
  }
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
  const dismiss = busy ? undefined : () => {
    setBusy(true);
    void onRespond(panel, { dismissed: true }).finally(() => setBusy(false));
  };
  return <PanelFrame title={title} onDismiss={dismiss}>
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

function DataTable({ columns, rows, numeric, limit, sort, onSort }: {
  columns: string[]; rows: Cell[][]; numeric: boolean[]; limit: number; sort: TableSort; onSort: (column: number) => void;
}) {
  return <table>
    <thead><tr>{columns.map((column, cell) => {
      const dir = sort?.column === cell ? sort.dir : null;
      const Arrow = dir === 'desc' ? ArrowDown : ArrowUp;
      return <th key={column} className={numeric[cell] ? 'is-numeric' : undefined}
        aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}>
        <button type="button" className="agent-panel__sort" onClick={() => onSort(cell)}>
          {column}<Arrow size={11} aria-hidden="true" className={dir ? undefined : 'is-idle'} />
        </button>
      </th>;
    })}</tr></thead>
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

export function TablePanel({ props, onCloseFull }: { props: z.infer<typeof tableSchema>; onCloseFull?: () => void }) {
  const [query, setQuery] = useState('');
  const [full, setFull] = useState(false);
  const [sort, setSort] = useState<TableSort>(null);
  const [copied, setCopied] = useState(false);
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('es');
    const filtered = needle ? props.rows.filter((row) => row.some((cell) => String(cell ?? '').toLocaleLowerCase('es').includes(needle))) : props.rows;
    return sort ? [...filtered].sort((a, b) => compareCells(a[sort.column] ?? null, b[sort.column] ?? null, sort.dir)) : filtered;
  }, [props.rows, query, sort]);
  const onSort = (column: number) => setSort((current) => current?.column !== column ? { column, dir: 'asc' }
    : current.dir === 'asc' ? { column, dir: 'desc' } : null);
  const copyRows = () => {
    void navigator.clipboard?.writeText(tableTsv(props.columns, rows)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  const copy = <button type="button" className="agent-panel__tool" aria-label={copied ? 'Filas copiadas' : 'Copiar filas para Excel'}
    title={copied ? 'Copiado' : 'Copiar filas (se pegan en Excel)'} onClick={copyRows}>
    {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
  </button>;
  const title = props.title || 'Tabla';
  const numeric = props.columns.map((_, cell) => props.rows.some((row) => typeof row[cell] === 'number')
    && props.rows.every((row) => row[cell] === null || typeof row[cell] === 'number'));
  const search = <label className="agent-panel__search">
    <Search size={12} aria-hidden="true" />
    <input aria-label="Filtrar filas" value={query} placeholder="Filtrar…" onChange={(event) => setQuery(event.target.value)} />
  </label>;
  const empty = rows.length === 0 && <p className="agent-panel__note">Ninguna fila coincide con «{query.trim()}».</p>;
  const count = <span className="agent-panel__meta">{rows.length} de {props.rows.length}</span>;
  const viewer = (full || onCloseFull) && <PanelViewer title={title} icon={Table2} onClose={onCloseFull ?? (() => setFull(false))}>
    <div className="agent-panel-viewer__content">
      <div className="agent-panel__head"><p className="agent-panel__title">{title}{count}</p>{search}{copy}</div>
      <div className="agent-panel__table is-full"><DataTable columns={props.columns} rows={rows} numeric={numeric} limit={TABLE_ROW_LIMIT} sort={sort} onSort={onSort} /></div>
      {empty}
      {rows.length > TABLE_ROW_LIMIT && <p className="agent-panel__note">Mostrando {TABLE_ROW_LIMIT} de {rows.length} filas; filtra para acotar.</p>}
    </div>
  </PanelViewer>;
  if (onCloseFull) return viewer;
  return <section aria-label={title} data-panel-state="open" className="agent-panel">
    <div className="agent-panel__head">
      <p className="agent-panel__title">{title}{count}</p>
      {search}
      {copy}
      <button type="button" className="agent-panel__tool" aria-label={`Ver ${title} a pantalla completa`} title="Pantalla completa"
        onClick={() => setFull(true)}><Maximize2 size={14} aria-hidden="true" /></button>
    </div>
    <div className="agent-panel__table"><DataTable columns={props.columns} rows={rows} numeric={numeric} limit={TABLE_PREVIEW_ROWS} sort={sort} onSort={onSort} /></div>
    {empty}
    {rows.length > TABLE_PREVIEW_ROWS && <button type="button" className="agent-panel__more" onClick={() => setFull(true)}>
      Ver las {rows.length} filas<ArrowRight size={13} aria-hidden="true" />
    </button>}
    {viewer}
  </section>;
}

const adjustmentsSchema = z.record(z.string(), z.record(z.string(), z.union([z.string().max(2000), z.number()])));
type Adjustments = z.infer<typeof adjustmentsSchema>;

function PageFrame({ url, title, colorScheme, onHeight, onAdjustments }: {
  url: string; title: string; colorScheme: 'light' | 'dark';
  onHeight?: (height: number) => void; onAdjustments?: (values: Adjustments) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(PAGE_HEIGHT.initial);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frameWindow = frame.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      if (event.data?.type === 'antares-design-adjustments' && onAdjustments) {
        const parsed = adjustmentsSchema.safeParse(event.data.adjustments);
        if (parsed.success) onAdjustments(parsed.data);
      }
      if (event.data?.type !== 'antares-page-height') return;
      const next = Number(event.data.height);
      if (!Number.isFinite(next)) return;
      const clamped = Math.min(PAGE_HEIGHT.max, Math.max(PAGE_HEIGHT.min, Math.ceil(next)));
      setHeight(clamped);
      setReady(true);
      onHeight?.(clamped);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onHeight, onAdjustments]);
  const sendTheme = useCallback(() => {
    const tokens = getComputedStyle(document.documentElement);
    const vars = Object.fromEntries(Object.entries(PAGE_THEME).map(([name, token]) => [name, tokens.getPropertyValue(token).trim()]));
    frame.current?.contentWindow?.postMessage({ type: 'antares-page-theme', colorScheme, vars }, '*');
  }, [colorScheme]);
  useEffect(() => {
    sendTheme();
    const observer = new MutationObserver(() => sendTheme());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, [sendTheme]);
  return <iframe ref={frame} title={title} src={url} sandbox="allow-scripts" referrerPolicy="no-referrer" className={ready ? undefined : 'is-loading'}
    aria-busy={!ready} style={{ height, colorScheme }} onLoad={sendTheme} />;
}

function PagePanel({ props, sessionId }: PanelViewProps<z.infer<typeof pageSchema>>) {
  const { addToast } = useToast();
  const [page, setPage] = useState<{ url: string; sha256?: string; design_current?: boolean }>();
  const [selectedRevision, setSelectedRevision] = useState<{ original: string; sha256?: string }>();
  const [inlineAdjustments, setInlineAdjustments] = useState<Adjustments>({});
  const [fullAdjustments, setFullAdjustments] = useState<Adjustments>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [clipped, setClipped] = useState(false);
  const [full, setFull] = useState(false);
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>(() => currentPageColorScheme());
  useEffect(() => {
    const update = () => setColorScheme(currentPageColorScheme());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const sha256 = selectedRevision?.original === props.sha256 ? selectedRevision.sha256 : props.sha256;
  const request = { session_id: sessionId, artifact_id: props.artifact_id, file_index: 0, sha256, color_scheme: colorScheme } as const;
  useEffect(() => {
    let active = true;
    setPage(undefined);
    setFailed(false);
    setInlineAdjustments({});
    setFullAdjustments({});
    void agentApi.agentArtifactAction({ ...request, action: 'embed' }).then(
      (result) => { if (active) { if (result.url) setPage({ ...result, url: result.url }); else setFailed(true); } },
      () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [sessionId, props.artifact_id, sha256]);
  const url = page?.url;
  const onHeight = useCallback((height: number) => setClipped(height > PAGE_INLINE_MAX), []);
  const saveAdjustments = async (adjustments: Adjustments) => {
    if (!page?.design_current || !page.sha256) return;
    setSaving(true);
    try {
      const result = await agentApi.agentArtifactAction({ ...request, sha256: page.sha256, action: 'save_design_adjustments', adjustments });
      if (!result.sha256) throw new Error('El guardado no devolvió la revisión del diseño');
      setSelectedRevision({ original: props.sha256, sha256: result.sha256 });
      addToast({ message: 'Ajustes de diseño guardados', type: 'success' });
    } catch (error) {
      addToast({ message: errorMessage(error, 'No se pudieron guardar los ajustes de diseño'), type: 'error' });
    } finally {
      setSaving(false);
    }
  };
  const saveButton = (adjustments: Adjustments) => page?.design_current && Object.keys(adjustments).length > 0 && (
    <button type="button" className="agent-panel__tool" aria-label="Guardar ajustes" title="Guardar ajustes" disabled={saving}
      onClick={() => void saveAdjustments(adjustments)}><Save size={14} aria-hidden="true" /></button>
  );
  const openWindow = async () => {
    try { await agentApi.agentArtifactAction({ ...request, action: 'open' }); } catch (error) {
      addToast({ message: errorMessage(error, 'No se pudo abrir la página'), type: 'error' });
    }
  };
  return <section aria-label={`Página ${props.title}`} className="agent-panel agent-panel__page">
    {url && <div className="agent-panel__toolbar">
      {saveButton(inlineAdjustments)}
      {page?.design_current === false && <button type="button" className="agent-panel__more"
        onClick={() => setSelectedRevision({ original: props.sha256 })}>Abrir versión actual</button>}
      <button type="button" className="agent-panel__tool" aria-label={`Abrir página ${props.title} en vista completa`} title="Pantalla completa"
        onClick={() => setFull(true)}><Maximize2 size={14} aria-hidden="true" /></button>
    </div>}
    {failed
      ? <p role="status" className="agent-panel__note">Esta versión de la página ya no está disponible.</p>
      : url
        ? <div className={`agent-panel__clip${clipped ? ' is-clipped' : ''}`} style={{ maxHeight: PAGE_INLINE_MAX }}>
          <PageFrame url={url} title={props.title} colorScheme={colorScheme} onHeight={onHeight}
            onAdjustments={page?.design_current ? setInlineAdjustments : undefined} />
          {clipped && <button type="button" className="agent-panel__more is-floating" onClick={() => setFull(true)}>
            Ver todo<Maximize2 size={12} aria-hidden="true" />
          </button>}
        </div>
        : <div className="agent-panel__skeleton" aria-busy="true" />}
    {full && url && <PanelViewer title={props.title} icon={AppWindow} onClose={() => { setFull(false); setFullAdjustments({}); }}
      actions={<>{saveButton(fullAdjustments)}<button type="button" className="agent-panel__tool" aria-label="Abrir en una ventana aparte" title="Abrir en una ventana aparte"
        onClick={() => void openWindow()}><ExternalLink size={15} aria-hidden="true" /></button></>}>
      <div className="agent-panel-viewer__content"><PageFrame url={url} title={`${props.title} (pantalla completa)`} colorScheme={colorScheme}
        onAdjustments={page?.design_current ? setFullAdjustments : undefined} /></div>
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
  const [attempt, setAttempt] = useState(0);
  const render = Object.prototype.hasOwnProperty.call(PANELS, panel.type) ? PANELS[panel.type] : undefined;
  const view = render?.(panel, { sessionId, onRespond });
  if (view) return <div id={`agent-panel-${panel.id}`}><ErrorBoundary key={attempt} view="agent-panel" fallback={
    <PanelFrame title="No se pudo mostrar el panel">
      <button className="agent-panel__more" type="button" onClick={() => setAttempt((current) => current + 1)}>Reintentar</button>
    </PanelFrame>
  }>{view}</ErrorBoundary></div>;
  return <PanelFrame title="No se pudo mostrar el panel">
    <details className="agent-panel__fallback">
      <summary>El agente envió datos con un formato no compatible. Ver datos</summary>
      <pre>{JSON.stringify({ type: panel.type, props: panel.props }, null, 2)}</pre>
    </details>
  </PanelFrame>;
}
