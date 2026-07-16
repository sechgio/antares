import { useCallback, useEffect, useState } from 'react';
import { api, onNotify } from '../../../api';
import { CoverageRail } from './shared';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';

interface SyncPanelProps {
  autoSync: boolean;
  onAutoSyncChange: (enabled: boolean) => void;
  lastSync?: string;
  sheetName?: string;
  total?: number;
  completos?: number;
  faltantes?: number;
  sobrantes?: number;
  sinSgio?: number;
  /** Mensaje de estado de las acciones del toolbar superior */
  statusMessage?: { error?: string; result?: string };
}

const fmt = (n: number) => n.toLocaleString('es-MX');

export default function SyncPanel({
  autoSync,
  onAutoSyncChange,
  lastSync,
  sheetName,
  total = 0,
  completos = 0,
  faltantes = 0,
  sobrantes = 0,
  sinSgio = 0,
  statusMessage,
}: SyncPanelProps) {
  const [togglingAuto, setTogglingAuto] = useState(false);
  const [error, setError] = useState('');
  const [notifyResult, setNotifyResult] = useState('');

  const completionPct = total > 0 ? Math.round((completos / total) * 100) : 0;

  useEffect(() => {
    return onNotify((method, params) => {
      if (method !== 'autoimg.sync.complete' || !params || typeof params !== 'object') return;
      const p = params as Record<string, unknown>;
      const updated = Number(p.updated) || 0;
      const newRows = Number(p.new) || 0;
      const folderErrors = Number(p.errors) || 0;
      const durationMs = Number(p.duration_ms) || 0;
      const durationSec = durationMs > 0 ? (durationMs / 1000).toFixed(1) : '—';
      const base = `${updated} actualizados · ${newRows} nuevos`;
      const withErr = folderErrors > 0 ? `${base} · ${folderErrors} carpeta(s) con error` : base;
      setNotifyResult(`${withErr} · ${durationSec}s`);
    });
  }, []);

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

  const displayError = statusMessage?.error || error;
  const displayResult = statusMessage?.result || notifyResult;
  const statusText = displayError || displayResult;

  return (
    <div
      className="flex h-full min-w-0 max-w-[min(380px,38vw)] shrink items-center gap-2.5 border-r border-[var(--border-subtle)] px-3"
      role="status"
      aria-label="Cobertura y auto-sync"
      title={statusText || undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p
            className={`min-w-0 truncate text-[11px] leading-none ${
              displayError ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'
            }`}
          >
            {displayError ? (
              <span className="truncate">{displayError}</span>
            ) : total > 0 ? (
              <>
                <span className="tabular-nums text-[var(--text-primary)]">{fmt(completos)}</span>
                <span className="text-[var(--text-muted)]"> / {fmt(total)}</span>
              </>
            ) : (
              <span className="text-[var(--text-muted)]">Sin datos de cobertura</span>
            )}
          </p>
          {!displayError && total > 0 && (
            <span className="shrink-0 text-[11px] tabular-nums leading-none tracking-tight text-[var(--text-primary)]">
              {completionPct}
              <span className="text-[var(--text-muted)]">%</span>
            </span>
          )}
        </div>
        <div className="mt-1.5">
          <CoverageRail
            total={total}
            completos={completos}
            faltantes={faltantes}
            sobrantes={sobrantes}
            sinSgio={sinSgio}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {lastSync && (
          <span
            className="hidden text-[10px] text-[var(--text-muted)] 2xl:inline"
            title={sheetName || undefined}
          >
            {lastSync}
          </span>
        )}
        <label className="flex cursor-pointer items-center gap-1.5 active:opacity-80">
          <span className="text-[10px] tracking-wide text-[var(--text-muted)]">Auto</span>
          <WithHoverTooltip label="Lee el Sheet cada 5 min (no re-escanea Drive)" placement="bottom">
            <button
              type="button"
              role="switch"
              aria-checked={autoSync}
              aria-label="Actualizar desde Sheet cada 5 minutos"
              disabled={togglingAuto}
              onClick={handleAutoSyncToggle}
              className={`relative h-4 w-7 shrink-0 rounded-full transition-colors duration-200 ease-out disabled:opacity-40 ${
                autoSync ? 'bg-[var(--accent-green)]' : 'bg-[var(--border-medium)]'
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                  autoSync ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </WithHoverTooltip>
        </label>
      </div>
    </div>
  );
}
