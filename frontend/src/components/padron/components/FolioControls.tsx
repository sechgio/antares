import { useCallback, useEffect, useRef, useState } from 'react';
import { Hash } from 'lucide-react';
import {
  createDefaultFolioConfig,
  formatFolioSummary,
  isDefaultFolioConfig,
  resolvePhysicalFolios,
  type FolioConfig,
} from '../folio';

interface FolioControlsProps {
  config: FolioConfig;
  totalPages: number;
  onChange: (config: FolioConfig) => void;
}

function parsePositiveInt(value: string, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.round(n);
}

export default function FolioControls({
  config,
  totalPages,
  onChange,
}: FolioControlsProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const effectiveEnd = config.folioEnd ?? totalPages;
  const folios = resolvePhysicalFolios(totalPages, {
    folioStart: config.folioStart,
    folioEnd: effectiveEnd,
    folioInverted: config.folioInverted,
  });
  const previewFirst = folios[0] ?? config.folioStart;
  const previewLast = folios[folios.length - 1] ?? effectiveEnd;
  const isDefault = isDefaultFolioConfig(config, totalPages);
  const summary = formatFolioSummary(config, totalPages);

  const handleStartChange = useCallback(
    (value: string) => {
      onChange({
        ...config,
        folioStart: parsePositiveInt(value, config.folioStart),
        syncedPageCount: config.syncedPageCount,
      });
    },
    [config, onChange],
  );

  const handleEndChange = useCallback(
    (value: string) => {
      const parsed = parsePositiveInt(value, effectiveEnd);
      onChange({
        ...config,
        folioEnd: parsed,
        syncedPageCount: totalPages > 0 ? totalPages : null,
      });
    },
    [config, effectiveEnd, onChange, totalPages],
  );

  const handleInvertChange = useCallback(
    (checked: boolean) => {
      onChange({ ...config, folioInverted: checked });
    },
    [config, onChange],
  );

  const handleReset = useCallback(() => {
    onChange(createDefaultFolioConfig());
  }, [onChange]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="vpad-folio-wrapper" ref={wrapperRef}>
      <button
        className={`vpad-btn-folio${!isDefault ? ' vpad-btn-folio-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Configurar numeración de página (foleado)"
        type="button"
        aria-expanded={open}
      >
        <Hash size={16} />
        Foleado
        {!isDefault && totalPages > 0 && (
          <span className="vpad-folio-summary">{summary}</span>
        )}
      </button>

      {open && (
        <div className="vpad-folio-popover" role="dialog" aria-label="Configuración de foleado">
          <div className="vpad-folio-popover-title">Numeración de página</div>

          <div className="vpad-folio-fields">
            <label className="vpad-folio-field">
              <span>Desde</span>
              <input
                type="number"
                min={1}
                value={config.folioStart}
                onChange={(e) => handleStartChange(e.target.value)}
              />
            </label>
            <label className="vpad-folio-field">
              <span>Hasta</span>
              <input
                type="number"
                min={1}
                value={effectiveEnd}
                onChange={(e) => handleEndChange(e.target.value)}
              />
            </label>
          </div>

          <label className="vpad-folio-invert">
            <input
              type="checkbox"
              checked={config.folioInverted}
              onChange={(e) => handleInvertChange(e.target.checked)}
            />
            <span>Invertir orden</span>
          </label>

          {totalPages > 0 && (
            <p className="vpad-folio-hint">
              Hoja 1 → {previewFirst} · Hoja {totalPages} → {previewLast}
            </p>
          )}

          <button
            className="vpad-folio-reset"
            type="button"
            onClick={handleReset}
            disabled={isDefault}
          >
            Restablecer
          </button>
        </div>
      )}
    </div>
  );
}
