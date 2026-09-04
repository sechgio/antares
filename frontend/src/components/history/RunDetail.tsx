import { useTranslation } from 'react-i18next';
import { RotateCw, Trash2 } from 'lucide-react';
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
  const date = new Date(run.timestamp);
  const total = run.ok_count + run.err_count;
  const successRate = total > 0 ? Math.round((run.ok_count / total) * 100) : 100;

  return (
    <div className="p-6 sm:p-8 space-y-6 animate-fade-in max-w-[860px] mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="eyebrow">{t('history.detail')}</div>
            <span className={`text-[10px] font-semibold tracking-wider uppercase ${meta.colorClass}`}>
              {t(meta.labelKey)}
            </span>
          </div>
          <h3 className="text-[20px] font-semibold leading-tight text-[var(--text-primary)]">
            {t('history.execution', { id: run.id })}
          </h3>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            {date.toLocaleString()}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {meta.reexecute && (
            <button
              type="button"
              onClick={onReexecute}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-primary)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-on-accent)] transition-all hover:bg-[var(--accent-primary-hover)] active:scale-[0.98]"
            >
              <RotateCw size={12} strokeWidth={2} />
              {t('history.reexecute')}
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--accent-red)]/30 bg-transparent px-3 py-1.5 text-[11px] font-medium text-[var(--accent-red)] transition-all hover:bg-[color:var(--accent-red)]/10 active:scale-[0.98]"
          >
            <Trash2 size={12} strokeWidth={2} />
            {t('history.delete')}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Tasa de éxito</span>
          <span className={`text-[13px] font-bold ${successRate === 100 ? 'text-[var(--accent-green)]' : successRate >= 50 ? 'text-[var(--accent-yellow)]' : 'text-[var(--accent-red)]'}`}>
            {successRate}%
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <div
            className={`h-full rounded-full transition-all ${successRate === 100 ? 'bg-[var(--accent-green)]' : successRate >= 50 ? 'bg-[var(--accent-yellow)]' : 'bg-[var(--accent-red)]'}`}
            style={{ width: `${successRate}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
          <span><span className="font-semibold text-[var(--accent-green)]">{run.ok_count}</span> correctos</span>
          <span><span className="font-semibold text-[var(--accent-red)]">{run.err_count}</span> errores</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 transition-colors hover:border-[var(--border-medium)]">
            <div className="eyebrow mb-1.5">{stat.label}</div>
            <div className={`text-[16px] font-semibold leading-tight ${stat.color || 'text-[var(--text-primary)]'}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {meta.showPatron && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="eyebrow mb-2">{t('history.pattern')}</div>
          <code className="block truncate rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-[13px] text-[var(--text-primary)]">
            {run.patron || '—'}
          </code>
        </div>
      )}

      {meta.showOptions && visibleOptions.length > 0 && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="eyebrow mb-3">{t('history.options')}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {visibleOptions.map(([key, value]) => (
              <div key={key} className="flex items-center gap-2 rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-[12px]">
                <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">{key}</span>
                <span className="truncate font-mono text-[11px] text-[var(--text-primary)]">{String(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <span className="eyebrow">{t(meta.fileListKey, { count: files.length })}</span>
          <span className="text-[11px] font-medium text-[var(--text-muted)]">{files.length}</span>
        </div>
        <div className="max-h-72 overflow-y-auto p-2 custom-scrollbar">
          <div className="space-y-1">
            {files.map((filePath, index) => (
              <div key={index} className="truncate rounded-lg bg-[var(--bg-elevated)] px-3 py-2 font-mono text-[12px] text-[var(--text-secondary)]">
                {filePath.split(/[\\/]/).pop()}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
