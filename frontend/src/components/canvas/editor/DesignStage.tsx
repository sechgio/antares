import { useCallback, useImperativeHandle, useMemo, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { PanelLeft, PanelRight } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import type { CanvasDocument, CanvasGuide, CanvasLayer, CanvasTool } from '../types';
import { A4_HEIGHT_PX, A4_WIDTH_PX } from '../types';
import { MM_TO_PX, type DrawRect } from '../ops/drawHelpers';
import { selectionBounds } from '../ops/selectionTransform';
import { fitZoomForViewport, zoomToFitRectMm } from '../ops/viewportNav';
import { useSmoothViewport } from '../hooks/useSmoothViewport';
import Artboard from './Artboard';
import ZoomMenu from './ZoomMenu';

export type ViewportNavApi = {
  getZoom: () => number;
  setZoom: (zoom: number | ((prev: number) => number)) => void;
  setPan: (pan: { x: number; y: number }) => void;
  zoomToFit: () => void;
  zoomToSelection: (ids?: string[]) => void;
  /** Animated viewport transition (Figma-like smooth). */
  animateTo: (target: { zoom: number; pan: { x: number; y: number } }) => void;
};

interface DesignStageProps {
  navRef: Ref<ViewportNavApi | null>;
  document: CanvasDocument;
  pageLayers: CanvasLayer[];
  pageIndex?: number;
  selectedIds: string[];
  tool: CanvasTool;
  editingLayerId: string | null;
  editingSelectAll: boolean;
  pathEditingLayerId?: string | null;
  onSelect: (id: string | null, additive?: boolean) => void;
  onSelectIds: (ids: string[]) => void;
  onChangeLayers: (layers: CanvasLayer[]) => void;
  onPreviewLayers: (layers: CanvasLayer[]) => void;
  onCommitGesture: () => void;
  onDrawLayer: (tool: CanvasTool, rect: DrawRect) => void;
  onStartEdit: (id: string) => void;
  onStartPathEdit?: (id: string) => void;
  onEditValue: (id: string, value: string, contentHeightPx?: number, zoom?: number) => void;
  onFitTextHeight: (id: string, contentHeightPx: number, zoom: number) => void;
  onCommitEdit: () => void;
  onContextMenu: (layerId: string | null, clientX: number, clientY: number) => void;
  onUpsertGuide?: (guide: CanvasGuide) => void;
  onMoveGuide?: (id: string, posMm: number) => void;
  onRemoveGuide?: (id: string) => void;
  onCancelGuideCreate?: (id: string) => void;
  showRulers?: boolean;
  onToggleRulers?: () => void;
  snapToGrid?: boolean;
  onToggleSnapToGrid?: () => void;
  /** Portal target in RightPanel header (next to Propiedades). */
  zoomPortalTarget?: HTMLElement | null;
  /** Register DesignStage fallback slot when right panel is hidden. */
  zoomFallbackSlotRef?: (el: HTMLDivElement | null) => void;
  /** Show floating zoom slot (when right panel is collapsed). */
  showZoomFallback?: boolean;
  /** Reopen collapsed sidebars from stage edges. */
  showLeftReopen?: boolean;
  showRightReopen?: boolean;
  onShowLeftPanel?: () => void;
  onShowRightPanel?: () => void;
  reopenDisabled?: boolean;
  children?: React.ReactNode;
}

/**
 * Owns zoom/pan so CanvasView (and sidebars) do not re-render on every wheel tick.
 */
export default function DesignStage({
  navRef,
  document,
  pageLayers,
  pageIndex = 0,
  selectedIds,
  tool,
  editingLayerId,
  editingSelectAll,
  pathEditingLayerId = null,
  onSelect,
  onSelectIds,
  onChangeLayers,
  onPreviewLayers,
  onCommitGesture,
  onDrawLayer,
  onStartEdit,
  onStartPathEdit,
  onEditValue,
  onFitTextHeight,
  onCommitEdit,
  onContextMenu,
  onUpsertGuide,
  onMoveGuide,
  onRemoveGuide,
  onCancelGuideCreate,
  showRulers = true,
  onToggleRulers,
  snapToGrid = false,
  onToggleSnapToGrid,
  zoomPortalTarget = null,
  zoomFallbackSlotRef,
  showZoomFallback = false,
  showLeftReopen = false,
  showRightReopen = false,
  onShowLeftPanel,
  onShowRightPanel,
  reopenDisabled = false,
  children,
}: DesignStageProps) {
  const { zoom, pan, setZoom, setPan, animateTo, startInertia } = useSmoothViewport(0.85);

  /** Menu/preset zoom actions glide to the target (Figma-like); wheel stays instant. */
  const animateZoomTo = useCallback((z: number) => animateTo({ zoom: z, pan }), [animateTo, pan]);

  const artboardDocument = useMemo(
    () => ({ ...document, layers: pageLayers }),
    [document, pageLayers],
  );

  const zoomToFit = useCallback(() => {
    const el = window.document.querySelector<HTMLElement>('[data-testid="canvas-viewport"]');
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const fitZ = fitZoomForViewport(width, height, A4_WIDTH_PX, A4_HEIGHT_PX);
    animateTo({ zoom: fitZ, pan: { x: 0, y: 0 } });
  }, [animateTo]);

  const zoomToSelection = useCallback(
    (ids: string[] = selectedIds) => {
      const bounds = selectionBounds(pageLayers, ids);
      if (!bounds) {
        zoomToFit();
        return;
      }
      const el = window.document.querySelector<HTMLElement>('[data-testid="canvas-viewport"]');
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      const next = zoomToFitRectMm(
        width,
        height,
        bounds,
        { widthMm: document.page.widthMm, heightMm: document.page.heightMm },
        MM_TO_PX,
      );
      animateTo(next);
    },
    [document.page.heightMm, document.page.widthMm, pageLayers, selectedIds, zoomToFit, animateTo],
  );

  useImperativeHandle(
    navRef,
    () => ({
      getZoom: () => zoom,
      setZoom,
      setPan,
      zoomToFit,
      zoomToSelection,
      animateTo,
    }),
    [zoom, setZoom, setPan, zoomToFit, zoomToSelection, animateTo],
  );

  return (
    <div className="relative h-full min-h-0 min-w-0 flex-1">
      <Artboard
        document={artboardDocument}
        selectedIds={selectedIds}
        zoom={zoom}
        tool={tool}
        pan={pan}
        pageIndex={pageIndex}
        editingLayerId={editingLayerId}
        editingSelectAll={editingSelectAll}
        pathEditingLayerId={pathEditingLayerId}
        onPan={setPan}
        onSelect={onSelect}
        onSelectIds={onSelectIds}
        onChangeLayers={onChangeLayers}
        onPreviewLayers={onPreviewLayers}
        onCommitGesture={onCommitGesture}
        onZoom={setZoom}
        onDrawLayer={onDrawLayer}
        onStartEdit={onStartEdit}
        onStartPathEdit={onStartPathEdit}
        onEditValue={(id, v, h) => onEditValue(id, v, h, 1)}
        onFitTextHeight={(id, h) => onFitTextHeight(id, h, 1)}
        onCommitEdit={onCommitEdit}
        onContextMenu={onContextMenu}
        onUpsertGuide={onUpsertGuide}
        onMoveGuide={onMoveGuide}
        onRemoveGuide={onRemoveGuide}
        onCancelGuideCreate={onCancelGuideCreate}
        showRulers={showRulers}
        snapToGrid={snapToGrid}
        onStartInertia={startInertia}
      />
      {showLeftReopen && onShowLeftPanel ? (
        <div className="pointer-events-auto absolute left-3 top-3 z-30">
          <WithHoverTooltip label="Mostrar panel izquierdo" placement="bottom" variant="dark">
            <button
              type="button"
              className="canvas-icon-btn canvas-panel-reopen"
              data-testid="canvas-reopen-left-panel"
              disabled={reopenDisabled}
              onClick={onShowLeftPanel}
              aria-label="Mostrar panel izquierdo"
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
          </WithHoverTooltip>
        </div>
      ) : null}
      {showZoomFallback || showRightReopen ? (
        <div
          className="pointer-events-auto absolute right-3 top-3 z-30 flex items-center gap-0.5"
          data-testid="canvas-stage-right-chrome"
        >
          {showRightReopen && onShowRightPanel ? (
            <WithHoverTooltip label="Mostrar panel derecho" placement="bottom" variant="dark">
              <button
                type="button"
                className="canvas-icon-btn canvas-panel-reopen"
                data-testid="canvas-reopen-right-panel"
                disabled={reopenDisabled}
                onClick={onShowRightPanel}
                aria-label="Mostrar panel derecho"
              >
                <PanelRight className="h-3.5 w-3.5" />
              </button>
            </WithHoverTooltip>
          ) : null}
          {showZoomFallback ? (
            <div ref={zoomFallbackSlotRef} data-testid="canvas-zoom-slot-fallback" />
          ) : null}
        </div>
      ) : null}
      {zoomPortalTarget
        ? createPortal(
            <ZoomMenu
              zoom={zoom}
              onZoom={animateZoomTo}
              onZoomFit={zoomToFit}
              onZoomSelection={selectedIds.length ? () => zoomToSelection() : undefined}
              showRulers={showRulers}
              onToggleRulers={onToggleRulers}
              snapToGrid={snapToGrid}
              onToggleSnapToGrid={onToggleSnapToGrid}
            />,
            zoomPortalTarget,
          )
        : null}
      {children}
    </div>
  );
}
