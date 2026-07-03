import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, onNotify } from '../../../api';
import type { ScanFolderSummary, ScanResults, ScanSummary } from '../types';
import DashboardCards from './DashboardCards';
import { SectionCard } from './shared';

interface ScanProgress {
  folder: string;
  current: number;
  total: number;
  index: number;
  folderTotal: number;
}

interface ScannerPanelProps {
  onSynced?: () => void;
}

export default function ScannerPanel({ onSynced }: ScannerPanelProps) {
  const [scanning, setScanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [results, setResults] = useState<ScanResults | null>(null);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    return onNotify((method, params) => {
      if (method === 'autoimg.scan.progress' && params && typeof params === 'object') {
        const p = params as Record<string, unknown>;
        setProgress((prev) => ({
          folder: String(p.folder || ''),
          current: Number(p.current) || 0,
          total: Number(p.total) || 0,
          index: prev?.index || 1,
          folderTotal: prev?.folderTotal || 1,
        }));
      }
      if (method === 'autoimg.scan.folder_start' && params && typeof params === 'object') {
        const p = params as Record<string, unknown>;
        setProgress({
          folder: String(p.folder || ''),
          current: 0,
          total: 0,
          index: Number(p.index) || 1,
          folderTotal: Number(p.total) || 1,
        });
      }
    });
  }, []);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setError('');
    setLastSyncResult('');
    setProgress(null);
    try {
      const res = await api.autoimgScanAll();
      setResults(res.results);
      setSummary(res.summary);
      if (res.folders_failed > 0) {
        setError(`${res.folders_failed} carpeta(s) fallaron; el resto se procesó correctamente.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al escanear');
    } finally {
      setScanning(false);
      setProgress(null);
    }
  }, []);

  const handleScanAndSync = useCallback(async () => {
    setSyncing(true);
    setError('');
    setLastSyncResult('');
    setProgress(null);
    try {
      const res = await api.autoimgScanAndSync();
      setResults(res.scan.results);
      setSummary(res.scan.summary);
      const detail = res.logs?.length ? res.logs[res.logs.length - 1] : `${res.updated} actualizados · ${res.new_rows} nuevos`;
      setLastSyncResult(detail);
      if (res.folder_errors > 0) {
        setError(`${res.folder_errors} carpeta(s) fallaron; los datos válidos se escribieron al Sheet.`);
      }
      onSynced?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al escanear y sincronizar');
    } finally {
      setSyncing(false);
      setProgress(null);
    }
  }, [onSynced]);

  const busy = scanning || syncing;
  const pct = progress && progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : busy ? 5 : 0;

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto">
      <SectionCard title="Escaneo">
        <button
          type="button"
          onClick={handleScanAndSync}
          disabled={busy}
          className="mb-2 w-full rounded-lg bg-[var(--text-primary)] py-3 text-[13px] font-medium text-[var(--bg-base)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {syncing ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Escaneando y sincronizando…
            </span>
          ) : (
            'Escanear y sincronizar'
          )}
        </button>
        <button
          type="button"
          onClick={handleScan}
          disabled={busy}
          className="w-full rounded-lg border border-[var(--border-medium)] py-3 text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-40"
        >
          {scanning ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Escaneando…
            </span>
          ) : (
            'Solo escanear (sin escribir)'
          )}
        </button>
        {busy && (
          <div className="mt-4">
            <div className="h-px overflow-hidden rounded-full bg-[var(--border-subtle)]">
              <div className="h-px bg-[var(--text-secondary)] transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            {progress && (
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                {progress.folder}
                {progress.total > 0 && ` · ${progress.current}/${progress.total}`}
              </p>
            )}
          </div>
        )}
        {lastSyncResult && (
          <p className="mt-3 text-[11px] text-[var(--text-muted)]">{lastSyncResult}</p>
        )}
        {error && <p className="mt-3 text-[11px] text-red-400">{error}</p>}
      </SectionCard>

      {summary && <DashboardCards {...summary} total={summary.total} />}

      {results && results.folder_summary.length > 0 && (
        <div className="rounded-xl border border-[var(--border-subtle)] divide-y divide-[var(--border-subtle)]">
          {results.folder_summary.map((f: ScanFolderSummary) => (
            <div key={`${f.name}-${f.folder_id || ''}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <span className="text-[13px] text-[var(--text-primary)]">{f.name}</span>
                {f.error && (
                  <p className="mt-0.5 truncate text-[10px] text-red-400">{f.error}</p>
                )}
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
                {f.error ? 'Error' : `${f.count} arch · ${f.nis_found} NIS`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}