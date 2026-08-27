import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Loader2, RefreshCw, Square } from 'lucide-react';
import { api, onNotify } from '../../../api';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';

type SyncAction = 'scan-sync' | 'to' | 'from' | null;

interface SyncActionsProps {
  onSynced?: () => void;
  onStatus?: (status: { error?: string; result?: string }) => void;
}

export default function SyncActions({ onSynced, onStatus }: SyncActionsProps) {
  const [syncing, setSyncing] = useState<SyncAction>(null);

  useEffect(() => {
    return onNotify((method, params) => {
      if (method === 'autoimg.operation.cancelled') {
        setSyncing(null);
        const partial = params && typeof params === 'object'
          ? (params as { partial?: { copied?: number; ranges_written?: number } }).partial
          : null;
        const extra = partial?.copied != null
          ? ` (${partial.copied} copia(s) ya hechas)`
          : partial?.ranges_written != null
            ? ` (${partial.ranges_written} rango(s) escritos)`
            : '';
        onStatus?.({ error: `Operación cancelada${extra}` });
      }
    });
  }, [onStatus]);

  const handleScanAndSync = useCallback(async () => {
    setSyncing('scan-sync');
    onStatus?.({});
    try {
      const res = await api.autoimgScanAndSync();
      const detail = res.logs?.length
        ? res.logs[res.logs.length - 1]
        : [
            `${res.updated} filas cambiadas`,
            res.unmatched_scan ? `${res.unmatched_scan} fuera del padrón` : null,
          ].filter(Boolean).join(' · ');
      onStatus?.({ result: detail });
      onSynced?.();
    } catch (e) {
      onStatus?.({ error: e instanceof Error ? e.message : 'Error al escanear y sincronizar' });
    } finally {
      setSyncing(null);
    }
  }, [onSynced, onStatus]);

  const handleSyncTo = useCallback(async () => {
    setSyncing('to');
    onStatus?.({});
    try {
      const res = await api.autoimgSyncToSheet();
      const detail = res.logs?.length
        ? res.logs[res.logs.length - 1]
        : [
            `${res.updated} filas cambiadas`,
            res.unmatched_scan ? `${res.unmatched_scan} fuera del padrón` : null,
          ].filter(Boolean).join(' · ');
      onStatus?.({ result: detail });
      onSynced?.();
    } catch (e) {
      onStatus?.({ error: e instanceof Error ? e.message : 'Error al sincronizar al Sheet' });
    } finally {
      setSyncing(null);
    }
  }, [onSynced, onStatus]);

  const handleSyncFrom = useCallback(async () => {
    setSyncing('from');
    onStatus?.({});
    try {
      await api.autoimgSyncFromSheet();
      onStatus?.({ result: 'Datos cargados desde el Sheet' });
    } catch (e) {
      onStatus?.({ error: e instanceof Error ? e.message : 'Error al leer el Sheet' });
    } finally {
      setSyncing(null);
    }
  }, [onStatus]);

  const handleCancel = useCallback(async () => {
    try {
      const res = await api.autoimgCancelOperation();
      if (!res.success) onStatus?.({ error: 'No hay operación activa para cancelar' });
    } catch (e) {
      onStatus?.({ error: e instanceof Error ? e.message : 'No se pudo cancelar' });
    }
  }, [onStatus]);

  const busy = syncing !== null;
  const canCancel = syncing === 'scan-sync' || syncing === 'to';

  const btn =
    'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]';

  return (
    <div className="flex shrink-0 items-center gap-1 px-3" role="toolbar" aria-label="Operaciones de sincronización">
      <WithHoverTooltip label="Escanear Drive y escribir al Sheet" placement="bottom">
        <button
          type="button"
          onClick={handleScanAndSync}
          disabled={busy}
          className={`${btn} bg-[var(--accent-primary)] font-medium text-[var(--text-on-accent)] hover:bg-[var(--accent-primary-hover)]`}
        >
          {syncing === 'scan-sync' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} strokeWidth={2} />
          )}
          <span className="hidden xl:inline">
            {syncing === 'scan-sync' ? 'Escaneando…' : 'Escanear'}
          </span>
          <span className="xl:hidden">{syncing === 'scan-sync' ? '…' : 'Escanear'}</span>
        </button>
      </WithHoverTooltip>

      <WithHoverTooltip label="Escribir al Sheet" placement="bottom">
        <button
          type="button"
          onClick={handleSyncTo}
          disabled={busy}
          className={`${btn} text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]`}
        >
          {syncing === 'to' ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpFromLine size={12} />}
          {syncing === 'to' ? '…' : 'Escribir'}
        </button>
      </WithHoverTooltip>

      <WithHoverTooltip label="Leer del Sheet" placement="bottom">
        <button
          type="button"
          onClick={handleSyncFrom}
          disabled={busy}
          className={`${btn} text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]`}
        >
          {syncing === 'from' ? <Loader2 size={12} className="animate-spin" /> : <ArrowDownToLine size={12} />}
          {syncing === 'from' ? '…' : 'Leer'}
        </button>
      </WithHoverTooltip>

      {canCancel && (
        <WithHoverTooltip label="Cancelar operación" placement="bottom">
          <button
            type="button"
            onClick={handleCancel}
            className={`${btn} text-[var(--accent-red)] hover:bg-[color-mix(in_srgb,var(--accent-red)_10%,transparent)]`}
          >
            <Square size={11} />
            Cancelar
          </button>
        </WithHoverTooltip>
      )}
    </div>
  );
}
