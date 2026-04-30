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
  conversion: 'text-[#22C55E] border-[#22C55E]/20 bg-[#22C55E]/10',
  formato: 'text-[#5E6AD2] border-[#5E6AD2]/20 bg-[#5E6AD2]/10',
  padron: 'text-[#F59E0B] border-[#F59E0B]/20 bg-[#F59E0B]/10',
  volante: 'text-[#06B6D4] border-[#06B6D4]/20 bg-[#06B6D4]/10',
};

export default function RunList({ runs, selected, onSelect }: RunListProps) {
  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6">
        <div className="w-12 h-12 rounded-2xl bg-[#1A1A1A] flex items-center justify-center mb-3 border border-[#222222]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#666666]">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <p className="text-sm text-[#666666]">Aún no hay ejecuciones</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[#1A1A1A]/50">
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
                ? 'bg-[#111111] border-[#5E6AD2]'
                : 'bg-transparent border-transparent hover:bg-[#111111]'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-medium text-[13px] text-white">{new Date(run.timestamp).toLocaleString()}</span>
              <Badge variant={allErrors ? 'error' : hasErrors ? 'warning' : 'success'} className="text-[10px]">
                {run.ok_count}/{run.ok_count + run.err_count}
              </Badge>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-[#666666]">
              <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${RUN_TYPE_COLORS[type]}`}>
                {RUN_TYPE_LABELS[type]}
              </span>
              {type === 'conversion' && (
                <>
                  <span className="px-1.5 py-0.5 rounded bg-[#1A1A1A] border border-[#222222]">{run.formato}</span>
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
