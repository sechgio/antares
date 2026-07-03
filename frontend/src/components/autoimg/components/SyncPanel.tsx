import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, onNotify } from '../../../api';
import { SectionCard } from './shared';

interface SyncPanelProps {
  autoSync: boolean;
  onAutoSyncChange: (enabled: boolean) => void;
  onSynced: () => void;
}

type SyncAction = 'scan-sync' | 'to' | 'from' | null;

function formatSyncResult(updated: number, newRows: number, folderErrors: number, logs?: string[]) {
  if (logs?.length) return logs[logs.length - 1];
  const base = `${updated} actualizados · ${newRows} nuevos`;
  return folderErrors > 0 ? `${base} · ${folderErrors} carpeta(s) con error` : base;
}

export default function SyncPanel({ autoSync, onAutoSyncChange, onSynced }: SyncPanelProps) {
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

  return (
    <SectionCard title="Sincronización">
      <button
        type="button"
        onClick={handleScanAndSync}
        disabled={busy}
        className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--text-primary)] px-4 py-2.5 text-[12px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {syncing === 'scan-sync' ? <Loader2 size={14} className="animate-spin" /> : null}
        {syncing === 'scan-sync' ? 'Escaneando y escribiendo…' : 'Escanear y sincronizar'}
      </button>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSyncTo}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-40"
        >
          {syncing === 'to' ? <Loader2 size={14} className="animate-spin" /> : null}
          {syncing === 'to' ? 'Escribiendo…' : 'Solo escribir al Sheet'}
        </button>
        <button
          type="button"
          onClick={handleSyncFrom}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[var(--border-medium)] px-4 py-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-40"
        >
          {syncing === 'from' ? <Loader2 size={14} className="animate-spin" /> : null}
          {syncing === 'from' ? 'Leyendo…' : 'Leer del Sheet'}
        </button>
      </div>

      <label className="mt-4 flex cursor-pointer items-center justify-between gap-3">
        <span className="text-[12px] text-[var(--text-secondary)]">Auto-sync periódico</span>
        <button
          type="button"
          role="switch"
          aria-checked={autoSync}
          disabled={busy}
          onClick={handleAutoSyncToggle}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
            autoSync ? 'bg-emerald-500/80' : 'bg-[var(--border-medium)]'
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
              autoSync ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </label>

      {lastResult && (
        <p className="mt-3 text-[11px] text-[var(--text-muted)]">{lastResult}</p>
      )}
      {error && <p className="mt-3 text-[11px] text-red-400">{error}</p>}
    </SectionCard>
  );
}