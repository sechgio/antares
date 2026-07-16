import { useCallback, useEffect, useRef, useState } from 'react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { Hash } from 'lucide-react';
import {
  createDefaultFolioConfig,
  expectedFolioEnd,
  formatFolioSummary,
  formatPageNumberLabel,
  isDefaultFolioConfig,
  PAGE_NUMBER_FONT_STYLE_OPTIONS,
  PAGE_NUMBER_SIZE_OPTIONS,
  PAGE_NUMBER_STYLE_OPTIONS,
  resolvePhysicalFolios,
  type FolioConfig,
  type PageNumberFontStyle,
  type PageNumberSize,
  type PageNumberStyle,
} from '../folio';
import FolioMenuSelect, { type FolioMenuOption } from './FolioMenuSelect';

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

const FORMAT_OPTIONS: FolioMenuOption[] = PAGE_NUMBER_STYLE_OPTIONS.map((opt) => ({
  value: opt.value,
  label: opt.label,
  detail: opt.example,
}));

const SIZE_OPTIONS: FolioMenuOption[] = PAGE_NUMBER_SIZE_OPTIONS.map((opt) => ({
  value: opt.value,
  label: opt.label,
}));

const STYLE_OPTIONS: FolioMenuOption[] = PAGE_NUMBER_FONT_STYLE_OPTIONS.map((opt) => {
  const weight = opt.value === 'bold' || opt.value === 'bold_italic' ? 600 : 400;
  const fontStyle =
    opt.value === 'italic' || opt.value === 'bold_italic' ? 'italic' : 'normal';
  return {
    value: opt.value,
    label: opt.label,
    labelStyle:
      opt.value === 'auto'
        ? undefined
        : { fontWeight: weight, fontStyle },
  };
});

export default function FolioControls({
  config,
  totalPages,
  onChange,
}: FolioControlsProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const effectiveEnd =
    config.folioEnd ?? expectedFolioEnd(config.folioStart, totalPages);
  const folios = resolvePhysicalFolios(totalPages, {
    folioStart: config.folioStart,
    folioEnd: effectiveEnd,
    folioInverted: config.folioInverted,
  });
  const previewFirst = folios[0] ?? config.folioStart;
  const previewLast = folios[folios.length - 1] ?? effectiveEnd;
  const isDefault = isDefaultFolioConfig(config, totalPages);
  const summary = formatFolioSummary(config, totalPages);
  const pagesForPreview = Math.max(totalPages, 1);
  const sampleLabel = formatPageNumberLabel(
    config.pageNumberStyle,
    previewFirst,
    pagesForPreview,
  );

  const handleStartChange = useCallback(
    (value: string) => {
      const folioStart = parsePositiveInt(value, config.folioStart);
      onChange({
        ...config,
        folioStart,
        folioEnd: expectedFolioEnd(folioStart, Math.max(totalPages, 1)),
        syncedPageCount: totalPages > 0 ? totalPages : null,
      });
    },
    [config, onChange, totalPages],
  );

  const handleEndChange = useCallback(
    (value: string) => {
      const parsed = parsePositiveInt(value, effectiveEnd);
      const pages = Math.max(totalPages, 1);
      const folioStart = Math.max(1, parsed - pages + 1);
      onChange({
        ...config,
        folioStart,
        folioEnd: expectedFolioEnd(folioStart, pages),
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

  const handleFormatChange = useCallback(
    (value: string) => {
      onChange({ ...config, pageNumberStyle: value as PageNumberStyle });
    },
    [config, onChange],
  );

  const handleSizeChange = useCallback(
    (value: string) => {
      onChange({ ...config, pageNumberSize: value as PageNumberSize });
    },
    [config, onChange],
  );

  const handleFontStyleChange = useCallback(
    (value: string) => {
      onChange({ ...config, pageNumberFontStyle: value as PageNumberFontStyle });
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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="vpad-folio-wrapper" ref={wrapperRef}>
      <WithHoverTooltip label="Configurar numeración de página (foleado)" placement="bottom">
        <button
          className={`vpad-tool-chip vpad-btn-folio${!isDefault ? ' is-active vpad-btn-folio-active' : ''}${open ? ' is-open vpad-btn-folio-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <Hash size={15} strokeWidth={2} aria-hidden />
          Foleado
          {!isDefault && totalPages > 0 && (
            <span className="vpad-folio-summary tabular-nums">{summary}</span>
          )}
        </button>
      </WithHoverTooltip>

      {open && (
        <div
          className="vpad-folio-popover"
          role="dialog"
          aria-label="Configuración de foleado"
          aria-modal="false"
        >
          <header className="vpad-folio-popover-header">
            <h2 className="vpad-folio-popover-title">Numeración</h2>
          </header>

          <div className="vpad-folio-group">
            <div className="vpad-folio-row vpad-folio-row-split">
              <label className="vpad-folio-cell">
                <span className="vpad-folio-label">Desde</span>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className="vpad-folio-control tabular-nums"
                  value={config.folioStart}
                  onChange={(e) => handleStartChange(e.target.value)}
                />
              </label>
              <div className="vpad-folio-row-divider" aria-hidden="true" />
              <label className="vpad-folio-cell">
                <span className="vpad-folio-label">Hasta</span>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  className="vpad-folio-control tabular-nums"
                  value={effectiveEnd}
                  onChange={(e) => handleEndChange(e.target.value)}
                />
              </label>
            </div>

            <div className="vpad-folio-sep" aria-hidden="true" />

            <label className="vpad-folio-row vpad-folio-row-toggle">
              <span className="vpad-folio-label-primary">Invertir orden</span>
              <input
                type="checkbox"
                className="vpad-folio-switch-input"
                checked={config.folioInverted}
                onChange={(e) => handleInvertChange(e.target.checked)}
              />
              <span className="vpad-folio-switch" aria-hidden="true">
                <span className="vpad-folio-switch-thumb" />
              </span>
            </label>
          </div>

          <div className="vpad-folio-group">
            <div className="vpad-folio-row vpad-folio-row-setting">
              <span className="vpad-folio-setting-label">Formato</span>
              <FolioMenuSelect
                value={config.pageNumberStyle}
                options={FORMAT_OPTIONS}
                onChange={handleFormatChange}
                aria-label="Formato de numeración de página"
              />
            </div>

            <div className="vpad-folio-sep" aria-hidden="true" />

            <div className="vpad-folio-row vpad-folio-row-setting">
              <span className="vpad-folio-setting-label">Tamaño</span>
              <FolioMenuSelect
                value={config.pageNumberSize}
                options={SIZE_OPTIONS}
                onChange={handleSizeChange}
                aria-label="Tamaño de numeración de página"
              />
            </div>

            <div className="vpad-folio-sep" aria-hidden="true" />

            <div className="vpad-folio-row vpad-folio-row-setting">
              <span className="vpad-folio-setting-label">Estilo</span>
              <FolioMenuSelect
                value={config.pageNumberFontStyle}
                options={STYLE_OPTIONS}
                onChange={handleFontStyleChange}
                aria-label="Estilo tipográfico de numeración de página"
              />
            </div>
          </div>

          <div className="vpad-folio-preview" aria-live="polite" aria-atomic="true">
            <span className="vpad-folio-preview-sample tabular-nums">{sampleLabel}</span>
            {totalPages > 0 && (
              <span className="vpad-folio-hint tabular-nums">
                {previewFirst}
                <span className="vpad-folio-hint-sep" aria-hidden="true">
                  –
                </span>
                {previewLast}
              </span>
            )}
          </div>

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
