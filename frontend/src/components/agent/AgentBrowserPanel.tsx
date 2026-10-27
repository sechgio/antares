import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Bot, FileUp, Globe, Hand, Loader2, Maximize2, Minimize2, MoreVertical, PenLine, Plus, RotateCw, X } from 'lucide-react';
import { agentApi, type AgentBrowserState } from '../../api/agentApi';
import { onNotify } from '../../api/core';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import BrowserAnnotator from './BrowserAnnotator';
import { ANNOTATABLE_FILES, fileSource, type AnnotationSource } from './annotationSource';

const EMPTY: AgentBrowserState = {
  open: false, url: '', title: '', loading: false, can_go_back: false, can_go_forward: false, docked: false, user_control: false,
  busy_until: 0, busy_reason: '', active_tab: 'agent', tabs: [],
};

const OVERLAY = '[role="menu"], [role="dialog"], [role="listbox"], [role="alertdialog"]';
const MAX_USER_TABS = 8;
const MENU_ITEM = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-input)] disabled:pointer-events-none disabled:opacity-40';

export default function AgentBrowserPanel({ onClose, onAnnotate }: {
  onClose: () => void;
  onAnnotate?: (files: File[], source: string, notes: string[]) => void;
}) {
  const { addToast } = useToast();
  const [state, setState] = useState<AgentBrowserState>(EMPTY);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const [width, setWidth] = useState<number | null>(null);
  const [layout, setLayout] = useState({ width: 340, available: 0 });
  const [drag, setDrag] = useState<{ pointerId: number; x: number; width: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const panelRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const addressRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [shot, setShot] = useState<{ source: AnnotationSource; web: boolean } | null>(null);
  const menu = useAnchoredPopover<HTMLButtonElement, HTMLDivElement>({
    align: 'end', estimatedWidth: 240, estimatedHeight: 100, stopEscapePropagation: true,
  });
  const annotatingRef = useRef(false);
  const reportRef = useRef<() => void>(() => {});
  const minWidth = layout.available ? Math.min(340, layout.available / 2) : 340;
  const maxWidth = layout.available ? Math.max(minWidth, layout.available - 320) : 760;
  const clampWidth = (value: number) => Math.min(maxWidth, Math.max(minWidth, value));
  const expanded = width !== null && clampWidth(width) >= maxWidth;
  const userTab = (state.active_tab ?? 'agent') !== 'agent';
  const tabs = state.tabs ?? [];
  const atTabCap = tabs.filter((tab) => tab.id !== 'agent').length >= MAX_USER_TABS;
  const busySeconds = !userTab && state.busy_until && !state.user_control
    ? Math.max(0, Math.ceil((state.busy_until - now) / 1000)) : 0;

  useEffect(() => {
    if (userTab || !state.busy_until || state.user_control) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state.busy_until, state.user_control, userTab]);

  useEffect(() => {
    let alive = true;
    void agentApi.agentBrowser('state').then((next) => { if (alive) setState(next); }).catch(() => {});
    const stop = onNotify((method, params) => {
      if (method === 'agent.browser' && params && typeof params === 'object') setState(params as AgentBrowserState);
    });
    return () => { alive = false; stop(); };
  }, []);

  useEffect(() => {
    if (!editing) setAddress(state.url);
  }, [state.url, editing]);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    let frame = 0;
    const report = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const panel = panelRef.current;
        const conversation = panel?.previousElementSibling;
        if (panel && conversation) {
          const width = panel.getBoundingClientRect().width;
          const available = width + conversation.getBoundingClientRect().width;
          setLayout((prev) => prev.width === width && prev.available === available ? prev : { width, available });
        }
        const rect = element.getBoundingClientRect();
        // La vista nativa pinta encima del DOM: si un menú o diálogo la pisa,
        // se desacopla mientras siga abierto para que no lo tape.
        const covered = Array.from(document.querySelectorAll(OVERLAY)).some((overlay) => {
          const box = overlay.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top;
        });
        const bounds = covered || annotatingRef.current ? null : {
          x: rect.left + element.clientLeft,
          y: rect.top + element.clientTop,
          width: element.clientWidth || rect.width,
          height: element.clientHeight || rect.height,
        };
        const key = JSON.stringify(bounds);
        if (key === sent) return;
        sent = key;
        void agentApi.agentBrowser('bounds', { bounds }).catch(() => {});
      });
    };
    let sent = '';
    reportRef.current = report;
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    if (panelRef.current?.parentElement) observer.observe(panelRef.current.parentElement);
    const overlays = new MutationObserver(report);
    overlays.observe(document.body, { childList: true });
    window.addEventListener('resize', report);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      overlays.disconnect();
      window.removeEventListener('resize', report);
      void agentApi.agentBrowser('bounds', { bounds: null }).catch(() => {});
    };
  }, []);

  const run = async (action: 'open' | 'back' | 'forward' | 'reload' | 'tab' | 'new' | 'close' | 'control' | 'allow',
    extra: { url?: string; user?: boolean; tab?: string } = {}) => {
    try {
      setState(await agentApi.agentBrowser(action, extra));
      return true;
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo usar el navegador'), type: 'error' });
      return false;
    }
  };

  const newTab = async () => {
    if (await run('new')) addressRef.current?.focus();
  };

  const annotate = async (open: boolean) => {
    if (!open) {
      annotatingRef.current = false;
      setShot(null);
      reportRef.current();
      return;
    }
    try {
      const capture = await agentApi.agentBrowserCapture();
      annotatingRef.current = true;
      setShot({ source: { name: capture.url, count: 1, page: async () => capture }, web: true });
      reportRef.current();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo capturar la página'), type: 'error' });
    }
  };

  const annotateFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const source = await fileSource(file);
      annotatingRef.current = true;
      setShot({ source, web: false });
      reportRef.current();
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo abrir el archivo'), type: 'error' });
    }
  };

  const iconButton = 'flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-40';

  return (
    <div
      ref={panelRef}
      className="relative flex w-[clamp(340px,44%,760px)] shrink-0"
      style={{ width: width === null ? undefined : clampWidth(width), maxWidth: layout.available ? maxWidth : undefined }}
    >
      <div
        role="separator"
        tabIndex={0}
        aria-label="Ancho del navegador del agente"
        aria-orientation="vertical"
        aria-valuemin={Math.round(minWidth)}
        aria-valuemax={Math.round(maxWidth)}
        aria-valuenow={Math.round(width === null ? layout.width : clampWidth(width))}
        title="Arrastra para cambiar el ancho · Doble clic para restablecer"
        className="agent-browser-resizer"
        data-resizing={drag ? 'true' : undefined}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag({ pointerId: event.pointerId, x: event.clientX, width: panelRef.current?.getBoundingClientRect().width ?? layout.width });
        }}
        onPointerMove={(event) => {
          if (drag?.pointerId === event.pointerId) setWidth(clampWidth(drag.width + drag.x - event.clientX));
        }}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        onLostPointerCapture={() => setDrag(null)}
        onDoubleClick={() => setWidth(null)}
        onKeyDown={(event) => {
          const current = width === null ? layout.width : clampWidth(width);
          const next = { ArrowLeft: current + 24, ArrowRight: current - 24, Home: minWidth, End: maxWidth }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          setWidth(clampWidth(next));
        }}
      />
    <aside aria-label="Navegador del agente" className="agent-browser flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border-medium)] bg-[var(--bg-base)]">
      <div className="flex h-9 shrink-0 items-center gap-1 pl-1.5 pr-1.5">
        <div role="tablist" aria-label="Pestañas del navegador" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          {tabs.map((tab) => {
            const agent = tab.id === 'agent';
            const name = tab.title || tab.label;
            return (
              <div
                key={tab.id}
                className={`group flex min-w-0 max-w-[180px] shrink items-center rounded-md transition-colors ${tab.active
                  ? 'bg-[var(--bg-input)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--bg-input)_60%,transparent)] hover:text-[var(--text-primary)]'}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.active}
                  aria-label={agent && tab.title ? `Agente: ${tab.title}` : name}
                  title={tab.url || name}
                  onClick={() => void run('tab', { tab: tab.id })}
                  onAuxClick={(event) => { if (event.button === 1 && !agent) void run('close', { tab: tab.id }); }}
                  className="flex h-6 min-w-0 flex-1 items-center gap-1.5 pl-2 pr-1 text-left text-[12.5px]"
                >
                  {tab.loading
                    ? <Loader2 size={12} className="shrink-0 animate-spin text-[var(--text-muted)]" />
                    : agent && <Bot size={12} className="shrink-0 text-[var(--text-muted)]" />}
                  <span className="min-w-0 truncate">{name}</span>
                  {tab.user_control && (
                    <span className="size-1.5 shrink-0 rounded-full bg-[var(--accent-yellow)]" title="Tienes el control" />
                  )}
                </button>
                {agent ? <span className="w-1.5 shrink-0" /> : (
                  <button
                    type="button"
                    aria-label={`Cerrar ${name}`}
                    title="Cerrar pestaña"
                    onClick={() => void run('close', { tab: tab.id })}
                    className={`mr-1 flex size-4 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-opacity hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100 ${tab.active ? 'opacity-100' : 'opacity-0'}`}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className={iconButton}
            aria-label="Nueva pestaña"
            title={atTabCap ? `Puedes tener hasta ${MAX_USER_TABS} pestañas abiertas` : 'Nueva pestaña'}
            disabled={atTabCap}
            onClick={() => void newTab()}
          >
            <Plus size={15} />
          </button>
        </div>
        <button
          ref={menu.triggerRef}
          type="button"
          className={iconButton}
          aria-label="Más opciones del navegador"
          aria-haspopup="menu"
          aria-expanded={menu.isOpen}
          onClick={menu.toggle}
        >
          <MoreVertical size={14} />
        </button>
        <button
          type="button"
          className={iconButton}
          aria-label={expanded ? 'Restaurar el ancho del navegador' : 'Expandir el navegador'}
          title={expanded ? 'Restaurar' : 'Expandir'}
          onClick={() => setWidth(expanded ? null : maxWidth)}
        >
          {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
        <button type="button" className={iconButton} aria-label="Cerrar el navegador" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      {menu.isOpen && createPortal(
        <div
          ref={menu.popupRef}
          role="menu"
          aria-label="Opciones del navegador"
          className="fixed z-[300] w-[240px] rounded-xl border border-[var(--border-medium)] bg-[var(--bg-surface)] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.18),0_2px_6px_rgba(0,0,0,0.06)]"
          style={{ top: menu.position?.top ?? -9999, left: menu.position?.left ?? -9999, visibility: menu.position ? 'visible' : 'hidden' }}
        >
          {!userTab && (
            <button
              type="button"
              role="menuitem"
              className={MENU_ITEM}
              disabled={!state.open && !state.user_control}
              onClick={() => { menu.close(); void run('control', { user: !state.user_control }); }}
            >
              <Hand size={14} className="text-[var(--text-secondary)]" />
              {state.user_control ? 'Devolver el control al agente' : 'Tomar el control'}
            </button>
          )}
          {onAnnotate && (
            <button
              type="button"
              role="menuitem"
              className={MENU_ITEM}
              disabled={!state.open && !shot}
              onClick={() => { menu.close(); void annotate(!shot); }}
            >
              <PenLine size={14} className="text-[var(--text-secondary)]" />
              {shot ? 'Dejar de anotar' : 'Anotar la página'}
            </button>
          )}
          {onAnnotate && !shot && (
            <button
              type="button"
              role="menuitem"
              className={MENU_ITEM}
              onClick={() => { menu.close(); fileRef.current?.click(); }}
            >
              <FileUp size={14} className="text-[var(--text-secondary)]" /> Anotar un archivo…
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={MENU_ITEM}
            disabled={atTabCap}
            onClick={() => { menu.close(); void newTab(); }}
          >
            <Plus size={14} className="text-[var(--text-secondary)]" /> Nueva pestaña
          </button>
        </div>,
        document.body,
      )}
      <div className="flex shrink-0 items-center gap-0.5 px-2 pb-1.5">
        <button type="button" className={iconButton} aria-label="Atrás" disabled={!state.can_go_back} onClick={() => void run('back')}>
          <ArrowLeft size={14} />
        </button>
        <button type="button" className={iconButton} aria-label="Adelante" disabled={!state.can_go_forward} onClick={() => void run('forward')}>
          <ArrowRight size={14} />
        </button>
        <button type="button" className={iconButton} aria-label="Recargar" disabled={!state.open} onClick={() => void run('reload')}>
          {state.loading ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}
        </button>
        <form
          className="ml-1 min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!address.trim()) return;
            setEditing(false);
            addressRef.current?.blur();
            void run('open', { url: address });
          }}
        >
          <input
            ref={addressRef}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => { setEditing(true); event.target.select(); }}
            onBlur={() => setEditing(false)}
            placeholder="Escribe una URL"
            aria-label="Dirección del navegador del agente"
            spellCheck={false}
            className="h-6 w-full rounded-md border border-[var(--border-medium)] bg-[var(--bg-input)] px-2 text-[12.5px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--text-muted)]"
          />
        </form>
      </div>
      {!userTab && state.user_control && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-t border-[var(--border-medium)] bg-[color-mix(in_srgb,var(--accent-yellow)_10%,transparent)] px-3 py-1.5 text-[12px] text-[var(--accent-yellow)]">
          <span className="min-w-0 flex-1">Tienes el control: el agente no usará el navegador hasta que se lo devuelvas.</span>
          <button
            type="button"
            onClick={() => void run('control', { user: false })}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium hover:bg-[var(--bg-input)]"
          >
            Devolver
          </button>
        </div>
      )}
      {!userTab && !state.user_control && busySeconds > 0 && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-t border-[var(--border-medium)] bg-[color-mix(in_srgb,var(--accent-primary)_8%,transparent)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)]">
          <span className="min-w-0 flex-1">El agente espera porque usaste la página. Se reanudará en {busySeconds} s.</span>
          <button
            type="button"
            onClick={() => void run('allow')}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent-primary-hover)] hover:bg-[var(--bg-input)]"
          >
            Permitir al agente
          </button>
        </div>
      )}
      <div ref={viewportRef} data-testid="agent-browser-viewport" className="relative min-h-0 flex-1 overflow-hidden border-t border-[var(--border-medium)] bg-[var(--bg-base)]">
        {!state.open && (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <Globe size={22} strokeWidth={1.5} className="mb-1.5 text-[var(--text-muted)]" />
            <p className="text-[13px] font-medium text-[var(--text-primary)]">
              {userTab ? 'Explorar la web' : 'Pestaña del agente'}
            </p>
            <p className="max-w-xs text-[12px] text-[var(--text-muted)]">
              {userTab ? 'Escribe una URL para abrir un sitio.' : 'Aquí verás las páginas que abra el agente.'}
            </p>
          </div>
        )}
        {shot && onAnnotate && (
          <BrowserAnnotator
            source={shot.source}
            onPick={shot.web ? (x, y) => agentApi.agentBrowserInspect(x, y) : undefined}
            onClose={() => void annotate(false)}
            onSubmit={({ files, notes }) => { onAnnotate(files, shot.source.name, notes); void annotate(false); }}
          />
        )}
        <input
          ref={fileRef}
          type="file"
          accept={ANNOTATABLE_FILES}
          aria-label="Archivo para anotar"
          className="hidden"
          onChange={(event) => { void annotateFile(event.target.files?.[0]); event.target.value = ''; }}
        />
      </div>
    </aside>
    </div>
  );
}
