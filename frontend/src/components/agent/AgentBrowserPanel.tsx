import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Globe, Hand, Loader2, RotateCw, X } from 'lucide-react';
import { agentApi, type AgentBrowserState } from '../../api/agentApi';
import { onNotify } from '../../api/core';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';

const EMPTY: AgentBrowserState = {
  open: false, url: '', title: '', loading: false, can_go_back: false, can_go_forward: false, docked: false, user_control: false,
  busy_until: 0, busy_reason: '', active_tab: 'agent', tabs: [],
};

const OVERLAY = '[role="menu"], [role="dialog"], [role="listbox"], [role="alertdialog"]';

export default function AgentBrowserPanel({ onClose }: { onClose: () => void }) {
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
  const minWidth = layout.available ? Math.min(340, layout.available / 2) : 340;
  const maxWidth = layout.available ? Math.max(minWidth, layout.available - 320) : 760;
  const clampWidth = (value: number) => Math.min(maxWidth, Math.max(minWidth, value));
  const userTab = state.active_tab === 'user';
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
        const bounds = covered ? null : {
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

  const run = async (action: 'open' | 'back' | 'forward' | 'reload' | 'tab' | 'control' | 'allow',
    extra: { url?: string; user?: boolean; tab?: 'agent' | 'user' } = {}) => {
    try {
      setState(await agentApi.agentBrowser(action, extra));
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo usar el navegador'), type: 'error' });
    }
  };

  const iconButton = 'flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-40';

  return (
    <div
      ref={panelRef}
      className="relative -my-2.5 -ml-3 -mr-2.5 flex w-[clamp(340px,44%,760px)] shrink-0"
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
    <aside aria-label="Navegador del agente" className="agent-browser flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-base)]">
      <div className="flex shrink-0 items-center gap-1 px-2.5 pb-2 pt-3">
        <button type="button" className={iconButton} aria-label="Atrás" disabled={!state.can_go_back} onClick={() => void run('back')}>
          <ArrowLeft size={14} />
        </button>
        <button type="button" className={iconButton} aria-label="Adelante" disabled={!state.can_go_forward} onClick={() => void run('forward')}>
          <ArrowRight size={14} />
        </button>
        <button type="button" className={iconButton} aria-label="Recargar" disabled={!state.open} onClick={() => void run('reload')}>
          {state.loading ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
        </button>
        <form
          className="mx-1 min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!address.trim()) return;
            setEditing(false);
            void run('open', { url: address });
          }}
        >
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => { setEditing(true); event.target.select(); }}
            onBlur={() => setEditing(false)}
            placeholder="Escribe una dirección o una búsqueda"
            aria-label="Dirección del navegador del agente"
            spellCheck={false}
            className="h-7 w-full rounded-md bg-[var(--bg-input)] px-2.5 font-mono text-[12px] text-[var(--text-primary)] outline-none placeholder:font-sans placeholder:text-[var(--text-muted)]"
          />
        </form>
        {!userTab && (
          <button
            type="button"
            aria-pressed={state.user_control}
            disabled={!state.open && !state.user_control}
            title={state.user_control ? 'Devolver el navegador al agente' : 'Tomar el control: el agente esperará mientras usas la página'}
            onClick={() => void run('control', { user: !state.user_control })}
            className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors disabled:pointer-events-none disabled:opacity-40 ${state.user_control
              ? 'bg-[color-mix(in_srgb,var(--accent-yellow)_18%,transparent)] text-[var(--accent-yellow)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]'}`}
          >
            <Hand size={13} />
            {state.user_control ? 'Devolver' : 'Tomar el control'}
          </button>
        )}
        <button type="button" className={iconButton} aria-label="Cerrar el navegador" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {state.tabs && state.tabs.length > 0 && (
        <div role="tablist" aria-label="Pestañas del navegador" className="mx-2.5 mb-2 flex gap-1">
          {state.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.active}
              onClick={() => void run('tab', { tab: tab.id })}
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] transition-colors ${tab.active
                ? 'bg-[var(--bg-input)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]'}`}
            >
              <span className="shrink-0 font-medium">{tab.label}</span>
              {tab.loading && <Loader2 size={11} className="animate-spin" />}
              {tab.title && <span className="min-w-0 truncate text-[var(--text-muted)]">{tab.title}</span>}
              {tab.user_control && (
                <span className="ml-auto size-1.5 shrink-0 rounded-full bg-[var(--accent-yellow)]" title="Tienes el control" />
              )}
            </button>
          ))}
        </div>
      )}
      {!userTab && state.user_control && (
        <div role="status" className="mx-2.5 mb-2 rounded-md bg-[color-mix(in_srgb,var(--accent-yellow)_12%,transparent)] px-2.5 py-1.5 text-[12px] text-[var(--accent-yellow)]">
          Tienes el control: el agente no usará el navegador hasta que se lo devuelvas.
        </div>
      )}
      {!userTab && !state.user_control && busySeconds > 0 && (
        <div role="status" className="mx-2.5 mb-2 flex items-center gap-2 rounded-md bg-[color-mix(in_srgb,var(--accent-primary)_10%,transparent)] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)]">
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
      <div ref={viewportRef} data-testid="agent-browser-viewport" className="relative min-h-0 flex-1 overflow-hidden bg-[var(--bg-surface)]">
        {!state.open && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Globe size={22} className="text-[var(--text-muted)]" />
            <p className="text-[13px] text-[var(--text-secondary)]">
              {userTab ? 'Esta pestaña es tuya.' : 'Aquí verás las páginas que abra el agente.'}
            </p>
            <p className="max-w-xs text-[12px] text-[var(--text-muted)]">
              {userTab
                ? 'Escribe una dirección arriba o abre una página para consultarla mientras el agente trabaja en la suya.'
                : 'También puedes escribir una dirección arriba, por ejemplo para iniciar sesión en un sitio antes de pedirle algo.'}
            </p>
          </div>
        )}
      </div>
    </aside>
    </div>
  );
}
