import { useEffect, useState, useMemo } from 'react';
import { api } from '../../api';
import { useToast } from '../../hooks/useToast';
import { useDialog } from '../../hooks/useDialog';
import RunList, { HistoryRun, RunType } from './RunList';
import RunDetail from './RunDetail';

const TYPE_FILTERS: { label: string; value: RunType | 'all' }[] = [
  { label: 'Todos', value: 'all' },
  { label: 'Conversión', value: 'conversion' },
  { label: 'Formatos', value: 'formato' },
  { label: 'Padrón', value: 'padron' },
  { label: 'Volante', value: 'volante' },
];

export default function HistoryView() {
  const { addToast } = useToast();
  const { confirm } = useDialog();
  const [runs, setRuns] = useState<HistoryRun[]>([]);
  const [selected, setSelected] = useState<HistoryRun | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeType, setActiveType] = useState<RunType | 'all'>('all');

  const refresh = async () => {
    try {
      const params: { limit: number; run_type?: string } = { limit: 50 };
      if (activeType !== 'all') params.run_type = activeType;
      const r = await api.historyList(params);
      setRuns(r.runs as HistoryRun[]);
    } catch {
      addToast({ message: 'Error cargando historial', type: 'error' });
    }
  };

  useEffect(() => { refresh(); }, [activeType]);

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
    } catch {
      addToast({ message: 'Error eliminando historial', type: 'error' });
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="px-6 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Historial</h2>
          <div className="flex items-center gap-1 bg-[var(--bg-surface)] rounded-full p-1 border border-[var(--border-subtle)]">
            {TYPE_FILTERS.map((t) => (
              <button
                key={t.value}
                onClick={() => setActiveType(t.value)}
                className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all ${
                  activeType === t.value
                    ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar en historial..."
            className="w-56 pl-9 pr-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-full text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:outline-none focus:shadow-[0_0_0_3px_var(--accent-primary-glow)]"
          />
        </div>
      </div>
      <div className="flex flex-1 min-h-0">
        <div className="w-[280px] shrink-0 border-r border-[var(--border-subtle)] overflow-y-auto">
          <RunList runs={filteredRuns} selected={selected} onSelect={setSelected} />
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
              <p className="text-sm text-[var(--text-secondary)]">Selecciona una ejecución para ver sus detalles</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
