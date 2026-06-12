import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import { useToast } from '../../hooks/useToast';
import { useDialog } from '../../hooks/useDialog';
import RunList, { HistoryRun } from './RunList';
import RunDetail from './RunDetail';
import { dispatchHistoryReexecute } from './historyEvents';
import { downloadCsvFromBase64 } from '../../utils/csv';
import { getTypeFilters, type RunTypeId } from './runTypes';

const HISTORY_PAGE_SIZE = 50;

function toIsoForFilter(date: string): string | undefined {
  // Convert "YYYY-MM-DD" to a comparable ISO timestamp. We use the start
  // of the day for `from` and end of day for `to` to make the filter
  // inclusive from the user's perspective.
  if (!date) return undefined;
  return new Date(`${date}T00:00:00`).toISOString();
}

function endOfDayIso(date: string): string | undefined {
  if (!date) return undefined;
  return new Date(`${date}T23:59:59.999999`).toISOString();
}

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
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const reqId = useRef(0);
  const typeFilters = useMemo(() => getTypeFilters(t), [t]);

  const loadPage = useCallback(async (reset: boolean) => {
    const id = ++reqId.current;
    setLoadingRuns(true);
    try {
      const offset = reset ? 0 : runs.length;
      const params: { limit: number; offset: number; run_type?: string; date_from?: string; date_to?: string } = {
        limit: HISTORY_PAGE_SIZE + 1,
        offset,
      };
      if (activeType !== 'all') params.run_type = activeType;
      const isoFrom = toIsoForFilter(dateFrom);
      if (isoFrom) params.date_from = isoFrom;
      const isoTo = endOfDayIso(dateTo);
      if (isoTo) params.date_to = isoTo;
      const r = await api.historyList(params);
      if (id !== reqId.current) return;
      const page = (r.runs as HistoryRun[]).slice(0, HISTORY_PAGE_SIZE);
      const nextRuns = reset ? page : [...runs, ...page];
      setHasMoreRuns((r.runs as HistoryRun[]).length > HISTORY_PAGE_SIZE);
      setRuns(nextRuns);
      if (selected && !nextRuns.some((run) => run.id === selected.id)) setSelected(null);
    } catch {
      if (id === reqId.current) addToast({ message: t('history.errors.load'), type: 'error' });
    } finally {
      if (id === reqId.current) setLoadingRuns(false);
    }
    // We intentionally exclude `runs` from deps to avoid a feedback loop;
    // we compare it via a ref-style pattern by reading the closure snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType, dateFrom, dateTo, runs, selected, t, addToast]);

  const refresh = useCallback(() => {
    void loadPage(true);
  }, [loadPage]);

  useEffect(() => {
    setSelectedIds(new Set());
    void loadPage(true);
  }, [activeType, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const ids = selectedIds.size > 0 ? Array.from(selectedIds) : undefined;
      const params: { ids?: number[]; run_type?: string; date_from?: string; date_to?: string } = {};
      if (ids) {
        params.ids = ids;
      } else {
        if (activeType !== 'all') params.run_type = activeType;
        const isoFrom = toIsoForFilter(dateFrom);
        if (isoFrom) params.date_from = isoFrom;
        const isoTo = endOfDayIso(dateTo);
        if (isoTo) params.date_to = isoTo;
      }
      const result = await api.historyExport(params);
      const date = new Date().toISOString().slice(0, 10);
      downloadCsvFromBase64(`historial-${date}.csv`, result.csv);
      addToast({ message: t('history.toasts.exported', { count: result.count }), type: 'success' });
    } catch {
      addToast({ message: t('history.errors.export'), type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="px-6 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t('history.title')}</h2>
          <div className="flex items-center gap-1 bg-[var(--bg-surface)] rounded-full p-1 border border-[var(--border-subtle)]">
            {typeFilters.map((filter) => (
              <button
                key={filter.value}
                onClick={() => setActiveType(filter.value)}
                className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${
                  activeType === filter.value
                    ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
            <label className="flex items-center gap-1">
              <span>{t('history.filters.from')}</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[11px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1">
              <span>{t('history.filters.to')}</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[11px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
              />
            </label>
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-[10px] underline"
              >
                {t('history.filters.clearDates')}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('history.search.placeholder')}
              className="w-56 pl-9 pr-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-full text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:outline-none focus:shadow-[0_0_0_3px_var(--accent-primary-glow)]"
            />
          </div>
          <button
            onClick={() => void exportCsv()}
            disabled={exporting}
            data-testid="history-export-csv"
            className="px-3 py-2 rounded-full text-[11px] font-medium border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting ? t('history.exporting') : t('history.actions.exportCsv')}
          </button>
        </div>
      </div>
      {selectedIds.size > 0 && (
        <div
          data-testid="history-bulk-bar"
          className="px-6 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between text-[12px]"
        >
          <span className="text-[var(--text-secondary)]">
            {t('history.selection.count', { count: selectedIds.size })}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void delMany()}
              className="px-3 py-1 rounded-full text-[11px] font-medium border border-[color:var(--accent-red)]/30 text-[var(--accent-red)] hover:bg-[color:var(--accent-red)]/10"
            >
              {t('history.actions.deleteSelected', { count: selectedIds.size })}
            </button>
            <button
              onClick={clearSelection}
              className="px-3 py-1 rounded-full text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              {t('history.actions.clearSelection')}
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-1 min-h-0">
        <div className="w-[280px] shrink-0 border-r border-[var(--border-subtle)] overflow-y-auto">
          <RunList
            runs={filteredRuns}
            selected={selected}
            onSelect={setSelected}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelected}
          />
          <div className="px-4 py-3">
            {hasMoreRuns && (
              <button
                onClick={() => void loadPage(false)}
                disabled={loadingRuns}
                className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingRuns ? t('history.loading') : t('history.loadMore')}
              </button>
            )}
            {loadingRuns && runs.length === 0 && (
              <p className="py-2 text-center text-xs text-[var(--text-muted)]">{t('history.loadingRuns')}</p>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {selected ? (
            <RunDetail
              run={selected}
              onReexecute={() => reexecute(selected)}
              onDelete={() => del(selected.id)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-12 h-12 rounded-2xl bg-[var(--bg-elevated)] flex items-center justify-center mb-3 border border-[var(--border-subtle)]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-muted)]">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">{t('history.empty')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
