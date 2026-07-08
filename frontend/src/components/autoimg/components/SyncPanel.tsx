import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Loader2, RefreshCw, Square, Timer } from 'lucide-react';
import { api, onNotify } from '../../../api';
import { ActionButton, SectionCard } from './shared';

interface SyncPanelProps {
  autoSync: boolean;
  onAutoSyncChange: (enabled: boolean) => void;
  onSynced: () => void;
  lastSync?: string;
  sheetName?: string;
}

type SyncAction = 'scan-sync' | 'to' | 'from' | null;

function formatSyncResult(updated: number, newRows: number, folderErrors: number, logs?: string[]) {
  if (logs?.length) return logs[logs.length - 1];
  const base = `${updated} actualizados · ${newRows} nuevos`;
  return folderErrors > 0 ? `${base} · ${folderErrors} carpeta(s) con error` : base;
}

export default function SyncPanel({
  autoSync,
  onAutoSyncChange,
  onSynced,
  lastSync,
  sheetName,
}: SyncPanelProps) {
  const [syncing, setSyncing] = useState<SyncAction>(null);
  const [togglingAuto, setTogglingAuto] = useState(false);
  const [lastResult, setLastResult] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    return onNotify((method, params) => {
      if (method === 'autoimg.operation.cancelled') {
        setSyncing(null);
        setError('Operación cancelada');
      }
      if (method !== 'autoimg.sync.complete' || !params || typeof params !== 'object') return;
      const p = params as Record<string, unknown>;
      const updated = Number(p.updated) || 0;
      const newRows = Number(p.new) || 0;
      const folderErrors = Number(p.errors) || 0;
      const durationMs = Number(p.duration_ms) || 0;
      const durationSec = durationMs > 0 ? (durationMs / 1000).toFixed(1) : '—';
      const base = formatSyncResult(updated, newRows, folderErrors);
      setLastResult(`${base} · ${durationSec}s`);
    });
  }, []);

  const handleScanAndSync = useCallback(async () => {
    setSyncing('scan-sync');
    setError('');
    setLastResult('');
    try {
      const res = await api.autoimgScanAndSync();
      setLastResult(formatSyncResult(res.updated, res.new_rows, res.folder_errors, res.logs));
      onSynced();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al escanear y sincronizar');
    } finally {
      setSyncing(null);
    }
  }, [onSynced]);

  const handleSyncTo = useCallback(async () => {
    setSyncing('to');
    setError('');
    setLastResult('');
    try {
      const res = await api.autoimgSyncToSheet();
      setLastResult(formatSyncResult(res.updated, res.new_rows, 0, res.logs));
      onSynced();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al sincronizar al Sheet');
    } finally {
      setSyncing(null);
    }
  }, [onSynced]);

  const handleSyncFrom = useCallback(async () => {
    setSyncing('from');
    setError('');
    try {
      await api.autoimgSyncFromSheet();
      setLastResult('Datos cargados desde el Sheet');
      onSynced();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al leer el Sheet');
    } finally {
      setSyncing(null);
    }
  }, [onSynced]);

  const handleAutoSyncToggle = useCallback(async () => {
    const next = !autoSync;
    setTogglingAuto(true);
    setError('');
    try {
      const res = await api.autoimgAutoSyncToggle(next);
      onAutoSyncChange(res.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cambiar auto-sync');
    } finally {
      setTogglingAuto(false);
    }
  }, [autoSync, onAutoSyncChange]);

  const handleCancel = useCallback(async () => {
    try {
      const res = await api.autoimgCancelOperation();
      if (!res.success) setError('No hay operación activa para cancelar');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cancelar');
    }
  }, []);

  const busy = syncing !== null || togglingAuto;
  const canCancel = syncing === 'scan-sync' || syncing === 'to';

  const autoSyncToggle = (
    <label
      className="flex cursor-pointer items-center gap-2"
      title="Lee el Sheet cada 5 min (no re-escanea Drive)"
    >
      <span className="text-[11px] text-[var(--text-muted)]">Auto-leer Sheet</span>
      <button
        type="button"
        role="switch"
        aria-checked={autoSync}
        aria-label="Actualizar desde Sheet cada 5 minutos"
        disabled={busy}
        onClick={handleAutoSyncToggle}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
          autoSync ? 'bg-[var(--accent-green)]' : 'bg-[var(--border-medium)]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            autoSync ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );

  return (
    <SectionCard
      title="Operaciones"
      subtitle="Escanea Drive para detectar fotos nuevas. Escribe o lee el Sheet sin re-escanear."
      action={autoSyncToggle}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <ActionButton
            variant="primary"
            onClick={handleScanAndSync}
            disabled={busy}
            className="w-full justify-center px-4 py-2.5 sm:w-auto sm:justify-start"
          >
            {syncing === 'scan-sync' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} strokeWidth={2} />
            )}
            {syncing === 'scan-sync' ? 'Escaneando y escribiendo…' : 'Escanear y sincronizar'}
          </ActionButton>

          <div className="flex flex-wrap items-center gap-2">
            <ActionButton variant="secondary" onClick={handleSyncTo} disabled={busy}>
              {syncing === 'to' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <ArrowUpFromLine size={13} />
              )}
              {syncing === 'to' ? 'Escribiendo…' : 'Escribir al Sheet'}
            </ActionButton>

            <ActionButton variant="secondary" onClick={handleSyncFrom} disabled={busy}>
              {syncing === 'from' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <ArrowDownToLine size={13} />
              )}
              {syncing === 'from' ? 'Leyendo…' : 'Leer del Sheet'}
            </ActionButton>

            {canCancel && (
              <ActionButton variant="danger" onClick={handleCancel}>
                <Square size={12} />
                Cancelar
              </ActionButton>
            )}
          </div>
        </div>

        {(lastSync || sheetName) && (
          <div className="flex shrink-0 flex-col gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 py-2.5 text-[11px] text-[var(--text-muted)] lg:min-w-[200px]">
            {sheetName && (
              <div>
                <p className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">Sheet</p>
                <p className="mt-0.5 max-w-[220px] truncate text-[var(--text-secondary)]" title={sheetName}>
                  {sheetName}
                </p>
              </div>
            )}
            {lastSync && (
              <div className="inline-flex items-center gap-1.5">
                <Timer size={12} className="shrink-0 opacity-60" />
                <span>Último sync: {lastSync}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {(lastResult || error) && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-[11px] ${
            error
              ? 'border border-[color-mix(in_srgb,var(--accent-red)_25%,transparent)] bg-[color-mix(in_srgb,var(--accent-red)_8%,transparent)] text-[var(--accent-red)]'
              : 'border border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-muted)]'
          }`}
        >
          {error || lastResult}
        </div>
      )}
    </SectionCard>
  );
}
