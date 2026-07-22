import { useCallback, useImperativeHandle, useMemo, useState, type Ref } from 'react';
import type { CanvasDocument, CanvasGuide, CanvasLayer, CanvasTool } from '../types';
import { A4_HEIGHT_PX, A4_WIDTH_PX } from '../types';
import { MM_TO_PX, type DrawRect } from '../ops/drawHelpers';
import { selectionBounds } from '../ops/selectionTransform';
import { fitZoomForViewport, zoomToFitRectMm } from '../ops/viewportNav';
import Artboard from './Artboard';
import ZoomMenu from './ZoomMenu';

export type ViewportNavApi = {
  getZoom: () => number;
  setZoom: (zoom: number | ((prev: number) => number)) => void;
  setPan: (pan: { x: number; y: number }) => void;
  zoomToFit: () => void;
  zoomToSelection: (ids?: string[]) => void;
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
  onEditValue: (id: string, value: string) => void;
  onFitTextHeight: (id: string, contentHeightPx: number, zoom: number) => void;
  onCommitEdit: () => void;
  onContextMenu: (layerId: string | null, clientX: number, clientY: number) => void;
  onUpsertGuide?: (guide: CanvasGuide) => void;
  onMoveGuide?: (id: string, posMm: number) => void;
  onRemoveGuide?: (id: string) => void;
  showRulers?: boolean;
  onToggleRulers?: () => void;
  snapToGrid?: boolean;
  onToggleSnapToGrid?: () => void;
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
  showRulers = true,
  onToggleRulers,
  snapToGrid = false,
  onToggleSnapToGrid,
  children,
}: DesignStageProps) {
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const artboardDocument = useMemo(
    () => ({ ...document, layers: pageLayers }),
    [document, pageLayers],
  );

  const zoomToFit = useCallback(() => {
    const el = window.document.querySelector<HTMLElement>('[data-testid="canvas-viewport"]');
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setZoom(fitZoomForViewport(width, height, A4_WIDTH_PX, A4_HEIGHT_PX));
    setPan({ x: 0, y: 0 });
  }, []);

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
      setZoom(next.zoom);
      setPan(next.pan);
    },
    [document.page.heightMm, document.page.widthMm, pageLayers, selectedIds, zoomToFit],
  );

  useImperativeHandle(
    navRef,
    () => ({
      getZoom: () => zoom,
      setZoom,
      setPan,
      zoomToFit,
      zoomToSelection,
    }),
    [zoom, zoomToFit, zoomToSelection],
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
        onEditValue={onEditValue}
        onFitTextHeight={(id, h) => onFitTextHeight(id, h, zoom)}
        onCommitEdit={onCommitEdit}
        onContextMenu={onContextMenu}
        onUpsertGuide={onUpsertGuide}
        onMoveGuide={onMoveGuide}
        onRemoveGuide={onRemoveGuide}
        showRulers={showRulers}
        snapToGrid={snapToGrid}
      />
      <div className="canvas-viewport-zoom">
        <ZoomMenu
          zoom={zoom}
          onZoom={setZoom}
          onZoomFit={zoomToFit}
          onZoomSelection={selectedIds.length ? () => zoomToSelection() : undefined}
          showRulers={showRulers}
          onToggleRulers={onToggleRulers}
          snapToGrid={snapToGrid}
          onToggleSnapToGrid={onToggleSnapToGrid}
        />
      </div>
      {children}
    </div>
  );
}
