import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../../api';
import { EmptyState } from './shared';

interface LogsViewerProps {
  rows?: string[][];
  onRefresh?: () => void | Promise<void>;
}

export default function LogsViewer({ rows: externalRows, onRefresh }: LogsViewerProps) {
  const [rows, setRows] = useState<string[][]>(externalRows ?? []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (externalRows) setRows(externalRows);
  }, [externalRows]);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      if (onRefresh && force) {
        await onRefresh();
      } else if (!externalRows) {
        const res = await api.autoimgLogsList(force);
        setRows(res.values || []);
      }
    } catch {
      if (!externalRows) setRows([]);
    } finally {
      setLoading(false);
    }
  }, [externalRows, onRefresh]);

  useEffect(() => {
    if (!externalRows) load(false);
  }, [externalRows, load]);

  const data = [...rows.slice(1)].reverse();

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">Historial</span>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-40"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : 'Actualizar'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {data.length > 0 ? (
          <div className="divide-y divide-[var(--border-subtle)]">
            {data.map((row, i) => (
              <div key={i} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12px] text-[var(--text-primary)]">{row[1]}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-muted)]">{row[0]}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{row[2]}</p>
              </div>
            ))}
          </div>
        ) : !loading ? (
          <EmptyState title="Sin registros" description="Las operaciones aparecerán aquí." />
        ) : null}
      </div>
    </div>
  );
}