import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../../api';
import type { ArrastreEntry } from '../types';
import { EmptyState } from './shared';

export default function ArrastreViewer() {
  const [entries, setEntries] = useState<ArrastreEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.autoimgArrastreList();
      setEntries(res.entries);
    } catch (e) {
      setEntries([]);
      setError(e instanceof Error ? e.message : 'Error al cargar BD_ARRASTRE');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">BD_ARRASTRE</span>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-40"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : 'Actualizar'}
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {entries.length > 0 ? (
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="sticky top-0 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]">
              <tr>
                {['NIS', 'SGIO', 'Motivo', 'Fecha', 'Observación'].map((col) => (
                  <th key={col} className="px-4 py-2.5 text-[10px] font-normal uppercase tracking-wider text-[var(--text-muted)]">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={`${entry.nis}-${entry.fecha}`} className="border-b border-[var(--border-subtle)]/50 hover:bg-[var(--bg-elevated)]/30">
                  <td className="px-4 py-2.5 font-mono text-[12px]">{entry.nis}</td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)]">{entry.sgio || '—'}</td>
                  <td className="px-4 py-2.5">{entry.motivo || '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-[var(--text-muted)]">{entry.fecha || '—'}</td>
                  <td className="max-w-[200px] truncate px-4 py-2.5 text-[var(--text-muted)]">{entry.observacion || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : !loading ? (
          <EmptyState
            title="Sin casos de arrastre"
            description={error || 'Los registros manuales de BD_ARRASTRE aparecerán aquí.'}
          />
        ) : null}
      </div>
    </div>
  );
}