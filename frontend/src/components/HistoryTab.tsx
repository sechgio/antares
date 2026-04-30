import { useEffect, useState, useMemo } from 'react';
import { api } from '../api';
import Button from './ui/Button';
import Badge from './ui/Badge';
import EmptyState from './ui/EmptyState';
import { useToast } from '../hooks/useToast';
import { useDialog } from '../hooks/useDialog';

interface HistoryRun {
  id: number;
  timestamp: string;
  formato: string;
  calidad: number;
  ok_count: number;
  err_count: number;
  patron: string;
  files_json: string;
  options_json: string;
}

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export default function HistoryTab() {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [runs, setRuns] = useState<HistoryRun[]>([]);
  const [selected, setSelected] = useState<HistoryRun | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterFormat, setFilterFormat] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'success' | 'warning' | 'error'>('all');

  const refresh = async () => {
    try {
      const r = await api.historyList({ limit: 50 });
      setRuns(r.runs as HistoryRun[]);
    } catch (err) {
      addToast({ message: 'Error cargando historial', type: 'error' });
    }
  };

  useEffect(() => { refresh(); }, []);

  const formats = useMemo(() => {
    const set = new Set(runs.map((r) => r.formato));
    return Array.from(set);
  }, [runs]);

  const filteredRuns = useMemo(() => {
    let result = runs;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((r) =>
        r.formato.toLowerCase().includes(q) ||
        r.patron.toLowerCase().includes(q) ||
        new Date(r.timestamp).toLocaleString().toLowerCase().includes(q)
      );
    }
    if (filterFormat !== 'all') {
      result = result.filter((r) => r.formato === filterFormat);
    }
    if (filterStatus !== 'all') {
      result = result.filter((r) => {
        if (filterStatus === 'success') return r.err_count === 0;
        if (filterStatus === 'warning') return r.err_count > 0 && r.err_count < r.ok_count;
        if (filterStatus === 'error') return r.ok_count === 0 && r.err_count > 0;
        return true;
      });
    }
    return result;
  }, [runs, searchQuery, filterFormat, filterStatus]);

  const reexecute = (run: HistoryRun) => {
    window.postMessage({ type: 'HISTORY_REEXECUTE', payload: run }, '*');
    addToast({ message: 'Configuración cargada en Conversión', type: 'success' });
  };

  const del = async (id: number) => {
    const ok = await confirm({ title: 'Eliminar ejecución', description: '¿Eliminar este registro del historial?', type: 'destructive', confirmLabel: 'Eliminar' });
    if (!ok) return;
    try {
      await api.historyDelete(id);
      await refresh();
      if (selected?.id === id) setSelected(null);
      addToast({ message: 'Ejecución eliminada', type: 'success' });
    } catch (err) {
      addToast({ message: 'Error eliminando historial', type: 'error' });
    }
  };

  const selectedFiles = selected ? safeJsonParse<string[]>(selected.files_json, []) : [];

  return (
    <div className="flex flex-col h-full w-full bg-dark-base">
      {/* Header with search and filters */}
      <div className="px-6 py-4 border-b border-bdr-subtle flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-txt-primary shrink-0">Historial</h2>
        <div className="flex items-center gap-3 flex-1 justify-end">
          <div className="relative">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-txt-muted">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar en historial..."
              className="w-56 pl-9 pr-3 py-2 bg-dark-input border border-bdr-medium rounded-btn text-sm text-txt-primary placeholder:text-txt-muted focus:border-accent focus:outline-none"
            />
          </div>
          <select
            value={filterFormat}
            onChange={(e) => setFilterFormat(e.target.value)}
            className="py-2 px-3 bg-dark-input border border-bdr-medium rounded-btn text-sm text-txt-primary appearance-none cursor-pointer focus:border-accent focus:outline-none"
          >
            <option value="all">Todos los formatos</option>
            {formats.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="py-2 px-3 bg-dark-input border border-bdr-medium rounded-btn text-sm text-txt-primary appearance-none cursor-pointer focus:border-accent focus:outline-none"
          >
            <option value="all">Todos los estados</option>
            <option value="success">Sin errores</option>
            <option value="warning">Con advertencias</option>
            <option value="error">Con errores</option>
          </select>
          <Button variant="ghost" onClick={refresh} className="shrink-0">Refrescar</Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left — run list */}
        <div className="w-[280px] shrink-0 border-r border-bdr-subtle overflow-y-auto">
          {runs.length === 0 ? (
            <EmptyState
              title="Sin ejecuciones"
              description="Las conversiones realizadas aparecerán aquí"
            />
          ) : filteredRuns.length === 0 ? (
            <EmptyState
              title="Sin coincidencias"
              description="Ajusta los filtros para ver más resultados"
              action={{ label: 'Limpiar filtros', onClick: () => { setSearchQuery(''); setFilterFormat('all'); setFilterStatus('all'); } }}
            />
          ) : (
            <div className="divide-y divide-bdr-subtle/50">
              {filteredRuns.map((run) => {
                const fileCount = safeJsonParse<string[]>(run.files_json, []).length;
                const hasErrors = run.err_count > 0;
                const allErrors = run.ok_count === 0 && run.err_count > 0;
                return (
                  <button
                    key={run.id}
                    onClick={() => setSelected(run)}
                    className={`w-full text-left px-4 py-3 text-sm transition-all border-l-[3px] ${
                      selected?.id === run.id
                        ? 'bg-dark-elevated border-accent text-txt-primary'
                        : 'bg-dark-surface border-transparent hover:bg-dark-elevated text-txt-secondary'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-medium truncate text-xs">{new Date(run.timestamp).toLocaleString()}</span>
                      <Badge variant={allErrors ? 'error' : hasErrors ? 'warning' : 'success'} className="ml-2 text-[10px]">
                        {run.ok_count}/{run.ok_count + run.err_count}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-txt-muted">
                      <span className="px-1.5 py-0.5 rounded bg-dark-input border border-bdr-subtle">{run.formato}</span>
                      <span>{fileCount} archivos</span>
                      <span>· {run.calidad}%</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right — detail panel */}
        <div className="flex-1 overflow-y-auto p-6">
          {selected ? (
            <div className="space-y-6 max-w-3xl animate-fade-in">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wider text-txt-muted mb-1">Detalle</div>
                  <h3 className="text-xl font-semibold text-txt-primary">Ejecución #{selected.id}</h3>
                </div>
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => reexecute(selected)}>Re-ejecutar</Button>
                  <Button variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => del(selected.id)}>Eliminar</Button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-dark-surface rounded-lg p-4 border border-bdr-subtle">
                  <div className="text-[11px] uppercase tracking-wider text-txt-muted mb-2">Formato</div>
                  <div className="font-semibold text-txt-primary">{selected.formato}</div>
                </div>
                <div className="bg-dark-surface rounded-lg p-4 border border-bdr-subtle">
                  <div className="text-[11px] uppercase tracking-wider text-txt-muted mb-2">Calidad</div>
                  <div className="font-semibold text-txt-primary">{selected.calidad}%</div>
                </div>
                <div className="bg-dark-surface rounded-lg p-4 border border-bdr-subtle">
                  <div className="text-[11px] uppercase tracking-wider text-txt-muted mb-2">Correctos</div>
                  <div className="font-semibold text-accent-green">{selected.ok_count}</div>
                </div>
                <div className="bg-dark-surface rounded-lg p-4 border border-bdr-subtle">
                  <div className="text-[11px] uppercase tracking-wider text-txt-muted mb-2">Errores</div>
                  <div className={`font-semibold ${selected.err_count > 0 ? 'text-accent-red' : 'text-txt-secondary'}`}>{selected.err_count}</div>
                </div>
              </div>

              <div className="bg-dark-surface rounded-lg border border-bdr-subtle p-4">
                <div className="text-[11px] uppercase tracking-wider text-txt-muted mb-2">Patrón de renombrado</div>
                <code className="text-sm text-txt-primary font-mono bg-dark-elevated px-3 py-2 rounded border border-bdr-subtle block truncate">{selected.patron || '—'}</code>
              </div>

              <div className="bg-dark-surface rounded-lg border border-bdr-subtle overflow-hidden">
                <div className="px-4 py-3 border-b border-bdr-subtle flex items-center justify-between">
                  <div className="text-xs uppercase tracking-wider text-txt-muted">Archivos ({selectedFiles.length})</div>
                </div>
                <div className="p-2 max-h-64 overflow-y-auto">
                  <div className="space-y-1">
                    {selectedFiles.map((f: string, i: number) => (
                      <div key={i} className="text-sm text-txt-secondary truncate px-3 py-2 rounded bg-dark-elevated font-mono text-xs">
                        {f.split(/[\\/]/).pop()}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-txt-muted">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              }
              title="Sin selección"
              description="Selecciona una ejecución para ver sus detalles"
            />
          )}
        </div>
      </div>
    </div>
  );
}
