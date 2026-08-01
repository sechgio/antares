import { useEffect, useState, useMemo, useRef, useCallback } from 'react';

import { useTranslation } from 'react-i18next';

import { Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';

import { api } from '../../api';

import { useToast } from '../../hooks/useToast';

import { useDialog } from '../../hooks/useDialog';

import RunList, { HistoryRun } from './RunList';

import RunDetail from './RunDetail';

import { dispatchHistoryReexecute } from './historyEvents';

import { getTypeFilters, type RunTypeId } from './runTypes';



const HISTORY_PAGE_SIZE = 50;



export default function HistoryView() {

  const { t } = useTranslation();

  const { addToast } = useToast();

  const { confirm } = useDialog();

  const [runs, setRuns] = useState<HistoryRun[]>([]);

  const [selected, setSelected] = useState<HistoryRun | null>(null);

  const [searchQuery, setSearchQuery] = useState('');

  const [activeType, setActiveType] = useState<RunTypeId | 'all'>('all');

  const [loadingRuns, setLoadingRuns] = useState(false);

  const [hasMoreRuns, setHasMoreRuns] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [filtersOpen, setFiltersOpen] = useState(false);

  const runsRef = useRef<HistoryRun[]>([]);
  runsRef.current = runs;

  const reqId = useRef(0);

  const typeFilters = useMemo(() => getTypeFilters(t), [t]);



  const loadPage = useCallback(async (reset: boolean) => {
    const id = ++reqId.current;
    setLoadingRuns(true);
    try {
      const currentRuns = runsRef.current;
      const offset = reset ? 0 : currentRuns.length;
      const params: { limit: number; offset: number; run_type?: string } = {
        limit: HISTORY_PAGE_SIZE + 1,
        offset,
      };
      if (activeType !== 'all') params.run_type = activeType;

      const r = await api.historyList(params);
      if (id !== reqId.current) return;

      const rawRuns = (r?.runs as HistoryRun[]) || [];
      const page = rawRuns.slice(0, HISTORY_PAGE_SIZE);

      setHasMoreRuns(rawRuns.length > HISTORY_PAGE_SIZE);
      setRuns((prev) => {
        const nextRuns = reset ? page : [...prev, ...page];
        if (selected && !nextRuns.some((run) => run.id === selected.id)) setSelected(null);
        return nextRuns;
      });
    } catch {
      if (id === reqId.current) addToast({ message: t('history.errors.load') || 'Error al cargar el historial', type: 'error' });
    } finally {
      if (id === reqId.current) setLoadingRuns(false);
    }
  }, [activeType, selected, t, addToast]);



  const refresh = useCallback(() => {

    void loadPage(true);

  }, [loadPage]);



  useEffect(() => {

    setSelectedIds(new Set());

    void loadPage(true);

  }, [activeType]); // eslint-disable-line react-hooks/exhaustive-deps



  const filteredRuns = useMemo(() => {

    if (!searchQuery.trim()) return runs;

    const q = searchQuery.toLowerCase();

    return runs.filter((r) =>

      r.formato.toLowerCase().includes(q) ||

      r.patron.toLowerCase().includes(q) ||

      new Date(r.timestamp).toLocaleString().toLowerCase().includes(q)

    );

  }, [runs, searchQuery]);



  const reexecute = (run: HistoryRun) => {

    dispatchHistoryReexecute(run);

    addToast({ message: t('history.toasts.reexecute'), type: 'success' });

  };



  const toggleSelected = (id: number) => {

    setSelectedIds((prev) => {

      const next = new Set(prev);

      if (next.has(id)) {

        next.delete(id);

      } else {

        next.add(id);

      }

      return next;

    });

  };



  const clearSelection = () => setSelectedIds(new Set());



  const del = async (id: number) => {

    const ok = await confirm({

      title: t('history.confirmDelete.title'),

      description: t('history.confirmDelete.description'),

      type: 'destructive',

      confirmLabel: t('history.delete'),

    });

    if (!ok) return;

    try {

      await api.historyDelete(id);

      await refresh();

      if (selected?.id === id) setSelected(null);

      addToast({ message: t('history.toasts.deleted'), type: 'success' });

    } catch {

      addToast({ message: t('history.errors.delete'), type: 'error' });

    }

  };



  const delMany = async () => {

    if (selectedIds.size === 0) return;

    const ok = await confirm({

      title: t('history.confirmDeleteMany.title', { count: selectedIds.size }),

      description: t('history.confirmDeleteMany.description', { count: selectedIds.size }),

      type: 'destructive',

      confirmLabel: t('history.delete'),

    });

    if (!ok) return;

    try {

      const ids = Array.from(selectedIds);

      await api.historyDeleteMany(ids);

      await refresh();

      setSelectedIds(new Set());

      addToast({ message: t('history.toasts.deletedMany', { count: ids.length }), type: 'success' });

    } catch {

      addToast({ message: t('history.errors.delete'), type: 'error' });

    }

  };



  const hasActiveFilters = activeType !== 'all';



  return (

    <div className="flex flex-col h-full w-full bg-[var(--bg-base)] text-[var(--text-primary)]">

      {/* Barra de herramientas superior */}

      <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3">

        <div className="flex items-center justify-between gap-3 flex-wrap">

          <div className="flex items-center gap-3 min-w-0">

            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-primary-glow)] text-[var(--accent-primary)]">

              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">

                <path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" />

              </svg>

            </div>

            <div className="min-w-0">

              <h2 className="text-[15px] font-semibold leading-tight text-[var(--text-primary)]">{t('history.title')}</h2>

              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">

                {filteredRuns.length > 0

                  ? `${filteredRuns.length} ${filteredRuns.length === 1 ? 'ejecución' : 'ejecuciones'}`

                  : t('history.noRuns')}

              </p>

            </div>

          </div>



          <div className="flex items-center gap-2 flex-wrap">

            <div className="relative">

              <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />

              <input

                type="text"

                value={searchQuery}

                onChange={(e) => setSearchQuery(e.target.value)}

                placeholder={t('history.search.placeholder')}

                className="w-56 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-2 pl-9 pr-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-all focus:border-[var(--accent-primary)] focus:outline-none focus:shadow-[0_0_0_3px_var(--accent-primary-glow)]"

              />

            </div>



            <WithHoverTooltip label="Filtros" placement="bottom">

            <button

              type="button"

              onClick={() => setFiltersOpen((v) => !v)}

              aria-expanded={filtersOpen}

              aria-label="Filtros"

              className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[12px] font-medium transition-all ${

                filtersOpen || hasActiveFilters

                  ? 'border-[var(--accent-primary)] bg-[var(--accent-primary-glow)] text-[var(--text-primary)]'

                  : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]'

              }`}

            >

              <SlidersHorizontal size={14} strokeWidth={2} />

              <span className="hidden sm:inline">Filtros</span>

              {hasActiveFilters && (

                <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-primary)] px-1 text-[10px] font-bold text-[var(--text-on-accent)]">

                  1

                </span>

              )}

            </button>

            </WithHoverTooltip>

          </div>

        </div>



        {/* Panel de filtros desplegable */}

        {filtersOpen && (

          <div className="mt-3 animate-fade-in rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">

            <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">

              Tipo de ejecución

            </p>

            <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

              {typeFilters.map((filter) => (

                <button

                  key={filter.value}

                  type="button"

                  onClick={() => setActiveType(filter.value)}

                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-all ${

                    activeType === filter.value

                      ? 'border-[var(--accent-primary)] bg-[var(--accent-primary-glow)] text-[var(--text-primary)]'

                      : 'border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]'

                  }`}

                >

                  {filter.label}

                </button>

              ))}

            </div>

          </div>

        )}

      </div>



      {/* Barra de seleccion masiva */}

      {selectedIds.size > 0 && (

        <div

          data-testid="history-bulk-bar"

          className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--accent-primary-glow)] px-5 py-2.5"

        >

          <div className="flex items-center justify-between gap-3 text-[12px]">

            <div className="flex items-center gap-2 text-[var(--text-primary)]">

              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--accent-primary)] px-2 text-[11px] font-bold text-[var(--text-on-accent)]">

                {selectedIds.size}

              </span>

              <span className="font-medium">{t('history.selection.count', { count: selectedIds.size })}</span>

            </div>

            <div className="flex items-center gap-2">

              <button

                onClick={() => void delMany()}

                className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--accent-red)]/30 bg-[color:var(--accent-red)]/10 px-3 py-1.5 text-[11px] font-medium text-[var(--accent-red)] transition-colors hover:bg-[color:var(--accent-red)]/20"

              >

                <Trash2 size={12} strokeWidth={2} />

                {t('history.actions.deleteSelected', { count: selectedIds.size })}

              </button>

              <button

                onClick={clearSelection}

                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"

              >

                <X size={12} strokeWidth={2} />

                {t('history.actions.clearSelection')}

              </button>

            </div>

          </div>

        </div>

      )}



      {/* Cuerpo: lista + detalle */}

      <div className="flex flex-1 min-h-0">

        <div className="w-[300px] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] flex flex-col min-h-0">

          <div className="flex-1 overflow-y-auto custom-scrollbar">

            <RunList

              runs={filteredRuns}

              selected={selected}

              onSelect={setSelected}

              selectedIds={selectedIds}

              onToggleSelect={toggleSelected}

            />

          </div>

          <div className="flex h-8 shrink-0 items-center border-t border-[var(--border-subtle)] px-4">
            {hasMoreRuns && (
              <button
                onClick={() => void loadPage(false)}
                disabled={loadingRuns}
                className="inline-flex h-6 items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 text-[11px] font-medium text-[var(--text-secondary)] transition-all hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingRuns ? t('history.loading') : t('history.loadMore')}
              </button>
            )}
            {loadingRuns && runs.length === 0 && (
              <p className="text-[10px] text-[var(--text-muted)]">{t('history.loadingRuns')}</p>
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col bg-[var(--bg-base)]">
          <div className="min-h-0 flex-1 overflow-y-auto">

          {selected ? (

            <RunDetail

              run={selected}

              onReexecute={() => reexecute(selected)}

              onDelete={() => del(selected.id)}

            />

          ) : (

            <div className="flex flex-col items-center justify-center h-full px-6 text-center animate-fade-in">

              <div className="relative mb-4">

                <div className="absolute inset-0 rounded-2xl bg-[var(--accent-primary-glow)] blur-xl opacity-60" aria-hidden="true" />

                <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)]">

                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">

                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />

                    <polyline points="14 2 14 8 20 8" />

                    <line x1="16" y1="13" x2="8" y2="13" />

                    <line x1="16" y1="17" x2="8" y2="17" />

                    <polyline points="10 9 9 9 8 9" />

                  </svg>

                </div>

              </div>

              <p className="text-[14px] font-medium text-[var(--text-secondary)]">{t('history.empty')}</p>

              <p className="mt-1 text-[12px] text-[var(--text-muted)]">Selecciona una ejecución del listado para revisar su detalle</p>

            </div>

          )}

          </div>
          <div
            className="h-8 shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}


