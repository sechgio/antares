import { memo, useEffect, useRef, useState, type HTMLAttributes } from 'react';
import {
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  Eye,
  EyeOff,
  Lock,
  PanelRightClose,
  Trash2,
  Unlock,
} from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import type { CanvasLayer, CanvasSharedStyle, CanvasStyleKind } from '../types';
import InlineNumField from './InlineNumField';
import {
  applyLineStrokeWeight,
  clampStrokeWeight,
  isShapeLayer,
  layerPanelTitle,
  lineStrokeWidthPx,
  rememberStrokeWeight,
  STROKE_WEIGHT_MAX_PX,
  STROKE_WEIGHT_MIN_PX,
} from '../ops/layerStyle';
import { exportSelectionPng } from '../ops/exportPng';
import { clipPathForLayerType } from '../ops/shapePaths';
import TemplatesSection from './TemplatesSection';
import StylesSection from './StylesSection';
import { ALIGN_ITEMS, BulkOpacityField, SectionHeader, ZOrderButtons } from './panels/shared';
import PositionSection from './panels/common/PositionSection';
import DispositionSection from './panels/common/DispositionSection';
import AppearanceSection from './panels/common/AppearanceSection';
import FillSection from './panels/common/FillSection';
import StrokeSection from './panels/common/StrokeSection';
import EffectsSection from './panels/common/EffectsSection';
import ExportSection from './panels/common/ExportSection';
import ShapeSection from './panels/tails/ShapeSection';
import { TAIL_SECTIONS } from './panels/registry';
import type { SectionProps, ZOrderCallbacks } from './panels/types';
import CanvasSelect from './CanvasSelect';

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
  /** Nudge multi-selection by dx/dy mm (shared X/Y fields). */
  onNudgeSelection?: (dxMm: number, dyMm: number) => void;
  /** Selection AABB origin for multi-select X/Y fields. */
  selectionOrigin?: { x: number; y: number } | null;
  onBulkVisible: (visible: boolean) => void;
  onBulkLocked: (locked: boolean) => void;
  onBulkOpacity: (opacity: number) => void;
  /** Current opacity for multi-selection: a number when all selected layers share
   * the same opacity, or `null` when they differ (mixed). Undefined falls back
   * to the legacy default of 100. */
  bulkOpacityValue?: number | null;
  onBringFront: () => void;
  onBringForward: () => void;
  onSendBack: () => void;
  onSendBackward: () => void;
  /** Apply a canvas preset when nothing is selected. */
  onApplyPreset?: (presetId: string) => void;
  /** Shared document styles catalog. */
  documentStyles?: CanvasSharedStyle[];
  onCreateStyle?: (kind: CanvasStyleKind) => void;
  onApplyStyle?: (styleId: string) => void;
  onDetachStyle?: (kind: CanvasStyleKind) => void;
  onRemoveStyle?: (styleId: string) => void;
  onRenameStyle?: (styleId: string, name: string) => void;
  /** True when another logo layer shares this layer's side. */
  logoSideConflict?: boolean;
  /** Mount point for viewport ZoomMenu (portal from DesignStage). */
  zoomSlotRef?: (el: HTMLDivElement | null) => void;
  /** When false, panel collapses via CSS but stays mounted. */
  open?: boolean;
  /** Hide this sidebar (next to zoom). */
  onHidePanel?: () => void;
  hidePanelDisabled?: boolean;
}

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
  onNudgeSelection,
  selectionOrigin = null,
  onBulkVisible,
  onBulkLocked,
  onBulkOpacity,
  bulkOpacityValue,
  onBringFront,
  onBringForward,
  onSendBack,
  onSendBackward,
  onApplyPreset,
  documentStyles = [],
  onCreateStyle,
  onApplyStyle,
  onDetachStyle,
  onRemoveStyle,
  onRenameStyle,
  logoSideConflict = false,
  zoomSlotRef,
  open = true,
  onHidePanel,
  hidePanelDisabled = false,
}: RightPanelProps) {
  const [exportScale, setExportScale] = useState(1);
  const [exporting, setExporting] = useState(false);

  // Latest layer for live edits: props lag behind rapid field changes (X then Y),
  // so setVarLive must accumulate on the last emit, not the stale prop snapshot.
  const liveLayerRef = useRef<CanvasLayer | null>(layer);
  useEffect(() => {
    liveLayerRef.current = layer;
  }, [layer]);

  const emitLive = (next: CanvasLayer) => {
    liveLayerRef.current = next;
    if (onChangeLive) onChangeLive(next);
    else onChange(next);
  };

  const mapLive = (fn: (current: CanvasLayer) => CanvasLayer) => {
    const base = liveLayerRef.current;
    if (!base) return;
    emitLive(fn(base));
  };

  const setVar = (key: string, value: string) => {
    if (!layer) return;
    onChange({ ...layer, cssVars: { ...layer.cssVars, [key]: value } });
  };

  const setVarLive = (key: string, value: string) => {
    const base = liveLayerRef.current;
    if (!base) return;
    emitLive({ ...base, cssVars: { ...base.cssVars, [key]: value } });
  };

  const setVars = (patch: Record<string, string>) => {
    if (!layer) return;
    onChange({ ...layer, cssVars: { ...layer.cssVars, ...patch } });
  };

  const setVarsLive = (patch: Record<string, string>) => {
    const base = liveLayerRef.current;
    if (!base) return;
    emitLive({ ...base, cssVars: { ...base.cssVars, ...patch } });
  };

  const setMeta = (patch: NonNullable<CanvasLayer['meta']>) => {
    if (!layer) return;
    onChange({ ...layer, meta: { ...layer.meta, ...patch } });
  };

  const setMetaLive = (patch: NonNullable<CanvasLayer['meta']>) => {
    const base = liveLayerRef.current;
    if (!base) return;
    emitLive({ ...base, meta: { ...base.meta, ...patch } });
  };

  const hasSelection = Boolean(layer && layer.type !== 'frame');
  const shape = layer ? isShapeLayer(layer) : false;
  const isLine = layer?.type === 'line';
  const showRadius = layer ? !clipPathForLayerType(layer.type) && layer.type !== 'line' : false;
  const hasFill = Boolean(
    layer &&
      !isLine &&
      layer.cssVars['--background-color'] !== 'transparent' &&
      layer.cssVars['--fill-visible'] !== '0',
  );
  const hasStroke = Boolean(
    layer &&
      layer.cssVars['--stroke-visible'] !== '0' &&
      (isLine || parseFloat(layer.cssVars['--border-width'] || '0') > 0),
  );
  const strokeWeightPx = layer
    ? isLine
      ? lineStrokeWidthPx(layer)
      : clampStrokeWeight(parseFloat(layer.cssVars['--border-width'] || '0') || 0)
    : 0;
  const strokeWeightPct = Math.max(
    0,
    Math.min(
      100,
      ((strokeWeightPx - STROKE_WEIGHT_MIN_PX) / (STROKE_WEIGHT_MAX_PX - STROKE_WEIGHT_MIN_PX)) * 100,
    ),
  );

  const setStrokeWeight = (raw: number) => {
    const base = liveLayerRef.current;
    if (!base) return;
    if (base.type === 'line') {
      emitLive(applyLineStrokeWeight(base, raw));
      return;
    }
    const px = clampStrokeWeight(raw);
    rememberStrokeWeight(px);
    setVarLive('--border-width', `${px}px`);
  };

  const zOrder: ZOrderCallbacks = { onBringFront, onBringForward, onSendBack, onSendBackward };

  const sectionProps: SectionProps = {
    layer: layer as CanvasLayer,
    pageColors,
    onChange,
    emitLive,
    mapLive,
    setVar,
    setVarLive,
    setVars,
    setVarsLive,
    setMeta,
    setMetaLive,
    onCommitLive,
    onAlign,
    logoSideConflict,
    zOrder,
    shape,
    isLine: Boolean(isLine),
    showRadius,
    hasFill,
    hasStroke,
    strokeWeightPx,
    strokeWeightPct,
    setStrokeWeight,
    exportScale,
    setExportScale,
    exporting,
    setExporting,
  };

  return (
    <aside
      className={
        open
          ? 'canvas-panel-chrome flex h-full w-[272px] shrink-0 flex-col overflow-hidden border-l'
          : 'canvas-panel-chrome flex h-full w-0 min-w-0 shrink-0 flex-col overflow-hidden border-l-0'
      }
      style={{ background: 'var(--cv-panel)', borderColor: 'var(--cv-border)' }}
      data-open={open ? 'true' : 'false'}
      data-testid="canvas-right-panel"
      aria-hidden={!open}
      {...(!open ? ({ inert: '' } as HTMLAttributes<HTMLElement>) : {})}
    >
      <div
        className="relative z-20 flex items-center justify-between gap-2 border-b px-4 py-3"
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
          {onHidePanel && (
            <WithHoverTooltip label="Ocultar panel derecho" placement="bottom" variant="dark">
              <button
                type="button"
                className="canvas-icon-btn !h-7 !w-7 shrink-0"
                data-testid="canvas-toggle-right-panel"
                disabled={hidePanelDisabled}
                onClick={onHidePanel}
                aria-label="Ocultar panel derecho"
              >
                <PanelRightClose className="h-3.5 w-3.5" />
              </button>
            </WithHoverTooltip>
          )}
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
        <div className="border-b px-4 py-3" style={{ borderColor: 'var(--cv-border)' }}>
          <TemplatesSection onApplyPreset={onApplyPreset} tooltipPlacement="left" />
        </div>
      )}

      {selectedCount === 1 &&
        onCreateStyle &&
        onApplyStyle &&
        onDetachStyle &&
        onRemoveStyle &&
        onRenameStyle && (
          <div className="border-b px-4 py-3" style={{ borderColor: 'var(--cv-border)' }}>
            <StylesSection
              styles={documentStyles}
              layer={layer}
              canLink={Boolean(layer && layer.type !== 'frame' && !layer.locked)}
              onCreate={onCreateStyle}
              onApply={onApplyStyle}
              onDetach={onDetachStyle}
              onRemove={onRemoveStyle}
              onRename={onRenameStyle}
            />
          </div>
        )}

      {selectedCount > 1 && (
        <div className="canvas-section">
          <div className="canvas-section-title">Alinear ({selectedCount})</div>
          {selectionOrigin && onNudgeSelection && (
            <div className="mb-2 flex gap-2">
              <InlineNumField
                prefix="X"
                value={selectionOrigin.x}
                onChange={(n) => onNudgeSelection(n - selectionOrigin.x, 0)}
                step={0.1}
                suffix="mm"
              />
              <InlineNumField
                prefix="Y"
                value={selectionOrigin.y}
                onChange={(n) => onNudgeSelection(0, n - selectionOrigin.y)}
                step={0.1}
                suffix="mm"
              />
            </div>
          )}
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
            <ZOrderButtons
              onBringFront={onBringFront}
              onBringForward={onBringForward}
              onSendBackward={onSendBackward}
              onSendBack={onSendBack}
            />
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
          <BulkOpacityField
            value={bulkOpacityValue}
            onCommit={onBulkOpacity}
            selectionKey={selectedIds.join(',')}
          />
          <div className="mt-2 flex gap-2">
            <CanvasSelect
              value={String(exportScale)}
              onChange={(val) => setExportScale(Number(val))}
              aria-label="Escala de exportación"
              options={[
                { value: '1', label: '1x' },
                { value: '2', label: '2x' },
              ]}
            />
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
          <PositionSection {...sectionProps} />
          <DispositionSection {...sectionProps} />
          <AppearanceSection {...sectionProps} />
          <FillSection {...sectionProps} />
          <StrokeSection {...sectionProps} />
          <EffectsSection {...sectionProps} />
          <ExportSection {...sectionProps} />

          {/* Non-shape name + z-order block. Lives inline (not in the tail
              registry) because it uses live/commit coalescing on the name
              input, while the shape variant below commits directly via
              onChange. Keeping the two subtle variants separate preserves
              their behavior exactly. */}
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
                <ZOrderButtons
                  onBringFront={onBringFront}
                  onBringForward={onBringForward}
                  onSendBackward={onSendBackward}
                  onSendBack={onSendBack}
                />
              </div>
            </div>
          )}

          {/* Type-specific tails. Render ALL matching entries (in order) so a
              `field` layer renders Texto followed by Campo Excel, matching
              the original single-selection body order. */}
          {TAIL_SECTIONS.filter((s) => s.test(layer)).map((s, i) => (
            <s.Component key={i} {...sectionProps} />
          ))}

          {/* Shape name + z-order block (commits directly via onChange). */}
          {shape && <ShapeSection {...sectionProps} />}

          <div className="px-4 py-4">
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
