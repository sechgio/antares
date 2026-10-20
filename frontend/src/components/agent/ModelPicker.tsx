import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { aiProvidersApi, type AiProviderSpec } from '../../api/aiProvidersApi';
import { errorMessage } from '../../utils/errors';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';

interface ModelChoice {
  provider: string;
  model: string;
}

interface ModelPickerProps {
  providers: AiProviderSpec[];
  value: ModelChoice;
  onChange: (next: ModelChoice) => void;
  disabled?: boolean;
  className?: string;
}

interface ProviderModels {
  loading: boolean;
  models: string[];
  error: string | null;
}

const RECENTS_KEY = 'antares-agent-models';
const MAX_RECENTS = 4;
const MENU_HEIGHT = 420;
const MENU_WIDTH = 360;

function readRecents(): ModelChoice[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is ModelChoice => !!item && typeof item === 'object'
        && typeof (item as ModelChoice).provider === 'string' && typeof (item as ModelChoice).model === 'string')
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function remember(choice: ModelChoice): void {
  try {
    const next = [choice, ...readRecents().filter((item) => item.provider !== choice.provider || item.model !== choice.model)];
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next.slice(0, MAX_RECENTS)));
  } catch {
  }
}

function ProviderMark({ id, label, size = 20 }: { id: string; label: string; size?: number }) {
  const hue = [...id].reduce((sum, char) => sum + char.charCodeAt(0) * 37, 0) % 360;
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-md text-[10px] font-semibold uppercase leading-none"
      style={{ width: size, height: size, background: `hsl(${hue} 55% 50% / 0.18)`, color: `hsl(${hue} 60% 62%)` }}
    >
      {label.trim().charAt(0) || '?'}
    </span>
  );
}

export default function ModelPicker({ providers, value, onChange, disabled = false, className }: ModelPickerProps) {
  const { isOpen, position, triggerRef, popupRef, open, close, updatePosition } = useAnchoredPopover({
    estimatedHeight: MENU_HEIGHT,
    estimatedWidth: MENU_WIDTH,
    align: 'start',
    gap: 8,
    maxHeightCap: MENU_HEIGHT,
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [activeProvider, setActiveProvider] = useState(value.provider || providers[0]?.id || '');
  const [models, setModels] = useState<Record<string, ProviderModels>>({});
  const [highlighted, setHighlighted] = useState(0);

  const provider = providers.find((item) => item.id === activeProvider) ?? providers[0];
  const state = models[activeProvider] ?? { loading: true, models: [], error: null };

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setModels((prev) => ({ ...prev, [id]: { loading: true, models: prev[id]?.models ?? [], error: null } }));
    try {
      const { provider: status } = await aiProvidersApi.aiProviderStatus(id);
      setModels((prev) => ({
        ...prev,
        [id]: {
          loading: false,
          models: status.models ?? [],
          error: status.error ?? (status.reachable ? null : 'No se pudo consultar el proveedor; escribe el modelo a mano'),
        },
      }));
    } catch (err) {
      setModels((prev) => ({
        ...prev,
        [id]: { loading: false, models: [], error: errorMessage(err, 'No se pudieron consultar los modelos') },
      }));
    }
  }, []);

  useEffect(() => {
    if (isOpen && activeProvider) void load(activeProvider);
  }, [isOpen, activeProvider, load]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);

  useEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen, activeProvider, state.models.length, query, updatePosition]);

  const recents = useMemo(
    () => (query.trim() ? [] : readRecents().filter((item) => item.provider === activeProvider)),
    [query, activeProvider],
  );
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const unique = [...new Set(state.models)];
    return term ? unique.filter((model) => model.toLowerCase().includes(term)) : unique;
  }, [state.models, query]);
  const custom = query.trim() && !filtered.some((model) => model === query.trim()) ? query.trim() : '';

  const items = useMemo(
    () => [
      ...recents.map((item) => ({ provider: item.provider, model: item.model, label: item.model, recent: true })),
      ...filtered
        .filter((model) => !recents.some((item) => item.model === model))
        .map((model) => ({ provider: activeProvider, model, label: model, recent: false })),
      ...(custom
        ? [{ provider: activeProvider, model: custom, label: `Usar «${custom}»`, recent: false }]
        : []),
    ],
    [recents, filtered, custom, activeProvider],
  );

  const recentCount = items.filter((item) => item.recent).length;
  const sections = [
    { id: 'recent', title: 'Recientes', from: 0, to: recentCount },
    { id: 'models', title: provider?.label ?? 'Modelos', from: recentCount, to: items.length },
  ].filter((section) => section.to > section.from);

  useEffect(() => {
    setHighlighted(0);
  }, [query, activeProvider, items.length]);

  useEffect(() => {
    if (isOpen) document.getElementById(`${listId}-${highlighted}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [highlighted, isOpen, listId]);

  const choose = (nextProvider: string, model: string) => {
    const choice = { provider: nextProvider, model };
    remember(choice);
    onChange(choice);
    close();
    triggerRef.current?.focus();
  };

  const openMenu = () => {
    setQuery('');
    setActiveProvider(value.provider || providers[0]?.id || '');
    open();
  };

  const handleSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!items.length) return;
      setHighlighted((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[highlighted];
      if (item) choose(item.provider, item.model);
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setHighlighted(event.key === 'Home' ? 0 : Math.max(0, items.length - 1));
    }
  };

  if (providers.length === 0) {
    return (
      <span className={`flex h-8 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] px-3 text-[12px] text-[var(--text-muted)] ${className ?? ''}`}>
        Sin proveedor IA
      </span>
    );
  }

  const modelLabel = value.model || provider?.default_model || 'Elegir modelo';

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (isOpen ? close() : openMenu())}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label="Elegir proveedor y modelo"
        title={`${providers.find((item) => item.id === value.provider)?.label ?? ''} · ${modelLabel}`}
        className={`flex h-8 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors disabled:opacity-50 ${
          isOpen
            ? 'border-[var(--accent-primary)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
            : 'border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:text-[var(--text-primary)]'
        }`}
      >
        <ProviderMark id={value.provider || provider?.id || ''} label={providers.find((item) => item.id === value.provider)?.label ?? provider?.label ?? ''} size={18} />
        <span className="truncate font-medium text-[var(--text-primary)]">{modelLabel}</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180 text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'}`} />
      </button>

      {isOpen && createPortal(
        <div
          ref={popupRef}
          role="dialog"
          aria-label="Modelos disponibles"
          className="agent-popover-in agent-model-menu fixed z-[300] flex flex-col overflow-hidden rounded-2xl border shadow-xl"
          style={{
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            width: position?.width ?? MENU_WIDTH,
            maxHeight: position?.maxHeight ?? MENU_HEIGHT,
            visibility: position ? 'visible' : 'hidden',
            background: 'var(--bg-elevated)',
            borderColor: 'var(--border-medium)',
            transformOrigin: position && triggerRef.current && position.top < triggerRef.current.getBoundingClientRect().top ? 'bottom right' : 'top right',
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
              triggerRef.current?.focus();
            }
          }}
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)
              && !triggerRef.current?.contains(event.relatedTarget)) close();
          }}
        >
          <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-3.5 py-3">
            <Search size={15} className="shrink-0 text-[var(--text-muted)]" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKey}
              placeholder="Buscar modelo…"
              spellCheck={false}
              aria-label="Buscar modelo"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={!state.loading || state.models.length > 0 ? listId : undefined}
              aria-activedescendant={(!state.loading || state.models.length > 0) && items[highlighted] ? `${listId}-${highlighted}` : undefined}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
            {state.loading
              ? <Loader2 size={14} className="shrink-0 animate-spin text-[var(--text-muted)]" />
              : <kbd className="shrink-0 rounded-md border border-[var(--border-subtle)] px-1.5 py-0.5 font-sans text-[10px] text-[var(--text-muted)]">Esc</kbd>}
          </div>

          {providers.length > 1 && (
            <div className="flex gap-1 overflow-x-auto border-b border-[var(--border-subtle)] px-2.5 py-2 custom-scrollbar">
              {providers.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={item.id === activeProvider}
                  onClick={() => setActiveProvider(item.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2.5 text-[12px] font-medium transition-colors ${
                    item.id === activeProvider
                      ? 'bg-[var(--bg-input)] text-[var(--text-primary)] ring-1 ring-[var(--border-medium)]'
                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  <ProviderMark id={item.id} label={item.label} size={16} />
                  {item.label}
                </button>
              ))}
            </div>
          )}

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5" aria-busy={state.loading}>
            {state.loading && state.models.length === 0 ? (
              <div className="space-y-1.5 p-1" aria-hidden="true">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="h-8 animate-pulse rounded-lg bg-[var(--bg-input)]" style={{ opacity: 1 - row * 0.2 }} />
                ))}
              </div>
            ) : (
              <>
                <div role="listbox" id={listId} aria-label="Modelos">
                  {sections.map((section) => (
                    <div key={section.id} role="group" aria-label={section.title} className="pb-1">
                      <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-[var(--text-muted)]">{section.title}</p>
                      {items.slice(section.from, section.to).map((item, offset) => {
                        const index = section.from + offset;
                        const selected = value.provider === item.provider && value.model === item.model;
                        const isCustom = !item.recent && item.label !== item.model;
                        return (
                          <button
                            key={`${item.recent ? 'recent' : 'model'}:${item.provider}:${item.model}`}
                            type="button"
                            role="option"
                            id={`${listId}-${index}`}
                            aria-selected={selected}
                            tabIndex={-1}
                            onMouseEnter={() => setHighlighted(index)}
                            onClick={() => choose(item.provider, item.model)}
                            className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                              index === highlighted ? 'bg-[var(--bg-input)]' : ''
                            }`}
                          >
                            {isCustom
                              ? <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-md border border-dashed border-[var(--border-medium)] text-[var(--text-muted)]"><Plus size={12} /></span>
                              : <ProviderMark id={item.provider} label={providers.find((entry) => entry.id === item.provider)?.label ?? item.provider} />}
                            <span className={`min-w-0 flex-1 truncate text-[13px] ${selected ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{item.label}</span>
                            {selected && <Check size={14} className="shrink-0 text-[var(--accent-primary-hover)]" />}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                {items.length === 0 && !custom && (
                  <p className="px-2 py-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
                    {state.error
                      ? state.error
                      : state.models.length === 0
                        ? 'Escribe el nombre exacto del modelo que ofrece tu proveedor.'
                        : 'Ningún modelo coincide con la búsqueda.'}
                  </p>
                )}
              </>
            )}
            {state.error && state.models.length > 0 && (
              <p className="px-2 py-2 text-[11px] leading-relaxed text-[var(--text-muted)]">{state.error}</p>
            )}
            {state.error && (
              <button
                type="button"
                onClick={() => void load(activeProvider)}
                className="mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                <RefreshCw size={11} /> Reintentar
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-3.5 py-2 text-[11px] text-[var(--text-muted)]">
            <span>Se aplica a los siguientes mensajes</span>
            <span aria-hidden="true" className="flex shrink-0 items-center gap-1.5">
              <kbd className="rounded-md border border-[var(--border-subtle)] px-1.5 font-sans">↑↓</kbd>
              <kbd className="rounded-md border border-[var(--border-subtle)] px-1.5 font-sans">↵</kbd>
            </span>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export { readRecents as readModelRecents };
