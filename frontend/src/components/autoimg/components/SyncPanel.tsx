import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Loader2, RefreshCw, Timer } from 'lucide-react';
import { api, onNotify } from '../../../api';
import { SectionCard } from './shared';

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

  const busy = syncing !== null || togglingAuto;

  const autoSyncToggle = (
    <label className="flex cursor-pointer items-center gap-2">
      <span className="text-[11px] text-[var(--text-muted)]">Auto-sync</span>
      <button
        type="button"
        role="switch"
        aria-checked={autoSync}
        aria-label="Auto-sync periódico"
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
    <SectionCard title="Sincronización" action={autoSyncToggle}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleScanAndSync}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-[12px] font-medium text-[var(--text-on-accent)] transition-colors hover:bg-[var(--accent-primary-hover)] disabled:opacity-40"
          >
            {syncing === 'scan-sync' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} strokeWidth={2} />
            )}
            {syncing === 'scan-sync' ? 'Escaneando…' : 'Escanear y sincronizar'}
          </button>

          <button
            type="button"
            onClick={handleSyncTo}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-medium)] px-3 py-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-active)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            {syncing === 'to' ? <Loader2 size={13} className="animate-spin" /> : <ArrowUpFromLine size={13} />}
            {syncing === 'to' ? 'Escribiendo…' : 'Escribir al Sheet'}
          </button>

          <button
            type="button"
            onClick={handleSyncFrom}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-medium)] px-3 py-2 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-active)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            {syncing === 'from' ? <Loader2 size={13} className="animate-spin" /> : <ArrowDownToLine size={13} />}
            {syncing === 'from' ? 'Leyendo…' : 'Leer del Sheet'}
          </button>
        </div>

        {(lastSync || sheetName) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)] lg:justify-end">
            {sheetName && (
              <span className="max-w-[180px] truncate" title={sheetName}>
                {sheetName}
              </span>
            )}
            {lastSync && (
              <span className="inline-flex items-center gap-1.5">
                <Timer size={12} className="shrink-0 opacity-60" />
                {lastSync}
              </span>
            )}
          </div>
        )}
      </div>

      {(lastResult || error) && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-[11px] ${
            error
              ? 'border border-red-500/20 bg-red-500/5 text-red-400'
              : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)]'
          }`}
        >
          {error || lastResult}
        </div>
      )}
    </SectionCard>
  );
}
