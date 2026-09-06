import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  ChevronRight,
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
  onReplaceLayers?: (layers: CanvasLayer[]) => void;
  onChangeLive?: (layer: CanvasLayer) => void;
  onCommitLive?: () => void;
  onDelete: (id: string) => void;
  onAlign: (align: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onNudgeSelection?: (dxMm: number, dyMm: number) => void;
  selectionOrigin?: { x: number; y: number } | null;
  onBulkVisible: (visible: boolean) => void;
  onBulkLocked: (locked: boolean) => void;
  onBulkOpacity: (opacity: number) => void;
  bulkOpacityValue?: number | null;
  onBringFront: () => void;
  onBringForward: () => void;
  onSendBack: () => void;
  onSendBackward: () => void;
  onApplyPreset?: (presetId: string) => void;
  onNewFromPreset?: (presetId: string, label: string) => void;
  documentStyles?: CanvasSharedStyle[];
  onCreateStyle?: (kind: CanvasStyleKind) => void;
  onApplyStyle?: (styleId: string) => void;
  onDetachStyle?: (kind: CanvasStyleKind) => void;
  onRemoveStyle?: (styleId: string) => void;
  onRenameStyle?: (styleId: string, name: string) => void;
  layers?: CanvasLayer[];
  onInstantiateComponent?: () => void;
  logoSideConflict?: boolean;
  zoomSlotRef?: (el: HTMLDivElement | null) => void;
  open?: boolean;
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
        title={description}
        onClick={(event) => {
          event.preventDefault();
          setIsOpen((current) => !current);
        }}
      >
        <ChevronRight className="canvas-inspector-group-chevron" aria-hidden="true" />
        <span className="canvas-inspector-group-heading">
          <span className="canvas-inspector-group-title">{title}</span>
          <span className="canvas-inspector-group-description">{description}</span>
        </span>
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
  onNewFromPreset,
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
        className="canvas-right-panel-header relative z-20 flex items-center border-b"
        style={{ borderColor: 'var(--cv-border)' }}
      >
        <div className="canvas-right-panel-tabs min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setActiveTab('properties')}
            aria-pressed={activeTab === 'properties'}
            className="canvas-right-panel-tab"
          >
            Diseño
          </button>
          {documentId && (
            <button
              type="button"
              onClick={() => setActiveTab('versions')}
              aria-pressed={activeTab === 'versions'}
              className="canvas-right-panel-tab"
            >
              Versiones
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center">
          <div ref={zoomSlotRef} className="relative shrink-0" data-testid="canvas-zoom-slot" />
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
      </div>

      {activeTab === 'properties' && (selectedCount > 1 || (hasSelection && layer)) && (
        <div className="canvas-inspector-identity">
          <div className="canvas-inspector-context" data-testid="canvas-inspector-context">
            <span className="sr-only">
              {selectedCount > 1 ? 'Edición múltiple' : 'Edición de capa'}
            </span>
            <span className="sr-only" title={selectedCount > 1 ? `${selectedCount} capas seleccionadas` : undefined}>
              {selectedCount > 1
                ? `${selectedCount} capas seleccionadas`
                : `Capa seleccionada: ${layer ? layerPanelTitle(layer) : 'Capa'}`}
            </span>
            {selectedCount > 1 ? (
              <span className="canvas-inspector-identity-name">{selectedCount} capas</span>
            ) : (
              <input
                className="canvas-inspector-identity-input"
                value={layer?.name ?? ''}
                aria-label="Nombre de capa"
                onChange={(e) => mapLive((current) => ({ ...current, name: e.target.value }))}
                onBlur={() => onCommitLive?.()}
              />
            )}
            {hasSelection && layer && selectedCount === 1 && (
              <div className="canvas-right-panel-actions shrink-0">
                <WithHoverTooltip
                  label={layer.visible !== false ? 'Ocultar' : 'Mostrar'}
                  placement="bottom"
                  variant="dark"
                >
                  <button
                    type="button"
                    className="canvas-icon-btn"
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
                    className="canvas-icon-btn"
                    aria-label="Bloquear"
                    onClick={() => onChange({ ...layer, locked: !layer.locked })}
                  >
                    {layer.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                  </button>
                </WithHoverTooltip>
              </div>
            )}
          </div>
          {hasSelection && layer && selectedCount === 1 && (
            <div
              className="canvas-inspector-layer-tools"
              data-testid="canvas-inspector-group-layer"
              data-open="true"
            >
              <div className="canvas-z-order">
                <ZOrderButtons
                  onBringFront={onBringFront}
                  onBringForward={onBringForward}
                  onSendBackward={onSendBackward}
                  onSendBack={onSendBack}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'versions' && documentId ? (
        <CanvasVersionsPanel documentId={documentId} onVersionRestored={onVersionRestored} />
      ) : (
        <>
          {selectedCount === 0 && onApplyPreset && (
            <div className="border-b px-3 py-3" style={{ borderColor: 'var(--cv-border)' }}>
              <TemplatesSection
                onApplyPreset={onApplyPreset}
                onNewFromPreset={onNewFromPreset}
                tooltipPlacement="left"
              />
            </div>
          )}

      {selectedCount > 1 && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="canvas-section" data-testid="canvas-inspector-group-transform">
            <SectionHeader title="Posición" />
            <div className="canvas-inspector-stack">
              {selectionOrigin && onNudgeSelection && (
                <div className="flex gap-1.5">
                  <InlineNumField
                    prefix="X"
                    value={selectionOrigin.x}
                    onChange={(n) => onNudgeSelection(n - selectionOrigin.x, 0)}
                    onCommit={onCommitLive}
                    step={0.1}
                    suffix="mm"
                  />
                  <InlineNumField
                    prefix="Y"
                    value={selectionOrigin.y}
                    onChange={(n) => onNudgeSelection(0, n - selectionOrigin.y)}
                    onCommit={onCommitLive}
                    step={0.1}
                    suffix="mm"
                  />
                </div>
              )}
              <div className="canvas-alignment-tools" role="group" aria-label="Alinear selección">
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
              <div>
                {selectedCount < 3 && (
                  <p className="canvas-distribution-hint" data-testid="canvas-distribution-hint">
                    Selecciona al menos 3 objetos para distribuirlos.
                  </p>
                )}
                <div className="canvas-z-order canvas-z-order--compact">
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
          </div>
          <div className="canvas-section" data-testid="canvas-inspector-group-layer" data-open="true">
            <SectionHeader title="Capa" />
            <div className="canvas-inspector-stack">
              <div className="canvas-selection-actions">
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
          </div>
          <InspectorGroup
            title="Avanzado"
            description="Exportar selección"
            testId="canvas-inspector-group-advanced"
            defaultOpen={false}
          >
            <div className="canvas-section">
              <div className="flex gap-1.5">
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
        </div>
      )}

      {hasSelection && layer && selectedCount === 1 && (
        <div ref={inspectorScrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="canvas-section" data-testid="canvas-inspector-group-transform">
            <SectionHeader title="Posición" />
            <div className="canvas-inspector-stack">
              <PositionSection {...sectionProps} />
              <DispositionSection {...sectionProps} />
            </div>
          </div>

          {tailSections.length > 0 && (
            <div data-testid="canvas-inspector-group-content">
              {tailSections.map((s, i) => (
                <s.Component key={`tail-${i}`} {...sectionProps} />
              ))}
            </div>
          )}

          {layoutSections.length > 0 && (
            <div data-testid="canvas-inspector-group-structure">
              {layoutSections.map((s, i) => (
                <s.Component key={`layout-${i}`} {...sectionProps} />
              ))}
            </div>
          )}

          <div data-testid="canvas-inspector-group-appearance">
            <AppearanceSection {...sectionProps} />
            <FillSection {...sectionProps} />
            <StrokeSection {...sectionProps} />
            <EffectsSection {...sectionProps} />
          </div>

          <ExportSection {...sectionProps} />

          <InspectorGroup
            title="Avanzado"
            description="Estilos y eliminación"
            testId="canvas-inspector-group-advanced"
            defaultOpen={false}
          >
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

            <div className="px-3 py-3">
              <button
                type="button"
                className="canvas-danger-btn flex w-full items-center justify-center gap-2 rounded-md px-3 py-1.5 text-[11px] transition-colors"
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
