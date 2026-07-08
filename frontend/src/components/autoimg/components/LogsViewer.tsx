import { useCallback, useEffect, useState } from 'react';
import { Loader2, ScrollText } from 'lucide-react';
import { api } from '../../../api';
import { ActionButton, EmptyState, PanelHeader, PanelShell } from './shared';

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
    <PanelShell>
      <PanelHeader
        icon={ScrollText}
        title="Historial de operaciones"
        meta={
          data.length > 0 ? (
            <span className="rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
              {data.length}
            </span>
          ) : undefined
        }
        action={
          <ActionButton
            variant="ghost"
            onClick={() => load(true)}
            disabled={loading}
            className="px-2 py-1 text-[11px]"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : 'Actualizar'}
          </ActionButton>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {data.length > 0 ? (
          <div className="divide-y divide-[var(--border-subtle)]">
            {data.map((row, i) => (
              <div key={i} className="px-4 py-3 transition-colors hover:bg-[var(--bg-elevated)]/30">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12px] font-medium text-[var(--text-primary)]">
                    {row[1]}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
                    {row[0]}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{row[2]}</p>
              </div>
            ))}
          </div>
        ) : !loading ? (
          <EmptyState
            icon={ScrollText}
            title="Sin registros"
            description="Los escaneos y sincronizaciones aparecerán aquí."
          />
        ) : null}
      </div>
    </PanelShell>
  );
}
