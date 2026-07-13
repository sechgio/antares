import { useTranslation } from 'react-i18next';
import {
  getRunType,
  safeJsonParse,
  type HistoryRunRow,
  type RunTypeId,
} from './runTypes';

export type HistoryRun = HistoryRunRow;
export type RunType = RunTypeId;

interface RunListProps {
  runs: HistoryRun[];
  selected: HistoryRun | null;
  onSelect: (run: HistoryRun) => void;
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
}

export default function RunList({ runs, selected, onSelect, selectedIds, onToggleSelect }: RunListProps) {
  const { t } = useTranslation();
  const showCheckboxes = Boolean(selectedIds && onToggleSelect);

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="relative mb-3">
          <div className="absolute inset-0 rounded-2xl bg-[var(--accent-primary-glow)] blur-lg opacity-40" aria-hidden="true" />
          <div className="relative w-14 h-14 rounded-2xl bg-[var(--bg-elevated)] flex items-center justify-center border border-[var(--border-subtle)]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-muted)]">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
        </div>
        <p className="text-[13px] font-medium text-[var(--text-secondary)]">{t('history.noRuns')}</p>
        <p className="mt-1 text-[11px] text-[var(--text-muted)]">Las ejecuciones aparecerán aquí</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--border-subtle)]">
      {runs.map((run) => {
        const files = safeJsonParse<string[]>(run.files_json, []);
        const fileCount = files.length;
        const options = safeJsonParse<Record<string, unknown>>(run.options_json, {});
        const hasErrors = run.err_count > 0;
        const allErrors = run.ok_count === 0 && run.err_count > 0;
        const total = run.ok_count + run.err_count;
        const successRate = total > 0 ? Math.round((run.ok_count / total) * 100) : 100;
        const isSelected = selected?.id === run.id;
        const isChecked = selectedIds?.has(run.id) ?? false;
        const meta = getRunType(run.run_type || 'conversion');
        const summary = meta.listSummary?.(run, files, options, t);
        const date = new Date(run.timestamp);

        return (
          <div
            key={run.id}
            className={`w-full text-left px-4 py-3.5 text-sm transition-all border-l-[3px] flex gap-2.5 ${
              isSelected
                ? 'bg-[var(--bg-elevated)] border-[var(--accent-primary)]'
                : 'bg-transparent border-transparent hover:bg-[var(--bg-elevated)]'
            }`}
          >
            {showCheckboxes && (
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggleSelect?.(run.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={t('history.selection.toggle', { id: run.id })}
                className="mt-1 h-3.5 w-3.5 accent-[var(--accent-primary)]"
              />
            )}
            <button
              type="button"
              onClick={() => onSelect(run)}
              className="flex-1 min-w-0 text-left"
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)] shrink-0">
                    #{run.id}
                  </span>
                  <span className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                    {date.toLocaleDateString()}{' '}
                    <span className="text-[var(--text-muted)] font-normal">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </span>
                </div>
                <span
                  className={`inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-[10px] font-bold ${
                    allErrors
                      ? 'bg-[color:var(--accent-red)]/15 text-[var(--accent-red)]'
                      : hasErrors
                        ? 'bg-[color:var(--accent-yellow)]/15 text-[var(--accent-yellow)]'
                        : 'bg-[color:var(--accent-green)]/15 text-[var(--accent-green)]'
                  }`}
                  title={`${successRate}% éxito`}
                >
                  {run.ok_count}/{total}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)] flex-wrap">
                <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}>
                  {t(meta.labelKey)}
                </span>
                {summary?.parts.map((part, index) => (
                  <span key={`${run.id}-summary-${index}`} className="truncate">
                    {index > 0 ? <span className="text-[var(--text-muted)] mx-0.5">·</span> : null}
                    {part}
                  </span>
                ))}
                {!summary && fileCount > 0 && (
                  <span>{t('history.list.files', { count: fileCount })}</span>
                )}
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}
