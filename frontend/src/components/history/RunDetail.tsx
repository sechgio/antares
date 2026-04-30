import Button from '../ui/Button';
import type { HistoryRun, RunType } from './RunList';

interface RunDetailProps {
  run: HistoryRun;
  onReexecute: () => void;
  onDelete: () => void;
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
  conversion: 'text-[#22C55E]',
  formato: 'text-[#5E6AD2]',
  padron: 'text-[#F59E0B]',
  volante: 'text-[#06B6D4]',
};

export default function RunDetail({ run, onReexecute, onDelete }: RunDetailProps) {
  const files = safeJsonParse<string[]>(run.files_json, []);
  const options = safeJsonParse<Record<string, unknown>>(run.options_json, {});
  const type = (run.run_type || 'conversion') as RunType;

  // Stats based on run type
  const stats = (() => {
    if (type === 'conversion') {
      return [
        { label: 'Formato', value: run.formato },
        { label: 'Calidad', value: `${run.calidad}%` },
        { label: 'Correctos', value: run.ok_count, color: 'text-[#22C55E]' },
        { label: 'Errores', value: run.err_count, color: run.err_count > 0 ? 'text-[#EF4444]' : 'text-[#A0A0A0]' },
      ];
    }
    if (type === 'formato') {
      const desde = (options.desde as number) ?? '?';
      const hasta = (options.hasta as number) ?? '?';
      return [
        { label: 'Formato PDF', value: run.formato },
        { label: 'Desde', value: String(desde) },
        { label: 'Hasta', value: String(hasta) },
        { label: 'Páginas', value: `${files.length}`, color: 'text-[#5E6AD2]' },
      ];
    }
    if (type === 'padron') {
      return [
        { label: 'Padrón', value: run.formato || 'Padrón' },
        { label: 'Ítems', value: `${files.length}`, color: 'text-[#F59E0B]' },
        { label: 'Correctos', value: run.ok_count, color: 'text-[#22C55E]' },
        { label: 'Errores', value: run.err_count, color: run.err_count > 0 ? 'text-[#EF4444]' : 'text-[#A0A0A0]' },
      ];
    }
    // volante
    return [
      { label: 'Volantes', value: run.formato || 'Volantes' },
      { label: 'Registros', value: `${files.length}`, color: 'text-[#06B6D4]' },
      { label: 'Correctos', value: run.ok_count, color: 'text-[#22C55E]' },
      { label: 'Errores', value: run.err_count, color: run.err_count > 0 ? 'text-[#EF4444]' : 'text-[#A0A0A0]' },
    ];
  })();

  return (
    <div className="p-8 space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="eyebrow">DETALLE</div>
            <span className={`text-[10px] font-semibold tracking-wider uppercase ${RUN_TYPE_COLORS[type]}`}>
              {RUN_TYPE_LABELS[type]}
            </span>
          </div>
          <h3 className="text-xl font-semibold text-white">Ejecución #{run.id}</h3>
        </div>
        <div className="flex gap-2">
          {type === 'conversion' && (
            <Button variant="primary" size="sm" onClick={onReexecute}>Re-ejecutar</Button>
          )}
          <Button variant="ghost" size="sm" className="text-[#EF4444] hover:text-[#EF4444]" onClick={onDelete}>Eliminar</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-[#111111] rounded-xl p-4 border border-[#1A1A1A]">
            <div className="eyebrow mb-2">{s.label}</div>
            <div className={`text-lg font-semibold ${s.color || 'text-white'}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {type === 'conversion' && (
        <div className="bg-[#111111] rounded-xl border border-[#1A1A1A] p-4">
          <div className="eyebrow mb-2">Patrón de renombrado</div>
          <code className="text-sm text-white font-mono bg-[#1A1A1A] px-3 py-2 rounded-lg border border-[#222222] block truncate">
            {run.patron || '—'}
          </code>
        </div>
      )}

      {(type === 'formato' || type === 'padron' || type === 'volante') && Object.keys(options).length > 0 && (
        <div className="bg-[#111111] rounded-xl border border-[#1A1A1A] p-4">
          <div className="eyebrow mb-2">Opciones</div>
          <div className="space-y-1.5">
            {Object.entries(options).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-sm">
                <span className="text-[#666666] font-mono text-[11px]">{k}:</span>
                <span className="text-white font-mono text-[11px]">{String(v)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-[#111111] rounded-xl border border-[#1A1A1A] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1A1A1A] flex items-center justify-between">
          <span className="eyebrow">
            {type === 'conversion' ? `Archivos (${files.length})` :
             type === 'formato' ? `Páginas (${files.length})` :
             type === 'padron' ? `Ítems (${files.length})` :
             `Registros (${files.length})`}
          </span>
        </div>
        <div className="p-2 max-h-64 overflow-y-auto">
          <div className="space-y-1">
            {files.map((f, i) => (
              <div key={i} className="text-xs text-[#A0A0A0] truncate px-3 py-2 rounded-lg bg-[#1A1A1A] font-mono">
                {f.split(/[\\/]/).pop()}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
