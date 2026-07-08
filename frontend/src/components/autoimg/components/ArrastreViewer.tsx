import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Loader2 } from 'lucide-react';
import { api } from '../../../api';
import type { ArrastreEntry } from '../types';
import { ActionButton, EmptyState, PanelHeader, PanelShell } from './shared';

interface ArrastreViewerProps {
  entries?: ArrastreEntry[];
  onRefresh?: () => void | Promise<void>;
}

export default function ArrastreViewer({ entries: externalEntries, onRefresh }: ArrastreViewerProps) {
  const [entries, setEntries] = useState<ArrastreEntry[]>(externalEntries ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (externalEntries) setEntries(externalEntries);
  }, [externalEntries]);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    try {
      if (onRefresh && force) {
        await onRefresh();
      } else if (!externalEntries) {
        const res = await api.autoimgArrastreList(force);
        setEntries(res.entries);
      }
    } catch (e) {
      if (!externalEntries) setEntries([]);
      setError(e instanceof Error ? e.message : 'Error al cargar BD_ARRASTRE');
    } finally {
      setLoading(false);
    }
  }, [externalEntries, onRefresh]);

  useEffect(() => {
    if (!externalEntries) load(false);
  }, [externalEntries, load]);

  return (
    <PanelShell>
      <PanelHeader
        icon={ClipboardList}
        title="Casos de arrastre"
        meta={
          entries.length > 0 ? (
            <span className="rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
              {entries.length}
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

      <div className="flex-1 overflow-auto">
        {entries.length > 0 ? (
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="sticky top-0 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/95 backdrop-blur-sm">
              <tr>
                {['NIS', 'SGIO', 'Motivo', 'Fecha', 'Observación'].map((col) => (
                  <th
                    key={col}
                    className="px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={`${entry.nis}-${entry.fecha}`}
                  className="border-b border-[var(--border-subtle)]/50 transition-colors hover:bg-[var(--bg-elevated)]/40"
                >
                  <td className="px-4 py-2.5 font-mono text-[12px] text-[var(--text-primary)]">
                    {entry.nis}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-muted)]">{entry.sgio || '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{entry.motivo || '—'}</td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-[var(--text-muted)]">
                    {entry.fecha || '—'}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-2.5 text-[var(--text-muted)]">
                    {entry.observacion || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : !loading ? (
          <EmptyState
            icon={ClipboardList}
            title="Sin casos de arrastre"
            description={error || 'Los registros manuales de BD_ARRASTRE aparecerán aquí.'}
          />
        ) : null}
      </div>
    </PanelShell>
  );
}
