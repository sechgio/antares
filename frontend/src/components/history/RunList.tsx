import { useTranslation } from 'react-i18next';
import Badge from '../ui/Badge';
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
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="w-12 h-12 rounded-2xl bg-[var(--bg-elevated)] flex items-center justify-center mb-3 border border-[var(--border-subtle)]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-muted)]">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">{t('history.noRuns')}</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--border-subtle)]">
      {runs.map((run) => {
        const fileCount = safeJsonParse<string[]>(run.files_json, []).length;
        const options = safeJsonParse<Record<string, unknown>>(run.options_json, {});
        const files = safeJsonParse<string[]>(run.files_json, []);
        const hasErrors = run.err_count > 0;
        const allErrors = run.ok_count === 0 && run.err_count > 0;
        const isSelected = selected?.id === run.id;
        const isChecked = selectedIds?.has(run.id) ?? false;
        const meta = getRunType(run.run_type || 'conversion');
        const summary = meta.listSummary?.(run, files, options, t);

        return (
          <div
            key={run.id}
            className={`w-full text-left px-5 py-4 text-sm transition-all border-l-2 flex gap-2 ${
              isSelected
                ? 'bg-[var(--bg-surface)] border-[var(--accent-primary)]'
                : 'bg-transparent border-transparent hover:bg-[var(--bg-surface)]'
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
              className="flex-1 text-left"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-medium text-[13px] text-[var(--text-primary)]">{new Date(run.timestamp).toLocaleString()}</span>
                <Badge variant={allErrors ? 'error' : hasErrors ? 'warning' : 'success'} className="text-[10px]">
                  {run.ok_count}/{run.ok_count + run.err_count}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${meta.badgeClass}`}>
                  {t(meta.labelKey)}
                </span>
                {summary?.parts.map((part, index) => (
                  <span key={`${run.id}-summary-${index}`}>
                    {index > 0 ? ' · ' : ''}{part}
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
