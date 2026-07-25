import { memo, useEffect, useState } from 'react';
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Link2,
  Link2Off,
  Lock,
  Minus,
  Plus,
  RotateCcw,
  Trash2,
  Unlock,
} from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import type { CanvasLayer, StrokeCap } from '../types';
import { DEFAULT_FIELD_KEYS } from '../constants';
import { mm, parseMm } from '../types';
import {
  addBoxShadow,
  BLEND_MODES,
  BLEND_MODE_LABELS,
  DEFAULT_SHADOW,
  DEFAULT_SHADOW_2,
  applyLineStrokeWeight,
  clampOpacity,
  clampStrokeWeight,
  cornerRadiusPx,
  removeBoxShadowAt,
  isAspectLocked,
  isShapeLayer,
  layerPanelTitle,
  lineHeightMmFromStrokePx,
  lineStrokeWidthPx,
  parseBlendMode,
  parseBoxShadows,
  parseFilterBlurPx,
  parseImageZoom,
  parseScale,
  parseStrokeAlign,
  parseStrokeDash,
  rememberStrokeWeight,
  updateBoxShadowAt,
  STROKE_WEIGHT_MAX_PX,
  STROKE_WEIGHT_MIN_PX,
  STROKE_WEIGHT_STEP_PX,
  toggleFlip,
  type CornerId,
  type StrokeAlign,
  type StrokeDash,
} from '../ops/layerStyle';
import {
  parseResizeAnchor,
  resizeLayerAnchored,
  RESIZE_ANCHORS,
  type ResizeAnchor,
} from '../ops/resizeConstraints';
import { parseStrokeCap } from '../ops/pathGeometry';
import { clipPathForLayerType } from '../ops/shapePaths';
import { exportLayerPng, exportSelectionPng } from '../ops/exportPng';
import InlineNumField from './InlineNumField';
import PaintRow from './PaintRow';
import TemplatesSection from './TemplatesSection';

interface RightPanelProps {
  layer: CanvasLayer | null;
  selectedCount: number;
  selectedIds?: string[];
  pageColors: string[];
  onChange: (layer: CanvasLayer) => void;
  /** Live updates without undo (typing). Pair with onCommitLive on blur. */
  onChangeLive?: (layer: CanvasLayer) => void;
  onCommitLive?: () => void;
  onDelete: (id: string) => void;
  onAlign: (align: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onBulkVisible: (visible: boolean) => void;
  onBulkLocked: (locked: boolean) => void;
  onBulkOpacity: (opacity: number) => void;
  onBringFront: () => void;
  onBringForward: () => void;
  onSendBack: () => void;
  onSendBackward: () => void;
  /** Apply a canvas preset when nothing is selected. */
  onApplyPreset?: (presetId: string) => void;
  /** True when another logo layer shares this layer's side. */
  logoSideConflict?: boolean;
  /** Mount point for viewport ZoomMenu (portal from DesignStage). */
  zoomSlotRef?: (el: HTMLDivElement | null) => void;
}

function NumField({
  label,
  value,
  onChange,
  onCommit,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  onCommit?: () => void;
  suffix?: string;
}) {
  // Draft while focused so partial input ("", "-", "1.") doesn't snap to 0.
  const [draft, setDraft] = useState<string | null>(null);
  const display = Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '0';
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="canvas-label !mb-0">{label}</span>
      <div className="relative">
        <input
          type="number"
          step={0.5}
          className="canvas-input pr-6"
          value={draft ?? display}
          onFocus={() => setDraft(display)}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const n = Number(raw);
            if (raw !== '' && Number.isFinite(n)) onChange(n);
          }}
          onBlur={() => {
            setDraft(null);
            onCommit?.();
          }}
        />
        {suffix && (
          <span
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px]"
            style={{ color: 'var(--cv-text-muted)' }}
          >
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

function HexField({
  color,
  ariaLabel,
  onCommit,
}: {
  color: string;
  ariaLabel: string;
  onCommit: (hex: string) => void;
}) {
  // Draft so partial hex input stays editable; commits only when valid.
  const [draft, setDraft] = useState(color.replace('#', ''));
  useEffect(() => {
    setDraft(color.replace('#', ''));
  }, [color]);
  return (
    <input
      className="canvas-input flex-1 uppercase"
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => {
        const raw = e.target.value.replace('#', '').slice(0, 6);
        if (!/^[0-9a-fA-F]*$/i.test(raw)) return;
        setDraft(raw);
        if (raw.length === 6) onCommit(`#${raw.toUpperCase()}`);
      }}
      onBlur={() => {
        if (/^[0-9a-fA-F]{6}$/i.test(draft)) onCommit(`#${draft.toUpperCase()}`);
        else setDraft(color.replace('#', ''));
      }}
    />
  );
}

function SectionHeader({
  title,
  children,
}: {
  title: string;
  children?: import('react').ReactNode;
}) {
  return (
    <div className="canvas-section-header">
      <div className="canvas-section-title">{title}</div>
      {children ? <div className="canvas-section-header-actions">{children}</div> : null}
    </div>
  );
}

const ALIGN_ITEMS = [
  { align: 'left' as const, icon: AlignStartVertical, label: 'Izquierda' },
  { align: 'center' as const, icon: AlignCenterVertical, label: 'Centro' },
  { align: 'right' as const, icon: AlignEndVertical, label: 'Derecha' },
  { align: 'top' as const, icon: AlignStartHorizontal, label: 'Arriba' },
  { align: 'middle' as const, icon: AlignCenterHorizontal, label: 'Medio' },
  { align: 'bottom' as const, icon: AlignEndHorizontal, label: 'Abajo' },
];

export default memo(function RightPanel({
  layer,
  selectedCount,
  selectedIds = [],
  pageColors,
  onChange,
  onChangeLive,
  onCommitLive,
  onDelete,
  onAlign,
  onDistribute,
  onBulkVisible,
  onBulkLocked,
  onBulkOpacity,
  onBringFront,
  onBringForward,
  onSendBack,
  onSendBackward,
  onApplyPreset,
  logoSideConflict = false,
  zoomSlotRef,
}: RightPanelProps) {
  const [exportScale, setExportScale] = useState(1);
  const [exporting, setExporting] = useState(false);

  const emitLive = (next: CanvasLayer) => {
    if (onChangeLive) onChangeLive(next);
    else onChange(next);
  };

  const setVar = (key: string, value: string) => {
    if (!layer) return;
    onChange({ ...layer, cssVars: { ...layer.cssVars, [key]: value } });
  };

  const setVarLive = (key: string, value: string) => {
    if (!layer) return;
    emitLive({ ...layer, cssVars: { ...layer.cssVars, [key]: value } });
  };

  const setVars = (patch: Record<string, string>) => {
    if (!layer) return;
    onChange({ ...layer, cssVars: { ...layer.cssVars, ...patch } });
  };

  const setVarsLive = (patch: Record<string, string>) => {
    if (!layer) return;
    emitLive({ ...layer, cssVars: { ...layer.cssVars, ...patch } });
  };

  const setMeta = (patch: NonNullable<CanvasLayer['meta']>) => {
    if (!layer) return;
    onChange({ ...layer, meta: { ...layer.meta, ...patch } });
  };

  const setMetaLive = (patch: NonNullable<CanvasLayer['meta']>) => {
    if (!layer) return;
    emitLive({ ...layer, meta: { ...layer.meta, ...patch } });
  };

  const hasSelection = Boolean(layer && layer.type !== 'frame');
  const shape = layer ? isShapeLayer(layer) : false;
  const isLine = layer?.type === 'line';
  const showRadius = layer ? !clipPathForLayerType(layer.type) && layer.type !== 'line' : false;
  const hasFill =
    Boolean(layer) &&
    !isLine &&
    layer!.cssVars['--background-color'] !== 'transparent' &&
    layer!.cssVars['--fill-visible'] !== '0';
  const hasStroke =
    Boolean(layer) &&
    layer!.cssVars['--stroke-visible'] !== '0' &&
    (isLine || parseFloat(layer!.cssVars['--border-width'] || '0') > 0);
  const strokeWeightPx = layer
    ? isLine
      ? lineStrokeWidthPx(layer)
      : clampStrokeWeight(parseFloat(layer.cssVars['--border-width'] || '0') || 0)
    : 0;

  const setStrokeWeight = (raw: number) => {
    if (!layer) return;
    if (layer.type === 'line') {
      emitLive(applyLineStrokeWeight(layer, raw));
      return;
    }
    const px = clampStrokeWeight(raw);
    rememberStrokeWeight(px);
    setVarLive('--border-width', `${px}px`);
  };

  return (
    <aside
      className="flex h-full w-[260px] shrink-0 flex-col border-l"
      style={{ background: 'var(--cv-panel)', borderColor: 'var(--cv-border)' }}
      data-testid="canvas-right-panel"
    >
      <div
        className="relative z-20 flex items-center justify-between gap-2 border-b px-3 py-2.5"
        style={{ borderColor: 'var(--cv-border)' }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="canvas-section-title !mb-0 truncate">
            {selectedCount > 1
              ? `${selectedCount} seleccionados`
              : hasSelection && layer
                ? layerPanelTitle(layer)
                : 'Propiedades'}
          </span>
          <div
            ref={zoomSlotRef}
            className="relative shrink-0"
            data-testid="canvas-zoom-slot"
          />
        </div>
        {hasSelection && layer && selectedCount === 1 && (
          <div className="flex items-center gap-0.5">
            <WithHoverTooltip
              label={layer.visible !== false ? 'Ocultar' : 'Mostrar'}
              placement="bottom"
              variant="dark"
            >
              <button
                type="button"
                className="canvas-icon-btn !h-7 !w-7"
                aria-label="Visible"
                onClick={() => onChange({ ...layer, visible: layer.visible === false })}
              >
                {layer.visible !== false ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
            </WithHoverTooltip>
            <WithHoverTooltip
              label={layer.locked ? 'Desbloquear' : 'Bloquear'}
              placement="bottom"
              variant="dark"
            >
              <button
                type="button"
                className="canvas-icon-btn !h-7 !w-7"
                aria-label="Bloquear"
                onClick={() => onChange({ ...layer, locked: !layer.locked })}
              >
                {layer.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              </button>
            </WithHoverTooltip>
          </div>
        )}
      </div>

      {selectedCount === 0 && onApplyPreset && (
        <div className="border-b px-2 py-2" style={{ borderColor: 'var(--cv-border)' }}>
          <TemplatesSection onApplyPreset={onApplyPreset} tooltipPlacement="left" />
        </div>
      )}

      {selectedCount > 1 && (
        <div className="canvas-section">
          <div className="canvas-section-title">Alinear ({selectedCount})</div>
          <div className="flex flex-wrap gap-1">
            {ALIGN_ITEMS.map(({ align, icon: Icon, label }) => (
              <WithHoverTooltip key={align} label={label} placement="bottom" variant="dark">
                <button
                  type="button"
                  className="canvas-icon-btn"
                  aria-label={label}
                  onClick={() => onAlign(align)}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              </WithHoverTooltip>
            ))}
          </div>
          {selectedCount >= 3 && (
            <div className="mt-2 flex gap-1">
              <WithHoverTooltip label="Distribuir horizontal" placement="bottom" variant="dark">
                <button
                  type="button"
                  className="canvas-icon-btn"
                  aria-label="Distribuir horizontal"
                  onClick={() => onDistribute('horizontal')}
                >
                  <AlignHorizontalDistributeCenter className="h-3.5 w-3.5" />
                </button>
              </WithHoverTooltip>
              <WithHoverTooltip label="Distribuir vertical" placement="bottom" variant="dark">
                <button
                  type="button"
                  className="canvas-icon-btn"
                  aria-label="Distribuir vertical"
                  onClick={() => onDistribute('vertical')}
                >
                  <AlignVerticalDistributeCenter className="h-3.5 w-3.5" />
                </button>
              </WithHoverTooltip>
            </div>
          )}
          <div className="mt-2 flex gap-1">
            <WithHoverTooltip label="Al frente" placement="bottom" variant="dark">
              <button type="button" className="canvas-icon-btn" aria-label="Al frente" onClick={onBringFront}>
                <ArrowUpToLine className="h-3.5 w-3.5" />
              </button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Adelante" placement="bottom" variant="dark">
              <button type="button" className="canvas-icon-btn" aria-label="Adelante" onClick={onBringForward}>
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Atrás" placement="bottom" variant="dark">
              <button type="button" className="canvas-icon-btn" aria-label="Atrás" onClick={onSendBackward}>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Al fondo" placement="bottom" variant="dark">
              <button type="button" className="canvas-icon-btn" aria-label="Al fondo" onClick={onSendBack}>
                <ArrowDownToLine className="h-3.5 w-3.5" />
              </button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Mostrar" placement="bottom" variant="dark">
              <button type="button" className="canvas-icon-btn" aria-label="Mostrar" onClick={() => onBulkVisible(true)}>
                <Eye className="h-3.5 w-3.5" />
              </button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Ocultar" placement="bottom" variant="dark">
              <button type="button" className="canvas-icon-btn" aria-label="Ocultar" onClick={() => onBulkVisible(false)}>
                <EyeOff className="h-3.5 w-3.5" />
              </button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Bloquear" placement="bottom" variant="dark">
              <button type="button" className="canvas-icon-btn" aria-label="Bloquear" onClick={() => onBulkLocked(true)}>
                <Lock className="h-3.5 w-3.5" />
              </button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Desbloquear" placement="bottom" variant="dark">
              <button
                type="button"
                className="canvas-icon-btn"
                aria-label="Desbloquear"
                onClick={() => onBulkLocked(false)}
              >
                <Unlock className="h-3.5 w-3.5" />
              </button>
            </WithHoverTooltip>
          </div>
          <label className="mt-2 flex min-w-0 flex-col gap-0.5">
            <span className="canvas-label !mb-0">Opacidad</span>
            <input
              type="number"
              min={0}
              max={100}
              className="canvas-input"
              defaultValue={100}
              key={selectedIds.join(',')}
              aria-label="Opacidad múltiple"
              onBlur={(e) => onBulkOpacity(clampOpacity(Number(e.target.value) || 0))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </label>
          <div className="mt-2 flex gap-2">
            <select
              className="canvas-input"
              value={exportScale}
              onChange={(e) => setExportScale(Number(e.target.value))}
              aria-label="Escala de exportación"
            >
              <option value={1}>1x</option>
              <option value={2}>2x</option>
            </select>
            <button
              type="button"
              className="canvas-export-btn flex-1"
              disabled={exporting || selectedIds.length === 0}
              onClick={() => {
                setExporting(true);
                void exportSelectionPng(
                  selectedIds,
                  `seleccion-${selectedIds.length}`,
                  exportScale,
                ).finally(() => setExporting(false));
              }}
            >
              Exportar PNG
            </button>
          </div>
        </div>
      )}

      {hasSelection && layer && selectedCount === 1 && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Posición */}
            <div className="canvas-section">
              <SectionHeader title="Posición" />
              <span className="canvas-sublabel">Alineación</span>
              <div className="mb-2 flex flex-wrap gap-1">
                {ALIGN_ITEMS.map(({ align, icon: Icon, label }) => (
                  <WithHoverTooltip key={align} label={label} placement="bottom" variant="dark">
                    <button
                      type="button"
                      className="canvas-icon-btn !h-7 !w-7"
                      aria-label={label}
                      onClick={() => onAlign(align)}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  </WithHoverTooltip>
                ))}
              </div>
              <div className="flex gap-2">
                <InlineNumField
                  prefix="X"
                  value={parseMm(layer.cssVars['--translate-x'])}
                  onChange={(n) => setVarLive('--translate-x', mm(n))}
                  onCommit={onCommitLive}
                />
                <InlineNumField
                  prefix="Y"
                  value={parseMm(layer.cssVars['--translate-y'])}
                  onChange={(n) => setVarLive('--translate-y', mm(n))}
                  onCommit={onCommitLive}
                />
              </div>
              <div className="mt-2 flex items-center gap-1">
                <InlineNumField
                  prefix=""
                  value={parseFloat(layer.cssVars['--rotate'] || '0') || 0}
                  onChange={(n) => setVarLive('--rotate', `${n}deg`)}
                  onCommit={onCommitLive}
                  suffix="°"
                  title="Rotación"
                />
                <WithHoverTooltip label="Voltear horizontal" placement="bottom" variant="dark">
                  <button
                    type="button"
                    className="canvas-icon-btn !h-7 !w-7"
                    data-active={parseScale(layer.cssVars['--scale-x']) === -1}
                    aria-label="Voltear horizontal"
                    onClick={() => onChange(toggleFlip(layer, 'x'))}
                  >
                    <FlipHorizontal2 className="h-3.5 w-3.5" />
                  </button>
                </WithHoverTooltip>
                <WithHoverTooltip label="Voltear vertical" placement="bottom" variant="dark">
                  <button
                    type="button"
                    className="canvas-icon-btn !h-7 !w-7"
                    data-active={parseScale(layer.cssVars['--scale-y']) === -1}
                    aria-label="Voltear vertical"
                    onClick={() => onChange(toggleFlip(layer, 'y'))}
                  >
                    <FlipVertical2 className="h-3.5 w-3.5" />
                  </button>
                </WithHoverTooltip>
                <WithHoverTooltip label="Restablecer rotación" placement="bottom" variant="dark">
                  <button
                    type="button"
                    className="canvas-icon-btn !h-7 !w-7"
                    aria-label="Restablecer rotación"
                    onClick={() => setVars({ '--rotate': '0deg', '--scale-x': '1', '--scale-y': '1' })}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </WithHoverTooltip>
              </div>
            </div>

            {/* Disposición */}
            <div className="canvas-section">
              <SectionHeader title="Disposición" />
              <span className="canvas-sublabel">Dimensiones</span>
              <div className="flex items-center gap-1">
                <InlineNumField
                  prefix="W"
                  value={parseMm(layer.cssVars['--width'], 10)}
                  onChange={(n) => emitLive(resizeLayerAnchored(layer, 'width', n))}
                  onCommit={onCommitLive}
                />
                <InlineNumField
                  prefix="H"
                  value={
                    isLine
                      ? Math.round(lineHeightMmFromStrokePx(lineStrokeWidthPx(layer)) * 100) / 100
                      : parseMm(layer.cssVars['--height'], 10)
                  }
                  onChange={(n) => emitLive(resizeLayerAnchored(layer, 'height', n))}
                  onCommit={onCommitLive}
                  title={isLine ? 'Grosor (derivado del trazo)' : undefined}
                />
                <WithHoverTooltip
                  label={isAspectLocked(layer.cssVars) ? 'Desbloquear proporciones' : 'Bloquear proporciones'}
                  placement="bottom"
                  variant="dark"
                >
                  <button
                    type="button"
                    className="canvas-icon-btn !h-7 !w-7"
                    data-active={isAspectLocked(layer.cssVars)}
                    aria-label="Proporciones"
                    onClick={() =>
                      setVar('--aspect-locked', isAspectLocked(layer.cssVars) ? '0' : '1')
                    }
                  >
                    {isAspectLocked(layer.cssVars) ? (
                      <Link2 className="h-3.5 w-3.5" />
                    ) : (
                      <Link2Off className="h-3.5 w-3.5" />
                    )}
                  </button>
                </WithHoverTooltip>
              </div>
              <span className="canvas-sublabel mt-2 block">Anclaje de redimensión</span>
              <div
                className="grid w-fit grid-cols-3 gap-0.5"
                role="radiogroup"
                aria-label="Anclaje de redimensión"
              >
                {RESIZE_ANCHORS.map((anchor: ResizeAnchor) => {
                  const active = parseResizeAnchor(layer.cssVars['--resize-anchor']) === anchor;
                  return (
                    <button
                      key={anchor}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={`Anclar ${anchor}`}
                      className="flex h-5 w-5 items-center justify-center rounded-sm border"
                      style={{
                        borderColor: 'var(--cv-border)',
                        background: active ? 'var(--cv-accent, #18a0fb)' : 'transparent',
                      }}
                      onClick={() => setVar('--resize-anchor', anchor)}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: active ? '#fff' : 'var(--cv-text-muted)' }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Apariencia */}
            <div className="canvas-section">
              <SectionHeader title="Apariencia" />
              <div className="flex gap-2">
                <InlineNumField
                  prefix=""
                  value={Number(layer.cssVars['--opacity'] || 100)}
                  onChange={(n) => setVarLive('--opacity', String(clampOpacity(n)))}
                  onCommit={onCommitLive}
                  suffix="%"
                  title="Opacidad"
                />
                {showRadius && (
                  <InlineNumField
                    prefix=""
                    value={cornerRadiusPx(layer.cssVars, 'tl')}
                    onChange={(n) => {
                      const v = `${Math.max(0, n)}px`;
                      const next = { ...layer.cssVars, '--border-radius': v };
                      delete next['--radius-tl'];
                      delete next['--radius-tr'];
                      delete next['--radius-br'];
                      delete next['--radius-bl'];
                      emitLive({ ...layer, cssVars: next });
                    }}
                    onCommit={onCommitLive}
                    title="Radio uniforme"
                  />
                )}
              </div>
              <label className="mt-2 block">
                <span className="canvas-sublabel">Modo de fusión</span>
                <select
                  className="canvas-input mt-1"
                  value={parseBlendMode(layer.cssVars)}
                  aria-label="Modo de fusión"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'normal') {
                      const next = { ...layer.cssVars };
                      delete next['--blend-mode'];
                      onChange({ ...layer, cssVars: next });
                    } else {
                      setVar('--blend-mode', v);
                    }
                  }}
                >
                  {BLEND_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {BLEND_MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
              </label>
              {showRadius && (
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {(
                    [
                      ['tl', 'TL'],
                      ['tr', 'TR'],
                      ['bl', 'BL'],
                      ['br', 'BR'],
                    ] as Array<[CornerId, string]>
                  ).map(([corner, label]) => (
                    <InlineNumField
                      key={corner}
                      prefix={label}
                      value={cornerRadiusPx(layer.cssVars, corner)}
                      onChange={(n) => setVarLive(`--radius-${corner}`, `${Math.max(0, n)}px`)}
                      onCommit={onCommitLive}
                      title={`Radio ${label}`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Relleno */}
            <div className="canvas-section">
              <SectionHeader title="Relleno">
                <button
                  type="button"
                  className="canvas-paint-icon"
                  aria-label="Añadir relleno"
                  disabled={hasFill}
                  onClick={() =>
                    setVars({
                      '--background-color': '#D9D9D9',
                      '--fill-opacity': '100',
                      '--fill-visible': '1',
                    })
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </SectionHeader>
              {hasFill ? (
                <div className="space-y-2">
                  <PaintRow
                    color={layer.cssVars['--background-color'] || '#FFFFFF'}
                    opacity={Number(layer.cssVars['--fill-opacity'] ?? 100)}
                    visible={layer.cssVars['--fill-visible'] !== '0'}
                    pageColors={pageColors}
                    onPaintChange={(c, o) =>
                      setVarsLive({
                        '--background-color': c,
                        '--fill-opacity': String(o),
                        '--fill-visible': '1',
                      })
                    }
                    onPaintCommit={onCommitLive}
                    onVisibleChange={(v) => setVar('--fill-visible', v ? '1' : '0')}
                    onRemove={() =>
                      setVars({
                        '--background-color': 'transparent',
                        '--fill-visible': '0',
                        '--fill-type': 'solid',
                      })
                    }
                  />
                  <label className="block text-[11px]" style={{ color: 'var(--cv-text-secondary)' }}>
                    Tipo
                    <select
                      className="canvas-input mt-1 w-full text-[11px]"
                      value={layer.cssVars['--fill-type'] || 'solid'}
                      aria-label="Tipo de relleno"
                      onChange={(e) => {
                        const next = e.target.value;
                        if (next === 'linear' || next === 'radial') {
                          setVars({
                            '--fill-type': next,
                            '--fill-color-2': layer.cssVars['--fill-color-2'] || '#000000',
                            '--fill-angle': layer.cssVars['--fill-angle'] || '180',
                          });
                        } else {
                          setVar('--fill-type', 'solid');
                        }
                      }}
                    >
                      <option value="solid">Sólido</option>
                      <option value="linear">Lineal</option>
                      <option value="radial">Radial</option>
                    </select>
                  </label>
                  {(layer.cssVars['--fill-type'] === 'linear' ||
                    layer.cssVars['--fill-type'] === 'radial') && (
                    <>
                      <PaintRow
                        color={layer.cssVars['--fill-color-2'] || '#000000'}
                        opacity={Number(layer.cssVars['--fill-opacity'] ?? 100)}
                        visible
                        pageColors={pageColors}
                        onPaintChange={(c, o) =>
                          setVarsLive({
                            '--fill-color-2': c,
                            '--fill-opacity': String(o),
                          })
                        }
                        onPaintCommit={onCommitLive}
                        onRemove={() => setVar('--fill-type', 'solid')}
                      />
                      {layer.cssVars['--fill-type'] === 'linear' && (
                        <InlineNumField
                          prefix="∠"
                          value={Number.parseFloat(layer.cssVars['--fill-angle'] || '180') || 180}
                          step={1}
                          title="Ángulo del degradado"
                          onChange={(n) => setVarLive('--fill-angle', String(Math.round(n)))}
                          onCommit={onCommitLive}
                          suffix="°"
                        />
                      )}
                    </>
                  )}
                </div>
                ) : (
                <p className="text-[11px]" style={{ color: 'var(--cv-text-muted)' }}>
                  Sin relleno
                </p>
              )}
            </div>

            {/* Trazo */}
            <div className="canvas-section">
              <SectionHeader title="Trazo">
                <button
                  type="button"
                  className="canvas-paint-icon"
                  aria-label="Añadir trazo"
                  disabled={hasStroke}
                  onClick={() => {
                    if (!layer) return;
                    if (layer.type === 'line') {
                      onChange(
                        applyLineStrokeWeight(
                          {
                            ...layer,
                            cssVars: {
                              ...layer.cssVars,
                              '--border-color': layer.cssVars['--border-color'] || '#000000',
                              '--stroke-opacity': '100',
                              '--stroke-align': 'center',
                            },
                          },
                          1,
                        ),
                      );
                      return;
                    }
                    setVars({
                      '--border-color': '#000000',
                      '--border-width': '1px',
                      '--stroke-opacity': '100',
                      '--stroke-visible': '1',
                      '--stroke-align': 'inside',
                    });
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </SectionHeader>
              {hasStroke ? (
                  <>
                    <PaintRow
                      color={layer.cssVars['--border-color'] || '#000000'}
                      opacity={Number(layer.cssVars['--stroke-opacity'] ?? 100)}
                      visible={layer.cssVars['--stroke-visible'] !== '0'}
                      pageColors={pageColors}
                      onPaintChange={(c, o) =>
                        setVarsLive({
                          '--border-color': c,
                          '--stroke-opacity': String(o),
                          '--stroke-visible': '1',
                        })
                      }
                      onPaintCommit={onCommitLive}
                      onVisibleChange={(v) => setVar('--stroke-visible', v ? '1' : '0')}
                      onRemove={() => {
                        if (layer.type === 'line') {
                          onChange(applyLineStrokeWeight(layer, 0));
                          return;
                        }
                        setVars({
                          '--border-width': '0px',
                          '--stroke-visible': '0',
                        });
                      }}
                    />
                    <div className="mt-2 space-y-2">
                      <label className="block">
                        <span className="canvas-sublabel">Posición</span>
                        <select
                          className="canvas-input"
                          value={isLine ? 'center' : parseStrokeAlign(layer.cssVars['--stroke-align'])}
                          disabled={isLine}
                          title={isLine ? 'Las líneas abiertas usan alineación Centro' : undefined}
                          onChange={(e) => setVar('--stroke-align', e.target.value as StrokeAlign)}
                        >
                          {!isLine && <option value="inside">Interior</option>}
                          <option value="center">Centro</option>
                          {!isLine && <option value="outside">Exterior</option>}
                        </select>
                      </label>
                      <label className="block">
                        <span className="canvas-sublabel">Estilo</span>
                        <select
                          className="canvas-input"
                          value={parseStrokeDash(layer.cssVars['--stroke-dash'])}
                          aria-label="Estilo de trazo"
                          onChange={(e) => setVar('--stroke-dash', e.target.value as StrokeDash)}
                        >
                          <option value="solid">Continuo</option>
                          <option value="dashed">Discontinuo</option>
                          <option value="dotted">Punteado</option>
                        </select>
                      </label>
                      <div>
                        <span className="canvas-sublabel">Peso</span>
                        <div className="mt-0.5 flex items-center gap-2">
                          <input
                            type="range"
                            className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--cv-border)] outline-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-black/20 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-black/20 [&::-moz-range-thumb]:bg-white [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[var(--cv-border)]"
                            min={STROKE_WEIGHT_MIN_PX}
                            max={STROKE_WEIGHT_MAX_PX}
                            step={STROKE_WEIGHT_STEP_PX}
                            value={strokeWeightPx}
                            aria-label="Peso del trazo"
                            onChange={(e) => setStrokeWeight(Number(e.target.value))}
                            onPointerUp={() => onCommitLive?.()}
                            onKeyUp={() => onCommitLive?.()}
                          />
                          <input
                            type="number"
                            className="canvas-input w-[4.25rem] shrink-0"
                            min={STROKE_WEIGHT_MIN_PX}
                            max={STROKE_WEIGHT_MAX_PX}
                            step={STROKE_WEIGHT_STEP_PX}
                            value={strokeWeightPx}
                            aria-label="Peso del trazo (px)"
                            title={`Grosor en px (${STROKE_WEIGHT_MIN_PX}–${STROKE_WEIGHT_MAX_PX})`}
                            onChange={(e) => setStrokeWeight(Number(e.target.value))}
                            onBlur={() => onCommitLive?.()}
                          />
                        </div>
                      </div>
                      {isLine && (
                        <div className="flex gap-2">
                          <label className="min-w-0 flex-1">
                            <span className="canvas-sublabel">Punto de partida</span>
                            <select
                              className="canvas-input"
                              value={parseStrokeCap(layer.cssVars['--stroke-start'])}
                              aria-label="Punto de partida"
                              onChange={(e) => setVar('--stroke-start', e.target.value as StrokeCap)}
                            >
                              <option value="none">Ninguno</option>
                              <option value="round">Redondo</option>
                              <option value="square">Cuadrado</option>
                              <option value="arrow">Flecha</option>
                            </select>
                          </label>
                          <label className="min-w-0 flex-1">
                            <span className="canvas-sublabel">Punto final</span>
                            <select
                              className="canvas-input"
                              value={parseStrokeCap(layer.cssVars['--stroke-end'])}
                              aria-label="Punto final"
                              onChange={(e) => setVar('--stroke-end', e.target.value as StrokeCap)}
                            >
                              <option value="none">Ninguno</option>
                              <option value="round">Redondo</option>
                              <option value="square">Cuadrado</option>
                              <option value="arrow">Flecha</option>
                            </select>
                          </label>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-[11px]" style={{ color: 'var(--cv-text-muted)' }}>
                    Sin trazo
                  </p>
                )}
            </div>

            {/* Efectos */}
            <div className="canvas-section">
              <SectionHeader title="Efectos">
                <button
                  type="button"
                  className="canvas-paint-icon"
                  aria-label="Añadir sombra"
                  onClick={() => {
                    const raw = layer.cssVars['--box-shadow'];
                    const preset = parseBoxShadows(raw).length === 0 ? DEFAULT_SHADOW : DEFAULT_SHADOW_2;
                    setVar('--box-shadow', addBoxShadow(raw, preset));
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </SectionHeader>
              <div className="space-y-2">
                <InlineNumField
                  prefix="Blur"
                  value={parseFilterBlurPx(layer.cssVars)}
                  step={1}
                  title="Desenfoque de capa"
                  onChange={(n) => {
                    const blur = Math.max(0, Math.min(40, Math.round(n)));
                    setVarLive('--filter-blur', blur > 0 ? `${blur}px` : '0px');
                  }}
                  onCommit={onCommitLive}
                  suffix="px"
                />
                {parseBoxShadows(layer.cssVars['--box-shadow']).map((shadow, shadowIndex) => (
                  <div className="space-y-2" data-testid="canvas-effect-shadow" key={shadowIndex}>
                    <div className="flex items-center gap-2">
                      <span
                        className="canvas-swatch !cursor-default"
                        style={{ backgroundImage: 'none' }}
                      >
                        <span className="canvas-swatch-fill" style={{ background: shadow.color }} />
                      </span>
                      <HexField
                        color={shadow.color}
                        ariaLabel={`Color sombra ${shadowIndex + 1}`}
                        onCommit={(hex) =>
                          setVar(
                            '--box-shadow',
                            updateBoxShadowAt(layer.cssVars['--box-shadow'], shadowIndex, {
                              color: hex,
                            }),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="canvas-paint-icon"
                        aria-label="Quitar sombra"
                        onClick={() =>
                          setVar(
                            '--box-shadow',
                            removeBoxShadowAt(layer.cssVars['--box-shadow'], shadowIndex),
                          )
                        }
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex gap-1">
                      <InlineNumField
                        prefix="X"
                        value={shadow.x}
                        step={1}
                        onChange={(n) =>
                          setVarLive(
                            '--box-shadow',
                            updateBoxShadowAt(layer.cssVars['--box-shadow'], shadowIndex, { x: n }),
                          )
                        }
                        onCommit={onCommitLive}
                      />
                      <InlineNumField
                        prefix="Y"
                        value={shadow.y}
                        step={1}
                        onChange={(n) =>
                          setVarLive(
                            '--box-shadow',
                            updateBoxShadowAt(layer.cssVars['--box-shadow'], shadowIndex, { y: n }),
                          )
                        }
                        onCommit={onCommitLive}
                      />
                    </div>
                    <div className="flex gap-1">
                      <InlineNumField
                        prefix="B"
                        value={shadow.blur}
                        step={1}
                        title="Difuminado"
                        onChange={(n) =>
                          setVarLive(
                            '--box-shadow',
                            updateBoxShadowAt(layer.cssVars['--box-shadow'], shadowIndex, {
                              blur: Math.max(0, n),
                            }),
                          )
                        }
                        onCommit={onCommitLive}
                      />
                      <InlineNumField
                        prefix=""
                        value={shadow.opacity}
                        suffix="%"
                        title="Opacidad sombra"
                        onChange={(n) =>
                          setVarLive(
                            '--box-shadow',
                            updateBoxShadowAt(layer.cssVars['--box-shadow'], shadowIndex, {
                              opacity: clampOpacity(n),
                            }),
                          )
                        }
                        onCommit={onCommitLive}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Exportar */}
            <div className="canvas-section">
              <SectionHeader title="Exportar" />
              <div className="flex gap-2">
                <select
                  className="canvas-input"
                  value={exportScale}
                  onChange={(e) => setExportScale(Number(e.target.value))}
                  aria-label="Escala de exportación"
                >
                  <option value={1}>1x</option>
                  <option value={2}>2x</option>
                </select>
                <select className="canvas-input" value="png" disabled aria-label="Formato">
                  <option value="png">PNG</option>
                </select>
              </div>
              <button
                type="button"
                className="canvas-export-btn"
                disabled={exporting}
                onClick={() => {
                  setExporting(true);
                  void exportLayerPng(layer.id, layer.name || layerPanelTitle(layer), exportScale).finally(
                    () => setExporting(false),
                  );
                }}
              >
                Exportar {layer.name || layerPanelTitle(layer)}
              </button>
            </div>

            {/* Nombre + z-order for non-shape still useful; for shapes keep compact */}
            {!shape && (
              <div className="canvas-section">
                <SectionHeader title="Capa" />
                <input
                  className="canvas-input mb-2"
                  value={layer.name}
                  onChange={(e) => emitLive({ ...layer, name: e.target.value })}
                  onBlur={() => onCommitLive?.()}
                />
                <div className="flex gap-1">
                  <WithHoverTooltip label="Al frente" placement="bottom" variant="dark">
                    <button type="button" className="canvas-icon-btn" aria-label="Al frente" onClick={onBringFront}>
                      <ArrowUpToLine className="h-3.5 w-3.5" />
                    </button>
                  </WithHoverTooltip>
                  <WithHoverTooltip label="Adelante" placement="bottom" variant="dark">
                    <button type="button" className="canvas-icon-btn" aria-label="Adelante" onClick={onBringForward}>
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                  </WithHoverTooltip>
                  <WithHoverTooltip label="Atrás" placement="bottom" variant="dark">
                    <button type="button" className="canvas-icon-btn" aria-label="Atrás" onClick={onSendBackward}>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </WithHoverTooltip>
                  <WithHoverTooltip label="Al fondo" placement="bottom" variant="dark">
                    <button type="button" className="canvas-icon-btn" aria-label="Al fondo" onClick={onSendBack}>
                      <ArrowDownToLine className="h-3.5 w-3.5" />
                    </button>
                  </WithHoverTooltip>
                </div>
              </div>
            )}

            {(layer.type === 'text' || layer.type === 'field') && (
              <div className="canvas-section">
                <div className="canvas-section-title">Texto</div>
                {layer.type === 'text' && (
                  <textarea
                    className="canvas-input mb-2 !h-auto py-1.5"
                    rows={3}
                    value={layer.value}
                    onChange={(e) => emitLive({ ...layer, value: e.target.value })}
                    onBlur={() => onCommitLive?.()}
                  />
                )}
                <div className="mb-2 flex items-center gap-2">
                  <input
                    type="color"
                    className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent"
                    value={layer.cssVars['--color'] || '#1e1e1e'}
                    onChange={(e) => setVarLive('--color', e.target.value)}
                    onBlur={() => onCommitLive?.()}
                  />
                  <input
                    className="canvas-input"
                    value={layer.cssVars['--font-size'] || '11pt'}
                    onChange={(e) => setVarLive('--font-size', e.target.value)}
                    onBlur={() => onCommitLive?.()}
                    placeholder="11pt"
                  />
                </div>
                <select
                  className="canvas-input mb-2"
                  value={layer.cssVars['--font-weight'] || '400'}
                  onChange={(e) => setVar('--font-weight', e.target.value)}
                >
                  <option value="400">Regular</option>
                  <option value="500">Medium</option>
                  <option value="600">Semibold</option>
                  <option value="700">Bold</option>
                </select>
                <select
                  className="canvas-input mb-2"
                  value={layer.cssVars['--font-family'] || 'Segoe UI, Arial, sans-serif'}
                  onChange={(e) => setVar('--font-family', e.target.value)}
                >
                  <option value="Segoe UI, Arial, sans-serif">Segoe UI</option>
                  <option value="Arial, sans-serif">Arial</option>
                  <option value="Georgia, serif">Georgia</option>
                  <option value="Consolas, monospace">Consolas</option>
                </select>
                <div className="mb-2 flex gap-1">
                  {[
                    { icon: AlignLeft, align: 'left', label: 'Alinear izquierda' },
                    { icon: AlignCenter, align: 'center', label: 'Alinear centro' },
                    { icon: AlignRight, align: 'right', label: 'Alinear derecha' },
                  ].map(({ icon: Icon, align, label }) => (
                    <WithHoverTooltip key={align} label={label} placement="bottom" variant="dark">
                      <button
                        type="button"
                        className="canvas-icon-btn"
                        aria-label={label}
                        data-active={layer.cssVars['--text-align'] === align}
                        onClick={() => setVar('--text-align', align)}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </button>
                    </WithHoverTooltip>
                  ))}
                </div>
                <input
                  className="canvas-input"
                  placeholder="Line height (ej. 1.2)"
                  value={layer.cssVars['--line-height'] || ''}
                  onChange={(e) => setVarLive('--line-height', e.target.value)}
                  onBlur={() => onCommitLive?.()}
                />
              </div>
            )}

            {layer.type === 'field' && (
              <div className="canvas-section">
                <div className="canvas-section-title">Campo Excel</div>
                <p className="mb-2 text-[11px] leading-snug" style={{ color: 'var(--cv-text-muted)' }}>
                  La clave se mapea a una columna en <strong>Generar</strong>. En el lienzo se previsualiza el
                  fallback (o{' '}
                  <code className="canvas-inline-code">{`{{ ${layer.meta?.key || 'CLAVE'} }}`}</code> si está
                  vacío). Doble clic enfoca la clave.
                </p>
                <div className="mb-2 flex flex-wrap gap-1">
                  {DEFAULT_FIELD_KEYS.map((f) => {
                    const active = (layer.meta?.key || '') === f.key;
                    return (
                      <WithHoverTooltip key={f.key} label={f.label} shortcut={f.key} placement="top" variant="dark">
                        <button
                          type="button"
                          className="canvas-chip"
                          data-active={active}
                          aria-label={`${f.label} (${f.key})`}
                          onClick={() =>
                            onChange({
                              ...layer,
                              name: f.label,
                              meta: { ...layer.meta, key: f.key },
                            })
                          }
                        >
                          {f.key}
                        </button>
                      </WithHoverTooltip>
                    );
                  })}
                </div>
                <label className="mb-2 block">
                  <span className="canvas-label">Clave</span>
                  <input
                    data-testid="canvas-field-key-input"
                    className="canvas-input uppercase"
                    placeholder="ej. NIS, DIRECCION"
                    value={layer.meta?.key || ''}
                    onChange={(e) => {
                      const key = e.target.value.toUpperCase().replace(/\s+/g, '_');
                      emitLive({
                        ...layer,
                        meta: { ...layer.meta, key },
                        name: key || layer.name,
                      });
                    }}
                    onBlur={() => onCommitLive?.()}
                  />
                </label>
                <label className="block">
                  <span className="canvas-label">Si vacío mostrar</span>
                  <input
                    data-testid="canvas-field-fallback-input"
                    className="canvas-input"
                    placeholder="-"
                    value={layer.meta?.fallback ?? '-'}
                    onChange={(e) =>
                      emitLive({ ...layer, meta: { ...layer.meta, fallback: e.target.value } })
                    }
                    onBlur={() => onCommitLive?.()}
                  />
                </label>
              </div>
            )}

            {layer.type === 'logo' && (
              <div className="canvas-section">
                <div className="canvas-section-title">Logo</div>
                <select
                  className="canvas-input"
                  value={layer.meta?.side || 'left'}
                  onChange={(e) => setMeta({ side: e.target.value as 'left' | 'right' })}
                  aria-label="Lado del logo"
                >
                  <option value="left">Izquierdo</option>
                  <option value="right">Derecho</option>
                </select>
                {logoSideConflict && (
                  <p className="mt-1.5 text-[10px] leading-snug" style={{ color: 'var(--cv-text-muted)' }}>
                    Otra capa usa este lado; ambas mostrarán el mismo logo.
                  </p>
                )}
              </div>
            )}

            {layer.type === 'image' && (
              <div className="canvas-section">
                <div className="canvas-section-title">Imagen estática</div>
                <input
                  type="file"
                  accept="image/*"
                  className="canvas-input text-[11px]"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => onChange({ ...layer, value: String(reader.result || '') });
                    reader.readAsDataURL(file);
                  }}
                />
                <label className="mt-2 block text-[11px]" style={{ color: 'var(--cv-text-secondary)' }}>
                  Ajuste
                </label>
                <select
                  className="canvas-input mt-1 text-[11px]"
                  value={layer.cssVars['--object-fit'] || 'cover'}
                  onChange={(e) =>
                    onChange({
                      ...layer,
                      cssVars: { ...layer.cssVars, '--object-fit': e.target.value },
                    })
                  }
                >
                  <option value="cover">Cubrir</option>
                  <option value="contain">Contener</option>
                  <option value="fill">Estirar</option>
                </select>
                <div className="mt-2 flex gap-1">
                  <InlineNumField
                    prefix="Z"
                    value={parseImageZoom(layer.cssVars)}
                    step={0.05}
                    title="Zoom de recorte"
                    onChange={(n) =>
                      setVarLive('--image-zoom', String(Math.min(3, Math.max(1, Math.round(n * 100) / 100))))
                    }
                    onCommit={onCommitLive}
                  />
                </div>
                <label className="mt-2 block text-[11px]" style={{ color: 'var(--cv-text-secondary)' }}>
                  Posición
                </label>
                <select
                  className="canvas-input mt-1 text-[11px]"
                  value={layer.cssVars['--object-position'] || '50% 50%'}
                  aria-label="Posición de imagen"
                  onChange={(e) => setVar('--object-position', e.target.value)}
                >
                  <option value="50% 50%">Centro</option>
                  <option value="0% 0%">Arriba izq.</option>
                  <option value="50% 0%">Arriba</option>
                  <option value="100% 0%">Arriba der.</option>
                  <option value="0% 50%">Izquierda</option>
                  <option value="100% 50%">Derecha</option>
                  <option value="0% 100%">Abajo izq.</option>
                  <option value="50% 100%">Abajo</option>
                  <option value="100% 100%">Abajo der.</option>
                </select>
              </div>
            )}

            {layer.type === 'imageSlot' && (
              <div className="canvas-section">
                <div className="canvas-section-title">Slot de foto</div>
                <NumField
                  label="Índice"
                  value={layer.meta?.index ?? 0}
                  onChange={(n) => setMetaLive({ index: Math.max(0, Math.floor(n)) })}
                  onCommit={onCommitLive}
                />
                <label className="mt-2 block text-[11px]" style={{ color: 'var(--cv-text-secondary)' }}>
                  Ajuste
                </label>
                <select
                  className="canvas-input mt-1 text-[11px]"
                  value={layer.cssVars['--object-fit'] || 'cover'}
                  onChange={(e) => setVar('--object-fit', e.target.value)}
                >
                  <option value="cover">Cubrir</option>
                  <option value="contain">Contener</option>
                  <option value="fill">Estirar</option>
                </select>
                <div className="mt-2 flex gap-1">
                  <InlineNumField
                    prefix="Z"
                    value={parseImageZoom(layer.cssVars)}
                    step={0.05}
                    title="Zoom de recorte"
                    onChange={(n) =>
                      setVarLive('--image-zoom', String(Math.min(3, Math.max(1, Math.round(n * 100) / 100))))
                    }
                    onCommit={onCommitLive}
                  />
                </div>
                <label className="mt-2 block text-[11px]" style={{ color: 'var(--cv-text-secondary)' }}>
                  Posición
                </label>
                <select
                  className="canvas-input mt-1 text-[11px]"
                  value={layer.cssVars['--object-position'] || '50% 50%'}
                  aria-label="Posición de foto"
                  onChange={(e) => setVar('--object-position', e.target.value)}
                >
                  <option value="50% 50%">Centro</option>
                  <option value="0% 0%">Arriba izq.</option>
                  <option value="50% 0%">Arriba</option>
                  <option value="100% 0%">Arriba der.</option>
                  <option value="0% 50%">Izquierda</option>
                  <option value="100% 50%">Derecha</option>
                  <option value="0% 100%">Abajo izq.</option>
                  <option value="50% 100%">Abajo</option>
                  <option value="100% 100%">Abajo der.</option>
                </select>
                <label className="mt-2 flex items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={!!layer.meta?.showDate}
                    onChange={(e) => setMeta({ showDate: e.target.checked })}
                  />
                  Mostrar fecha
                </label>
                <label className="mt-1 flex items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={!!layer.meta?.showCoords}
                    onChange={(e) => setMeta({ showCoords: e.target.checked })}
                  />
                  Mostrar coords
                </label>
                <label className="mt-1 flex items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={!!layer.meta?.showFilename}
                    onChange={(e) => setMeta({ showFilename: e.target.checked })}
                  />
                  Mostrar nombre archivo
                </label>
              </div>
            )}

            {layer.type === 'grid' && (
              <div className="canvas-section">
                <div className="canvas-section-title">Cuadrícula</div>
                <div className="flex gap-2">
                  <NumField
                    label="Cols"
                    value={layer.meta?.cols ?? 2}
                    onChange={(n) => setMetaLive({ cols: Math.max(1, Math.floor(n)) })}
                    onCommit={onCommitLive}
                  />
                  <NumField
                    label="Rows"
                    value={layer.meta?.rows ?? 2}
                    onChange={(n) => setMetaLive({ rows: Math.max(1, Math.floor(n)) })}
                    onCommit={onCommitLive}
                  />
                </div>
                <div className="mt-2">
                  <NumField
                    label="Gap"
                    value={layer.meta?.gapMm ?? 2}
                    onChange={(n) => setMetaLive({ gapMm: Math.max(0, n) })}
                    onCommit={onCommitLive}
                    suffix="mm"
                  />
                </div>
              </div>
            )}

            {layer.type === 'checkbox' && (
              <div className="canvas-section">
                <div className="canvas-section-title">Casilla</div>
                <input
                  className="canvas-input mb-2 uppercase"
                  placeholder="Clave Excel"
                  value={layer.meta?.key || ''}
                  onChange={(e) => setMeta({ key: e.target.value.toUpperCase() })}
                />
                <label className="flex items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={!!layer.meta?.checked}
                    onChange={(e) => setMeta({ checked: e.target.checked })}
                  />
                  Marcada (preview)
                </label>
              </div>
            )}

            {layer.type === 'signature' && (
              <div className="canvas-section">
                <div className="canvas-section-title">Firma</div>
                <input
                  className="canvas-input mb-2 uppercase"
                  placeholder="Clave nombre"
                  value={layer.meta?.key || ''}
                  onChange={(e) => setMeta({ key: e.target.value.toUpperCase() })}
                />
                <input
                  className="canvas-input"
                  placeholder="Texto placeholder"
                  value={layer.value}
                  onChange={(e) => onChange({ ...layer, value: e.target.value })}
                />
              </div>
            )}

            {layer.type === 'table' && (
              <div className="canvas-section">
                <div className="canvas-section-title">Tabla (JSON)</div>
                <textarea
                  className="canvas-input !h-auto py-1.5 font-mono text-[10px]"
                  rows={6}
                  value={layer.meta?.rowsData || ''}
                  onChange={(e) => setMeta({ rowsData: e.target.value })}
                />
              </div>
            )}

            {shape && (
              <div className="canvas-section">
                <label className="block">
                  <span className="canvas-label">Nombre</span>
                  <input
                    className="canvas-input"
                    value={layer.name}
                    onChange={(e) => onChange({ ...layer, name: e.target.value })}
                  />
                </label>
                <div className="mt-2 flex gap-1">
                  <WithHoverTooltip label="Al frente" placement="bottom" variant="dark">
                    <button type="button" className="canvas-icon-btn" aria-label="Al frente" onClick={onBringFront}>
                      <ArrowUpToLine className="h-3.5 w-3.5" />
                    </button>
                  </WithHoverTooltip>
                  <WithHoverTooltip label="Adelante" placement="bottom" variant="dark">
                    <button type="button" className="canvas-icon-btn" aria-label="Adelante" onClick={onBringForward}>
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                  </WithHoverTooltip>
                  <WithHoverTooltip label="Atrás" placement="bottom" variant="dark">
                    <button type="button" className="canvas-icon-btn" aria-label="Atrás" onClick={onSendBackward}>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </WithHoverTooltip>
                  <WithHoverTooltip label="Al fondo" placement="bottom" variant="dark">
                    <button type="button" className="canvas-icon-btn" aria-label="Al fondo" onClick={onSendBack}>
                      <ArrowDownToLine className="h-3.5 w-3.5" />
                    </button>
                  </WithHoverTooltip>
                </div>
              </div>
            )}

            <div className="p-3">
              <button
                type="button"
                className="canvas-danger-btn flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-[12px] transition-colors"
                onClick={() => onDelete(layer.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Eliminar capa
              </button>
            </div>
          </div>
      )}
    </aside>
  );
});
