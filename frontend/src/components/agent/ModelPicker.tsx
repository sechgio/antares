import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, RefreshCw, Search } from 'lucide-react';
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

interface MenuItem {
  provider: string;
  model: string;
  label: string;
  detail?: string;
}

const MENU_HEIGHT = 420;
const MENU_WIDTH = 260;

export default function ModelPicker({ providers, value, onChange, disabled = false, className }: ModelPickerProps) {
  const { isOpen, position, triggerRef, popupRef, open, close, updatePosition } = useAnchoredPopover({
    estimatedHeight: MENU_HEIGHT,
    estimatedWidth: MENU_WIDTH,
    align: 'start',
    gap: 6,
    maxHeightCap: MENU_HEIGHT,
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [models, setModels] = useState<Record<string, ProviderModels>>({});
  const [highlighted, setHighlighted] = useState(0);

  const standard = useMemo(() => providers.filter((item) => !item.custom), [providers]);
  const customs = useMemo(() => providers.filter((item) => item.custom), [providers]);
  const selectedProvider = providers.find((item) => item.id === value.provider);
  const currentProvider = standard.find((item) => item.id === value.provider) ?? standard[0];

  const load = useCallback(async (id: string) => {
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
    if (isOpen) standard.forEach((item) => void load(item.id));
  }, [isOpen, standard, load]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);

  const term = query.trim();
  const groups = useMemo(() => {
    const needle = term.toLowerCase();
    const listed = standard.map((item) => {
      const state = models[item.id] ?? { loading: true, models: [], error: null };
      const unique = [...new Set(state.models)];
      const matches = needle ? unique.filter((model) => model.toLowerCase().includes(needle)) : unique;
      const entries: MenuItem[] = matches.map((model) => ({ provider: item.id, model, label: model }));
      if (term && item.id === currentProvider?.id && !unique.includes(term)) {
        entries.push({ provider: item.id, model: term, label: `Usar «${term}»` });
      }
      return { id: item.id, label: item.label, state, entries, custom: false };
    });
    // Un modelo personalizado muestra su modelo configurado y, tras «Buscar
    // modelos activos», los que su endpoint sirve ahora mismo.
    const customEntries: MenuItem[] = customs.flatMap((item) => [
      { provider: item.id, model: item.default_model, label: item.label, detail: item.default_model },
      ...[...new Set(models[item.id]?.models ?? [])].filter((model) => model !== item.default_model)
        .map((model) => ({ provider: item.id, model, label: model, detail: item.label })),
    ]).filter((entry) => !needle || entry.label.toLowerCase().includes(needle) || entry.model.toLowerCase().includes(needle));
    const customLoading = customs.some((item) => models[item.id]?.loading);
    return customs.length
      ? [...listed, { id: 'custom', label: 'Personalizados', state: { loading: customLoading, models: customEntries.map((entry) => entry.model), error: null }, entries: customEntries, custom: true }]
      : listed;
  }, [standard, customs, models, term, currentProvider?.id]);
  const items = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  const loading = groups.some((group) => group.state.loading);

  useEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen, items.length, loading, updatePosition]);

  useEffect(() => {
    setHighlighted(0);
  }, [query, items.length]);

  useEffect(() => {
    if (isOpen) document.getElementById(`${listId}-${highlighted}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [highlighted, isOpen, listId]);

  const choose = (nextProvider: string, model: string) => {
    onChange({ provider: nextProvider, model });
    close();
    triggerRef.current?.focus();
  };

  const openMenu = () => {
    setQuery('');
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
      <span className={`flex h-7 items-center rounded-md px-2 text-[12px] text-[var(--text-muted)] ${className ?? ''}`}>
        Sin proveedor IA
      </span>
    );
  }

  const modelLabel = (selectedProvider?.custom && (!value.model || value.model === selectedProvider.default_model) && selectedProvider.label)
    || value.model || currentProvider?.default_model || 'Elegir modelo';
  let index = -1;

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
        title={`${selectedProvider?.label ?? currentProvider?.label ?? ''} · ${value.model || modelLabel}`}
        className={`inline-flex h-7 max-w-full items-center gap-1 rounded-md px-2 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${
          isOpen
            ? 'bg-[var(--bg-input)] text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]'
        }`}
      >
        <span className="truncate">{modelLabel}</span>
        <ChevronDown size={14} className="shrink-0 opacity-60" />
      </button>

      {isOpen && createPortal(
        <div
          ref={popupRef}
          role="dialog"
          aria-label="Modelos disponibles"
          className="agent-popover-in agent-model-menu fixed z-[300] flex flex-col overflow-hidden rounded-lg border p-1 shadow-md"
          style={{
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            width: position?.width ?? MENU_WIDTH,
            maxHeight: position?.maxHeight ?? MENU_HEIGHT,
            visibility: position ? 'visible' : 'hidden',
            background: 'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
            transformOrigin: position && triggerRef.current && position.top < triggerRef.current.getBoundingClientRect().top ? 'bottom left' : 'top left',
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
          <div className="-mx-1 -mt-1 mb-1 flex h-9 items-center gap-2 border-b border-[var(--border-subtle)] px-3">
            <Search size={14} className="shrink-0 opacity-50" />
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
              aria-controls={listId}
              aria-activedescendant={items[highlighted] ? `${listId}-${highlighted}` : undefined}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
            {loading && <Loader2 size={13} className="shrink-0 animate-spin text-[var(--text-muted)]" />}
          </div>

          <div role="listbox" id={listId} aria-label="Modelos" aria-busy={loading} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {groups.map(({ id, label, state, entries, custom }, groupIndex) => (
              <Fragment key={id}>
                {groupIndex > 0 && <div role="separator" className="my-1 h-px bg-[var(--border-subtle)]" />}
                <div role="group" aria-label={label}>
                  <p className="px-2 py-1.5 text-[12px] font-medium text-[var(--text-muted)]">{label}</p>
                  {state.loading && state.models.length === 0 && (
                    <div className="space-y-1 px-2 pb-1" aria-hidden="true">
                      {[0, 1].map((row) => (
                        <div key={row} className="h-5 animate-pulse rounded bg-[var(--bg-input)]" style={{ opacity: 1 - row * 0.3 }} />
                      ))}
                    </div>
                  )}
                  {entries.map((item) => {
                    index += 1;
                    const itemIndex = index;
                    const selected = value.provider === item.provider && value.model === item.model;
                    return (
                      <button
                        key={`${item.provider}:${item.model}:${item.label}`}
                        type="button"
                        role="option"
                        id={`${listId}-${itemIndex}`}
                        aria-selected={selected}
                        tabIndex={-1}
                        onMouseEnter={() => setHighlighted(itemIndex)}
                        onClick={() => choose(item.provider, item.model)}
                        className={`relative flex w-full cursor-default select-none items-center rounded-md py-1.5 pl-2 pr-8 text-left text-[13px] font-normal text-[var(--text-primary)] outline-none ${
                          itemIndex === highlighted ? 'bg-[var(--bg-input)]' : ''
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{item.label}</span>
                          {item.detail && <span className="block truncate font-mono text-[11px] text-[var(--text-muted)]">{item.detail}</span>}
                        </span>
                        {selected && <Check size={14} className="absolute right-2 shrink-0" />}
                      </button>
                    );
                  })}
                  {!custom && !state.loading && entries.length === 0 && (
                    <p className="px-2 pb-1.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
                      {state.error
                        ? state.error
                        : state.models.length === 0
                          ? 'Escribe el nombre exacto del modelo.'
                          : 'Sin coincidencias.'}
                    </p>
                  )}
                  {state.error && entries.length > 0 && (
                    <p className="px-2 pb-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">{state.error}</p>
                  )}
                  {custom && customs.map((item) => {
                    const fetched = models[item.id];
                    return (
                      <Fragment key={item.id}>
                        <button
                          type="button"
                          onClick={() => void load(item.id)}
                          disabled={fetched?.loading}
                          aria-label={`Buscar modelos activos de ${item.label}`}
                          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-60"
                        >
                          {fetched?.loading ? <Loader2 size={11} className="shrink-0 animate-spin" /> : <RefreshCw size={11} className="shrink-0" />}
                          <span className="truncate">{customs.length > 1 ? `Buscar modelos activos · ${item.label}` : 'Buscar modelos activos'}</span>
                        </button>
                        {fetched?.error && <p className="px-2 pb-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">{fetched.error}</p>}
                      </Fragment>
                    );
                  })}
                  {state.error && (
                    <button
                      type="button"
                      onClick={() => void load(id)}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                    >
                      <RefreshCw size={11} /> Reintentar
                    </button>
                  )}
                </div>
              </Fragment>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
