import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Globe, Hand, Loader2, RotateCw, X } from 'lucide-react';
import { agentApi, type AgentBrowserState } from '../../api/agentApi';
import { onNotify } from '../../api/core';
import { errorMessage } from '../../utils/errors';
import { useToast } from '../../hooks/useToast';

const EMPTY: AgentBrowserState = {
  open: false, url: '', title: '', loading: false, can_go_back: false, can_go_forward: false, docked: false, user_control: false,
};

// La página es una vista nativa que el proceso principal coloca encima del hueco
// «agent-browser-viewport»: el panel solo le informa de su posición y tamaño.
export default function AgentBrowserPanel({ onClose }: { onClose: () => void }) {
  const { addToast } = useToast();
  const [state, setState] = useState<AgentBrowserState>(EMPTY);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);

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
        const rect = element.getBoundingClientRect();
        void agentApi.agentBrowser('bounds', {
          bounds: {
            x: rect.left + element.clientLeft,
            y: rect.top + element.clientTop,
            width: element.clientWidth || rect.width,
            height: element.clientHeight || rect.height,
          },
        }).catch(() => {});
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', report);
      void agentApi.agentBrowser('bounds', { bounds: null }).catch(() => {});
    };
  }, []);

  const run = async (action: 'open' | 'back' | 'forward' | 'reload' | 'control', extra: { url?: string; user?: boolean } = {}) => {
    try {
      setState(await agentApi.agentBrowser(action, extra));
    } catch (err) {
      addToast({ message: errorMessage(err, 'No se pudo usar el navegador'), type: 'error' });
    }
  };

  const iconButton = 'flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-40';

  return (
    <aside aria-label="Navegador del agente" className="agent-browser flex w-[clamp(340px,44%,760px)] shrink-0 flex-col overflow-hidden rounded-[24px] bg-[var(--bg-base)]">
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
        <button
          type="button"
          aria-pressed={state.user_control}
          title={state.user_control ? 'Devolver el navegador al agente' : 'Tomar el control: el agente esperará mientras usas la página'}
          onClick={() => void run('control', { user: !state.user_control })}
          className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors ${state.user_control
            ? 'bg-[color-mix(in_srgb,var(--accent-yellow)_18%,transparent)] text-[var(--accent-yellow)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]'}`}
        >
          <Hand size={13} />
          {state.user_control ? 'Devolver' : 'Tomar el control'}
        </button>
        <button type="button" className={iconButton} aria-label="Cerrar el navegador" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      {state.user_control && (
        <div role="status" className="mx-2.5 mb-2 rounded-md bg-[color-mix(in_srgb,var(--accent-yellow)_12%,transparent)] px-2.5 py-1.5 text-[12px] text-[var(--accent-yellow)]">
          Tienes el control: el agente no usará el navegador hasta que se lo devuelvas.
        </div>
      )}
      <div ref={viewportRef} data-testid="agent-browser-viewport" className="relative mx-2.5 mb-2.5 min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {!state.open && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Globe size={22} className="text-[var(--text-muted)]" />
            <p className="text-[13px] text-[var(--text-secondary)]">Aquí verás las páginas que abra el agente.</p>
            <p className="max-w-xs text-[12px] text-[var(--text-muted)]">
              También puedes escribir una dirección arriba, por ejemplo para iniciar sesión en un sitio antes de pedirle algo.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
