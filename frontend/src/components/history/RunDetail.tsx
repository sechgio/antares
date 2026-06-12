import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import {
  formatRunStats,
  getRunType,
  safeJsonParse,
  schemaOptionKeys,
  type HistoryRunRow,
} from './runTypes';

interface RunDetailProps {
  run: HistoryRunRow;
  onReexecute: () => void;
  onDelete: () => void;
}

export default function RunDetail({ run, onReexecute, onDelete }: RunDetailProps) {
  const { t } = useTranslation();
  const files = safeJsonParse<string[]>(run.files_json, []);
  const options = safeJsonParse<Record<string, unknown>>(run.options_json, {});
  const meta = getRunType(run.run_type || 'conversion');
  const stats = formatRunStats(run, t);
  const allowedOptionKeys = schemaOptionKeys(meta);
  const visibleOptions = Object.entries(options).filter(([key]) => allowedOptionKeys.has(key));

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="eyebrow">{t('history.detail')}</div>
            <span className={`text-[10px] font-semibold tracking-wider uppercase ${meta.colorClass}`}>
              {t(meta.labelKey)}
            </span>
          </div>
          <h3 className="text-xl font-semibold text-[var(--text-primary)]">
            {t('history.execution', { id: run.id })}
          </h3>
        </div>
        <div className="flex gap-2">
          {meta.reexecute && (
            <Button variant="primary" size="sm" onClick={onReexecute}>{t('history.reexecute')}</Button>
          )}
          <Button variant="ghost" size="sm" className="text-[var(--accent-red)] hover:text-[var(--accent-red)]" onClick={onDelete}>
            {t('history.delete')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-[var(--bg-surface)] rounded-xl p-4 border border-[var(--border-subtle)]">
            <div className="eyebrow mb-2">{stat.label}</div>
            <div className={`text-lg font-semibold ${stat.color || 'text-[var(--text-primary)]'}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {meta.showPatron && (
        <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] p-4">
          <div className="eyebrow mb-2">{t('history.pattern')}</div>
          <code className="text-sm text-[var(--text-primary)] font-mono bg-[var(--bg-elevated)] px-3 py-2 rounded-lg border border-[var(--border-subtle)] block truncate">
            {run.patron || '—'}
          </code>
        </div>
      )}

      {meta.showOptions && visibleOptions.length > 0 && (
        <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] p-4">
          <div className="eyebrow mb-2">{t('history.options')}</div>
          <div className="space-y-1.5">
            {visibleOptions.map(([key, value]) => (
              <div key={key} className="flex items-center gap-2 text-sm">
                <span className="text-[var(--text-muted)] font-mono text-[11px]">{key}:</span>
                <span className="text-[var(--text-primary)] font-mono text-[11px]">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <span className="eyebrow">{t(meta.fileListKey, { count: files.length })}</span>
        </div>
        <div className="p-2 max-h-64 overflow-y-auto">
          <div className="space-y-1">
            {files.map((filePath, index) => (
              <div key={index} className="text-xs text-[var(--text-secondary)] truncate px-3 py-2 rounded-lg bg-[var(--bg-elevated)] font-mono">
                {filePath.split(/[\\/]/).pop()}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
