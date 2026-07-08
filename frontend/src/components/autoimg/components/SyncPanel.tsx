import { useCallback, useEffect, useState } from 'react';
import { api, onNotify } from '../../../api';
import { CoverageRail } from './shared';

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

  const legend = [
    { label: 'Completos', value: completos, color: 'var(--accent-green)' },
    { label: 'Faltantes', value: faltantes, color: 'var(--accent-red)' },
    { label: 'Sobrantes', value: sobrantes, color: 'var(--accent-yellow)' },
    { label: 'Sin SGIO', value: sinSgio, color: 'var(--accent-primary)' },
  ].filter((item) => item.value > 0);

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

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
      <div className="flex items-baseline justify-between gap-4">
        <p className="min-w-0 text-[13px] text-[var(--text-secondary)]">
          {total > 0 ? (
            <>
              <span className="tabular-nums text-[var(--text-primary)]">{fmt(completos)}</span>
              <span className="text-[var(--text-muted)]"> / {fmt(total)}</span>
              <span className="ml-1.5 text-[var(--text-muted)]">completos</span>
            </>
          ) : (
            <span className="text-[var(--text-muted)]">Sin datos de cobertura</span>
          )}
        </p>
        <div className="flex shrink-0 items-center gap-3">
          {lastSync && (
            <span
              className="hidden text-[11px] text-[var(--text-muted)] sm:inline"
              title={sheetName || undefined}
            >
              {lastSync}
            </span>
          )}
          {total > 0 && (
            <span className="text-[13px] tabular-nums tracking-tight text-[var(--text-primary)]">
              {completionPct}
              <span className="text-[var(--text-muted)]">%</span>
            </span>
          )}
          <label
            className="flex cursor-pointer items-center gap-1.5"
            title="Lee el Sheet cada 5 min (no re-escanea Drive)"
          >
            <span className="text-[10px] text-[var(--text-muted)]">Auto</span>
            <button
              type="button"
              role="switch"
              aria-checked={autoSync}
              aria-label="Actualizar desde Sheet cada 5 minutos"
              disabled={togglingAuto}
              onClick={handleAutoSyncToggle}
              className={`relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                autoSync ? 'bg-[var(--accent-green)]' : 'bg-[var(--border-medium)]'
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                  autoSync ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
        </div>
      </div>

      <div className="mt-2.5">
        <CoverageRail
          total={total}
          completos={completos}
          faltantes={faltantes}
          sobrantes={sobrantes}
          sinSgio={sinSgio}
        />
      </div>

      {legend.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {legend.map((item) => (
            <span
              key={item.label}
              className="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"
            >
              <span
                className="h-1 w-1 rounded-full"
                style={{ backgroundColor: item.color }}
                aria-hidden
              />
              {item.label}
              <span className="tabular-nums text-[var(--text-secondary)]">{fmt(item.value)}</span>
            </span>
          ))}
        </div>
      )}

      {(displayError || displayResult) && (
        <p
          className={`mt-2 text-[11px] ${
            displayError ? 'text-[var(--accent-red)]' : 'text-[var(--text-muted)]'
          }`}
        >
          {displayError || displayResult}
        </p>
      )}
    </div>
  );
}
