import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  ChevronDown,
  Lock,
  PanelRightClose,
  Trash2,
  Unlock,
} from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import type { CanvasDocument, CanvasLayer, CanvasSharedStyle, CanvasStyleKind } from '../types';
import InlineNumField from './InlineNumField';
import { EyeSlash, VisibilityIcon } from './VisibilityIcon';
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
import { ALIGN_ITEMS, BulkOpacityField, ZOrderButtons } from './panels/shared';
import PositionSection from './panels/common/PositionSection';
import DispositionSection from './panels/common/DispositionSection';
import AppearanceSection from './panels/common/AppearanceSection';
import FillSection from './panels/common/FillSection';
import StrokeSection from './panels/common/StrokeSection';
import EffectsSection from './panels/common/EffectsSection';
import ExportSection from './panels/common/ExportSection';
import ShapeSection from './panels/tails/ShapeSection';
import { TAIL_SECTIONS, LAYOUT_SECTIONS } from './panels/registry';
import type { SectionProps, ZOrderCallbacks } from './panels/types';
import CanvasSelect from './CanvasSelect';
import CanvasVersionsPanel from './CanvasVersionsPanel';

interface RightPanelProps {
  documentId?: string;
  onVersionRestored?: (doc: CanvasDocument) => void;
  layer: CanvasLayer | null;
  selectedCount: number;
  selectedIds?: string[];
  pageColors: string[];
  onChange: (layer: CanvasLayer) => void;
  /** Replace the full layer list (multi-layer panel commits such as boolean compose). */
  onReplaceLayers?: (layers: CanvasLayer[]) => void;
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
  /** All layers (component master resolution for instances). */
  layers?: CanvasLayer[];
  /** Create an instance of the selected component master. */
  onInstantiateComponent?: () => void;
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

function InspectorGroup({
  title,
  description,
  children,
  testId,
  defaultOpen = true,
}: {
  title: string;
  description: string;
  children: ReactNode;
  testId: string;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <details
      className="canvas-inspector-group"
      data-open={isOpen ? 'true' : 'false'}
      data-testid={testId}
      open={isOpen}
    >
      <summary
        className="canvas-inspector-group-summary"
        onClick={(event) => {
          event.preventDefault();
          setIsOpen((current) => !current);
        }}
      >
        <span className="canvas-inspector-group-heading">
          <span className="canvas-inspector-group-title">{title}</span>
          <span className="canvas-inspector-group-description">{description}</span>
        </span>
        <ChevronDown className="canvas-inspector-group-chevron" aria-hidden="true" />
      </summary>
      <div className="canvas-inspector-group-content">{children}</div>
    </details>
  );
}

export default memo(function RightPanel({
  documentId,
  onVersionRestored,
  layer,
  selectedCount,
  selectedIds = [],
  pageColors,
  onChange,
  onReplaceLayers,
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
  layers = [],
  onInstantiateComponent,
  logoSideConflict = false,
  zoomSlotRef,
  open = true,
  onHidePanel,
  hidePanelDisabled = false,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<'properties' | 'versions'>('properties');
  const [exporting, setExporting] = useState(false);
  const [exportScale, setExportScale] = useState(1);
  const inspectorScrollRef = useRef<HTMLDivElement>(null);

  // Latest layer for live edits: props lag behind rapid field changes (X then Y),
  // so setVarLive must accumulate on the last emit, not the stale prop snapshot.
  const liveLayerRef = useRef<CanvasLayer | null>(layer);
  useEffect(() => {
    liveLayerRef.current = layer;
  }, [layer]);

  useEffect(() => {
    if (inspectorScrollRef.current) inspectorScrollRef.current.scrollTop = 0;
  }, [layer?.id, selectedCount]);

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

  const hasSelection = Boolean(layer && !(layer.type === 'frame' && layer.locked));
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
  const layoutSections = layer ? LAYOUT_SECTIONS.filter((s) => s.test(layer)) : [];
  const tailSections = layer ? TAIL_SECTIONS.filter((s) => s.test(layer)) : [];

  const sectionProps: SectionProps = {
    layer: layer as CanvasLayer,
    pageColors,
    layers,
    selectedIds,
    onChange,
    onReplaceLayers,
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
    onInstantiateComponent,
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
          ? 'canvas-panel canvas-panel-chrome canvas-panel-chrome--right flex h-full w-[272px] shrink-0 flex-col overflow-hidden border-l'
          : 'canvas-panel canvas-panel-chrome canvas-panel-chrome--right flex h-full w-0 min-w-0 shrink-0 flex-col overflow-hidden border-l-0'
      }
      data-open={open ? 'true' : 'false'}
      data-testid="canvas-right-panel"
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div
        className="canvas-right-panel-header relative z-20 flex items-center gap-2 border-b px-4 py-2"
        style={{ borderColor: 'var(--cv-border)' }}
      >
        <div className="canvas-right-panel-tabs flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('properties')}
            className={`canvas-right-panel-tab min-w-0 flex-1 px-2 py-1 text-xs font-semibold rounded transition-colors ${
              activeTab === 'properties'
                ? 'bg-[var(--cv-bg-hover)] text-[var(--cv-text)]'
                : 'text-[var(--cv-text-muted)] hover:text-[var(--cv-text)]'
            }`}
            title={
              selectedCount > 1
                ? `${selectedCount} seleccionados`
                : hasSelection && layer
                  ? layerPanelTitle(layer)
                  : 'Propiedades'
            }
          >
            <span className="block truncate">
              {selectedCount > 1
                ? `${selectedCount} seleccionados`
                : hasSelection && layer
                  ? layerPanelTitle(layer)
                  : 'Propiedades'}
            </span>
          </button>
          {documentId && (
            <button
              type="button"
              onClick={() => setActiveTab('versions')}
              className={`canvas-right-panel-tab shrink-0 px-2 py-1 text-xs font-semibold rounded transition-colors ${
                activeTab === 'versions'
                  ? 'bg-[var(--cv-bg-hover)] text-[var(--cv-text)]'
                  : 'text-[var(--cv-text-muted)] hover:text-[var(--cv-text)]'
              }`}
            >
              Versiones
            </button>
          )}
          <div
            ref={zoomSlotRef}
            className="relative shrink-0"
            data-testid="canvas-zoom-slot"
          />
          {onHidePanel && (
            <WithHoverTooltip label="Ocultar panel derecho" placement="bottom" variant="dark">
              <button
                type="button"
                className="canvas-icon-btn shrink-0"
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
        {activeTab === 'properties' && hasSelection && layer && selectedCount === 1 && (
          <div className="canvas-right-panel-actions flex shrink-0 items-center gap-0.5">
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
                <VisibilityIcon visible={layer.visible !== false} className="h-3.5 w-3.5" />
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

      {activeTab === 'properties' && (selectedCount > 1 || (hasSelection && layer)) && (
        <div className="canvas-inspector-context" data-testid="canvas-inspector-context">
          <span className="canvas-inspector-context-label">
            {selectedCount > 1 ? 'Edición múltiple' : 'Edición de capa'}
          </span>
          <span className="canvas-inspector-context-detail" title={selectedCount > 1 ? `${selectedCount} capas seleccionadas` : undefined}>
            {selectedCount > 1
              ? `${selectedCount} capas seleccionadas`
              : `Capa seleccionada: ${layer ? layerPanelTitle(layer) : 'Capa'}`}
          </span>
        </div>
      )}

      {activeTab === 'versions' && documentId ? (
        <CanvasVersionsPanel documentId={documentId} onVersionRestored={onVersionRestored} />
      ) : (
        <>
          {selectedCount === 0 && onApplyPreset && (
            <div className="border-b px-4 py-3" style={{ borderColor: 'var(--cv-border)' }}>
              <TemplatesSection onApplyPreset={onApplyPreset} tooltipPlacement="left" />
            </div>
          )}

      {selectedCount > 1 && (
        <>
          <div className="canvas-inspector-priority-hint" data-testid="canvas-inspector-priority-hint">
            <span className="canvas-inspector-priority-label">Acciones principales</span>
            <span>Alinear, distribuir y ordenar</span>
          </div>
          <InspectorGroup
            title="Transformación"
            description="Alinear y distribuir"
            testId="canvas-inspector-group-transform"
          >
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
              <div className="mt-3">
                <span className="canvas-sublabel">Distribución Equitativa</span>
                {selectedCount < 3 && (
                  <p className="canvas-distribution-hint" data-testid="canvas-distribution-hint">
                    Selecciona al menos 3 objetos para distribuirlos.
                  </p>
                )}
                <div className="flex gap-1">
                  <WithHoverTooltip
                    label={
                      selectedCount >= 3
                        ? 'Espaciado uniforme horizontal'
                        : 'Espaciado uniforme horizontal (requiere al menos 3 objetos)'
                    }
                    placement="bottom"
                    variant="dark"
                  >
                    <button
                      type="button"
                      className="canvas-icon-btn"
                      aria-label="Espaciado uniforme horizontal"
                      data-testid="canvas-distribute-horizontal"
                      disabled={selectedCount < 3}
                      onClick={() => onDistribute('horizontal')}
                    >
                      <AlignHorizontalDistributeCenter className="h-3.5 w-3.5" />
                    </button>
                  </WithHoverTooltip>
                  <WithHoverTooltip
                    label={
                      selectedCount >= 3
                        ? 'Espaciado uniforme vertical'
                        : 'Espaciado uniforme vertical (requiere al menos 3 objetos)'
                    }
                    placement="bottom"
                    variant="dark"
                  >
                    <button
                      type="button"
                      className="canvas-icon-btn"
                      aria-label="Espaciado uniforme vertical"
                      data-testid="canvas-distribute-vertical"
                      disabled={selectedCount < 3}
                      onClick={() => onDistribute('vertical')}
                    >
                      <AlignVerticalDistributeCenter className="h-3.5 w-3.5" />
                    </button>
                  </WithHoverTooltip>
                </div>
              </div>
            </div>
          </InspectorGroup>
          <InspectorGroup
            title="Capa"
            description="Orden, visibilidad y opacidad"
            testId="canvas-inspector-group-layer"
          >
            <div className="canvas-section">
              <div className="mt-0 flex gap-1">
                <ZOrderButtons
                  onBringFront={onBringFront}
                  onBringForward={onBringForward}
                  onSendBackward={onSendBackward}
                  onSendBack={onSendBack}
                />
                <WithHoverTooltip label="Mostrar" placement="bottom" variant="dark">
                  <button type="button" className="canvas-icon-btn" aria-label="Mostrar" onClick={() => onBulkVisible(true)}>
                    <VisibilityIcon visible className="h-3.5 w-3.5" />
                  </button>
                </WithHoverTooltip>
                <WithHoverTooltip label="Ocultar" placement="bottom" variant="dark">
                  <button type="button" className="canvas-icon-btn" aria-label="Ocultar" onClick={() => onBulkVisible(false)}>
                    <EyeSlash className="h-3.5 w-3.5" />
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
            </div>
          </InspectorGroup>
          <InspectorGroup
            title="Avanzado"
            description="Exportar selección"
            testId="canvas-inspector-group-advanced"
            defaultOpen={false}
          >
            <div className="canvas-section">
              <div className="flex gap-2">
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
          </InspectorGroup>
        </>
      )}

      {hasSelection && layer && selectedCount === 1 && (
        <div ref={inspectorScrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="canvas-inspector-priority-hint" data-testid="canvas-inspector-priority-hint">
            <span className="canvas-inspector-priority-label">Acciones principales</span>
            <span>Posición, tamaño y apariencia</span>
          </div>

          <InspectorGroup
            title="Capa"
            description="Nombre y orden"
            testId="canvas-inspector-group-layer"
          >
            {shape ? (
              <ShapeSection {...sectionProps} />
            ) : (
              <div className="canvas-section">
                <label className="block">
                  <span className="canvas-label">Nombre</span>
                  <input
                    className="canvas-input mb-2"
                    value={layer.name}
                    onChange={(e) => emitLive({ ...layer, name: e.target.value })}
                    onBlur={() => onCommitLive?.()}
                  />
                </label>
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
          </InspectorGroup>

          <InspectorGroup
            title="Transformación"
            description="Posición, tamaño y orientación"
            testId="canvas-inspector-group-transform"
          >
            <PositionSection {...sectionProps} />
            <DispositionSection {...sectionProps} />
          </InspectorGroup>

          {tailSections.length > 0 && (
            <InspectorGroup
              title="Contenido"
              description="Propiedades específicas de la capa"
              testId="canvas-inspector-group-content"
            >
              {tailSections.map((s, i) => (
                <s.Component key={`tail-${i}`} {...sectionProps} />
              ))}
            </InspectorGroup>
          )}

          {layoutSections.length > 0 && (
            <InspectorGroup
              title="Estructura"
              description="Auto-layout, restricciones y componentes"
              testId="canvas-inspector-group-structure"
            >
              {layoutSections.map((s, i) => (
                <s.Component key={`layout-${i}`} {...sectionProps} />
              ))}
            </InspectorGroup>
          )}

          <InspectorGroup
            title="Estilo visual"
            description="Opacidad, relleno, trazo y efectos"
            testId="canvas-inspector-group-appearance"
          >
            <AppearanceSection {...sectionProps} />
            <FillSection {...sectionProps} />
            <StrokeSection {...sectionProps} />
            <EffectsSection {...sectionProps} />
          </InspectorGroup>

          <InspectorGroup
            title="Avanzado"
            description="Exportación, estilos y eliminación"
            testId="canvas-inspector-group-advanced"
            defaultOpen={false}
          >
            <ExportSection {...sectionProps} />

            {onCreateStyle &&
              onApplyStyle &&
              onDetachStyle &&
              onRemoveStyle &&
              onRenameStyle && (
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
              )}

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
          </InspectorGroup>
        </div>
      )}
        </>
      )}
    </aside>
  );
});
