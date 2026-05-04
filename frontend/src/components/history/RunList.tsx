import Badge from '../ui/Badge';

export type RunType = 'conversion' | 'formato' | 'padron' | 'volante';

export interface HistoryRun {
  id: number;
  run_type: RunType;
  timestamp: string;
  formato: string;
  calidad: number;
  ok_count: number;
  err_count: number;
  patron: string;
  files_json: string;
  options_json: string;
}

interface RunListProps {
  runs: HistoryRun[];
  selected: HistoryRun | null;
  onSelect: (run: HistoryRun) => void;
}

function safeJsonParse<T>(json: string, fallback: T): T {
  try { return JSON.parse(json) as T; } catch { return fallback; }
}

const RUN_TYPE_LABELS: Record<RunType, string> = {
  conversion: 'Conversión',
  formato: 'Formato',
  padron: 'Padrón',
  volante: 'Volante',
};

const RUN_TYPE_COLORS: Record<RunType, string> = {
  conversion: 'text-[var(--accent-green)] border-[color:var(--accent-green)]/20 bg-[color:var(--accent-green)]/10',
  formato: 'text-[var(--accent-primary)] border-[color:var(--accent-primary)]/20 bg-[color:var(--accent-primary)]/10',
  padron: 'text-[var(--accent-yellow)] border-[color:var(--accent-yellow)]/20 bg-[color:var(--accent-yellow)]/10',
  volante: 'text-[var(--accent-secondary)] border-[color:var(--accent-secondary)]/20 bg-[color:var(--accent-secondary)]/10',
};

export default function RunList({ runs, selected, onSelect }: RunListProps) {
  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="w-12 h-12 rounded-2xl bg-[var(--bg-elevated)] flex items-center justify-center mb-3 border border-[var(--border-subtle)]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-muted)]">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">Aún no hay ejecuciones</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--border-subtle)]">
      {runs.map((run) => {
        const fileCount = safeJsonParse<string[]>(run.files_json, []).length;
        const hasErrors = run.err_count > 0;
        const allErrors = run.ok_count === 0 && run.err_count > 0;
        const isSelected = selected?.id === run.id;
        const type = (run.run_type || 'conversion') as RunType;
        return (
          <button
            key={run.id}
            onClick={() => onSelect(run)}
            className={`w-full text-left px-5 py-4 text-sm transition-all border-l-2 ${
              isSelected
                ? 'bg-[var(--bg-surface)] border-[var(--accent-primary)]'
                : 'bg-transparent border-transparent hover:bg-[var(--bg-surface)]'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-medium text-[13px] text-[var(--text-primary)]">{new Date(run.timestamp).toLocaleString()}</span>
              <Badge variant={allErrors ? 'error' : hasErrors ? 'warning' : 'success'} className="text-[10px]">
                {run.ok_count}/{run.ok_count + run.err_count}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
              <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${RUN_TYPE_COLORS[type]}`}>
                {RUN_TYPE_LABELS[type]}
              </span>
              {type === 'conversion' && (
                <>
                  <span className="px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">{run.formato}</span>
                  <span>{fileCount} archivos</span>
                  <span>· {run.calidad}%</span>
                </>
              )}
              {type === 'formato' && (
                <>
                  <span>{run.formato}</span>
                  <span>· {fileCount} págs.</span>
                </>
              )}
              {type === 'padron' && (
                <>
                  <span>Padrón</span>
                  <span>· {fileCount} ítems</span>
                </>
              )}
              {type === 'volante' && (
                <>
                  <span>Volantes</span>
                  <span>· {fileCount} registros</span>
                </>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
