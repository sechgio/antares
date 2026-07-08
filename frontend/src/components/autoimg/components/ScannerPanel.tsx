import { useCallback, useEffect, useState } from 'react';
import { Loader2, Radar, Square } from 'lucide-react';
import { api, onNotify } from '../../../api';
import type { ScanFolderSummary, ScanResults, ScanSummary } from '../types';
import DashboardCards from './DashboardCards';
import { ActionButton, SectionCard } from './shared';

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
      if (method === 'autoimg.operation.cancelled') {
        setScanning(false);
        setSyncing(false);
        setProgress(null);
        setError('Operación cancelada');
      }
    });
  }, []);

  const handleCancel = useCallback(async () => {
    try {
      const res = await api.autoimgCancelOperation();
      if (!res.success) {
        setError('No hay operación activa para cancelar');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cancelar');
    }
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
      const detail = res.logs?.length
        ? res.logs[res.logs.length - 1]
        : `${res.updated} actualizados · ${res.new_rows} nuevos`;
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
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : busy
        ? 5
        : 0;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <SectionCard
        title="Escaneo de carpetas"
        subtitle="Recorre las carpetas activas de Drive y clasifica cada NIS por cantidad de imágenes."
      >
        <div className="space-y-2">
          <ActionButton
            variant="solid"
            onClick={handleScanAndSync}
            disabled={busy}
            className="w-full py-3 text-[13px]"
          >
            {syncing ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Escaneando y sincronizando…
              </>
            ) : (
              <>
                <Radar size={14} />
                Escanear y sincronizar
              </>
            )}
          </ActionButton>
          <ActionButton
            variant="secondary"
            onClick={handleScan}
            disabled={busy}
            className="w-full py-3 text-[13px]"
          >
            {scanning ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Escaneando…
              </>
            ) : (
              'Solo escanear (sin escribir al Sheet)'
            )}
          </ActionButton>
        </div>

        {busy && (
          <div className="mt-4 space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
              <div
                className="h-full rounded-full bg-[var(--accent-primary)] transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              {progress ? (
                <p className="min-w-0 truncate text-[11px] text-[var(--text-muted)]">
                  <span className="text-[var(--text-secondary)]">{progress.folder}</span>
                  {progress.folderTotal > 1 && ` · carpeta ${progress.index}/${progress.folderTotal}`}
                  {progress.total > 0 && ` · ${progress.current}/${progress.total}`}
                </p>
              ) : (
                <p className="text-[11px] text-[var(--text-muted)]">Procesando…</p>
              )}
              <ActionButton variant="danger" onClick={handleCancel} className="px-2 py-1 text-[10px]">
                <Square size={10} />
                Cancelar
              </ActionButton>
            </div>
          </div>
        )}

        {lastSyncResult && (
          <p className="mt-3 text-[11px] text-[var(--text-muted)]">{lastSyncResult}</p>
        )}
        {error && <p className="mt-3 text-[11px] text-[var(--accent-red)]">{error}</p>}
      </SectionCard>

      {summary && (
        <DashboardCards
          total={summary.total}
          completos={summary.completos}
          faltantes={summary.faltantes}
          sobrantes={summary.sobrantes}
          sinSgio={summary.sin_sgio}
        />
      )}

      {results && results.folder_summary.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3">
            <p className="text-[12px] font-medium text-[var(--text-primary)]">Resultado por carpeta</p>
            <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
              Archivos encontrados y NIS únicos detectados
            </p>
          </div>
          <div className="divide-y divide-[var(--border-subtle)]">
            {results.folder_summary.map((f: ScanFolderSummary) => (
              <div
                key={`${f.name}-${f.folder_id || ''}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <span className="text-[13px] text-[var(--text-primary)]">{f.name}</span>
                  {f.error && (
                    <p className="mt-0.5 truncate text-[10px] text-[var(--accent-red)]">{f.error}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 font-mono text-[11px] tabular-nums ${
                    f.error ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'
                  }`}
                >
                  {f.error ? 'Error' : `${f.count} arch · ${f.nis_found} NIS`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
