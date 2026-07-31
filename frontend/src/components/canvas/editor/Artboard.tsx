import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { CanvasDocument, CanvasGuide, CanvasLayer, CanvasTool } from '../types';
import { A4_HEIGHT_PX, A4_WIDTH_PX, parseMm, resolvePageMarginMm } from '../types';
import {
  clientToMm,
  isClickPlace,
  isPlaceTool,
  mmToScreenPx,
  MM_TO_PX,
  normalizeDrawRect,
  type DrawRect,
} from '../ops/drawHelpers';
import { clipPathForLayerType, isSquareConstrainTool } from '../ops/shapePaths';
import {
  angleFromCenter,
  computeResizeBox,
  isPointerClick,
  layersInMarquee,
  moveSelection,
  resizeSelection,
  rotateSelection,
  selectionBounds,
  prepareSnapRails,
  smartGuidesEqual,
  snapMoveWithGuides,
  snapResizeBox,
  snapRectToGrid,
  snapToGridMm,
  snapThresholdMm,
  constrainMoveToAxis,
  type HandlePos,
  type RectMm,
  type SmartGuide,
  DEFAULT_GRID_MM,
} from '../ops/selectionTransform';
import { buildSpatialIndex } from '../ops/spatialIndex';
import { layerBounds } from '../ops/layerBounds';
import { replaceLayerById } from '../ops/patchLayers';
import {
  clampGuidePos,
  collectReferenceGaps,
  formatGapMm,
  guidesForPage,
  isGuideRemovalPoint,
  measureSelectionGaps,
  snapEqualGaps,
  type DistanceLabel,
} from '../ops/guides';
import { duplicateLayers } from '../ops/layerOps';
import { expandWithDescendants } from '../ops/layerTree';
import { wheelPanDelta, wheelZoomFactor, zoomAtCursor } from '../ops/viewportNav';
import { CULLING_MARGIN_MM, filterVisibleLayers, visiblePageRectMm } from '../ops/viewportCulling';
import { createGestureRaf } from '../ops/gestureRaf';
import {
  applyLayerDomGeometry,
  clearLayerDomGestureStyles,
  setCanvasGestureActive,
} from '../ops/imperativeLayerDom';
import {
  computeRadiusFromDrag,
  layerSupportsCornerRadius,
  layersWithCornerRadius,
  maxCornerRadiusPxForLayer,
} from '../ops/cornerRadiusGesture';
import { usePinchZoom } from '../hooks/usePinchZoom';
import {
  bendLineAt,
  cutLineAt,
  dragLineAnchor,
  dragLineHandle,
} from '../ops/pathEditGestures';
import { ensureLinePath, lineIntersectsPolygon, rectIntersectsPolygon } from '../ops/pathGeometry';
import { cornerRadiusPx, type CornerId } from '../ops/layerStyle';
import CanvasRulers, { GuidePositionChip, MeasurementBadge, RULER_SIZE } from './CanvasRulers';
import LayerNode from './LayerNode';
import PathHandlesOverlay from './PathHandlesOverlay';
import { SelectionChromeOverlay } from './SelectionChromeOverlay';
import { screenChromePx } from '../ops/textTypography';

/** Invisible grab zone around a guide line (Figma uses a generous hit area). */
const GUIDE_HIT_PX = 10;
/** Guide line thickness in screen px (counter-scaled under CSS camera zoom). */
const GUIDE_LINE_PX = 2;

interface ArtboardProps {
  document: CanvasDocument;
  selectedIds: string[];
  zoom: number;
  tool: CanvasTool;
  pan: { x: number; y: number };
  pageIndex?: number;
  editingLayerId?: string | null;
  pathEditingLayerId?: string | null;
  onPan: (pan: { x: number; y: number }) => void;
  onSelect: (id: string | null, additive?: boolean) => void;
  onSelectIds: (ids: string[]) => void;
  onChangeLayers: (layers: CanvasLayer[]) => void;
  /** Live gesture updates (no undo). Pair with onCommitGesture on pointerup. */
  onPreviewLayers?: (layers: CanvasLayer[]) => void;
  onCommitGesture?: () => void;
  onZoom?: (zoom: number) => void;
  onDrawLayer?: (tool: CanvasTool, rect: DrawRect) => void;
  onContextMenu?: (layerId: string | null, clientX: number, clientY: number) => void;
  onStartEdit?: (id: string) => void;
  onEditValue?: (id: string, value: string, contentHeightPx?: number) => void;
  onFitTextHeight?: (id: string, contentHeightPx: number) => void;
  onCommitEdit?: () => void;
  editingSelectAll?: boolean;
  onStartPathEdit?: (id: string) => void;
  onUpsertGuide?: (guide: CanvasGuide) => void;
  onMoveGuide?: (id: string, posMm: number) => void;
  onRemoveGuide?: (id: string) => void;
  /** Abort an in-progress guide creation from the rulers (silent, no history). */
  onCancelGuideCreate?: (id: string) => void;
  showRulers?: boolean;
  snapToGrid?: boolean;
  gridSizeMm?: number;
  /** Start inertial panning after hand-tool drag release. */
  onStartInertia?: (velocity: { vx: number; vy: number }) => void;
  /** Increment to drop local gesture preview without committing. */
  gestureAbortToken?: number;
}

/** Snapshot for a gesture. Deep-clones only `deepIds` (selection); shares other refs. */
function cloneLayers(layers: CanvasLayer[], deepIds?: ReadonlySet<string>): CanvasLayer[] {
  if (!deepIds || deepIds.size === 0) {
    return layers.map((l) => ({ ...l, cssVars: { ...l.cssVars }, meta: l.meta ? { ...l.meta } : undefined }));
  }
  return layers.map((l) =>
    deepIds.has(l.id)
      ? { ...l, cssVars: { ...l.cssVars }, meta: l.meta ? { ...l.meta } : undefined }
      : l,
  );
}

/** Cache artboard client rect for a gesture; refresh if camera zoom changes mid-drag. */
function createFrameRectCache(
  frame: HTMLElement,
  zoomRef: { current: number },
): { read: () => DOMRect } {
  let zoom = zoomRef.current;
  let rect = frame.getBoundingClientRect();
  return {
    read() {
      if (zoomRef.current !== zoom) {
        zoom = zoomRef.current;
        rect = frame.getBoundingClientRect();
      }
      return rect;
    },
  };
}

/** Isolated smart-guide chrome so Artboard gesture frames skip reconciling unrelated subtrees. */
const SmartGuidesOverlay = memo(function SmartGuidesOverlay({
  guides,
  zoom,
}: {
  guides: SmartGuide[];
  zoom: number;
}) {
  if (!guides.length) return null;
  const strokeW = screenChromePx(1, zoom);
  const dash = `${screenChromePx(4, zoom)} ${screenChromePx(3, zoom)}`;
  return (
    <svg
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 45,
        overflow: 'visible',
      }}
    >
      {guides.map((g) =>
        g.axis === 'x' ? (
          <line
            key={`gx-${g.pos}`}
            data-testid="canvas-smart-guide"
            x1={mmToScreenPx(g.pos, 1)}
            y1={0}
            x2={mmToScreenPx(g.pos, 1)}
            y2="100%"
            stroke="var(--cv-accent-2)"
            strokeWidth={strokeW}
            strokeDasharray={dash}
          />
        ) : (
          <line
            key={`gy-${g.pos}`}
            data-testid="canvas-smart-guide"
            x1={0}
            y1={mmToScreenPx(g.pos, 1)}
            x2="100%"
            y2={mmToScreenPx(g.pos, 1)}
            stroke="var(--cv-accent-2)"
            strokeWidth={strokeW}
            strokeDasharray={dash}
          />
        ),
      )}
    </svg>
  );
});

function Artboard({
  document,
  selectedIds,
  zoom,
  tool,
  pan,
  pageIndex = 0,
  editingLayerId = null,
  pathEditingLayerId = null,
  onPan,
  onSelect,
  onSelectIds,
  onChangeLayers,
  onPreviewLayers,
  onCommitGesture,
  onZoom,
  onDrawLayer,
  onContextMenu,
  onStartEdit,
  onEditValue,
  onFitTextHeight,
  onCommitEdit,
  editingSelectAll = true,
  onStartPathEdit,
  onUpsertGuide,
  onMoveGuide,
  onRemoveGuide,
  onCancelGuideCreate,
  showRulers = true,
  snapToGrid = false,
  gridSizeMm = DEFAULT_GRID_MM,
  onStartInertia,
  gestureAbortToken = 0,
}: ArtboardProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const drawStart = useRef<{ xMm: number; yMm: number } | null>(null);
  const [draft, setDraft] = useState<DrawRect | null>(null);
  const [marquee, setMarquee] = useState<RectMm | null>(null);
  const [lassoPts, setLassoPts] = useState<Array<{ x: number; y: number }> | null>(null);
  const [guides, setGuides] = useState<SmartGuide[]>([]);
  const guidesRef = useRef<SmartGuide[]>([]);
  guidesRef.current = guides;
  const [distanceLabels, setDistanceLabels] = useState<DistanceLabel[]>([]);
  const distanceLabelsRef = useRef<DistanceLabel[]>([]);
  distanceLabelsRef.current = distanceLabels;

  const setGuidesIfChanged = useCallback((next: SmartGuide[]) => {
    if (smartGuidesEqual(guidesRef.current, next)) return;
    guidesRef.current = next;
    setGuides(next);
  }, []);

  const setDistanceLabelsIfChanged = useCallback((next: DistanceLabel[]) => {
    const prev = distanceLabelsRef.current;
    if (
      prev.length === next.length &&
      prev.every(
        (p, i) =>
          p.id === next[i]!.id &&
          p.axis === next[i]!.axis &&
          p.valueMm === next[i]!.valueMm &&
          p.x === next[i]!.x &&
          p.y === next[i]!.y,
      )
    ) {
      return;
    }
    distanceLabelsRef.current = next;
    setDistanceLabels(next);
  }, []);
  const [panning, setPanning] = useState(false);
  /** True briefly while pan/zoom is changing — defers GPU filters and widens cull margin. */
  const [cameraMoving, setCameraMoving] = useState(false);
  /** True while a two-finger pinch is (or was, until all fingers lift) active. */
  const pinchGestureRef = useRef(false);
  /** Viewport size in CSS px — drives layer culling (virtualized rendering). */
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number } | null>(null);
  /** Live gesture preview stays in Artboard so CanvasView/sidebars skip per-frame updates. */
  const [gestureLayers, setGestureLayers] = useState<CanvasLayer[] | null>(null);
  /**
   * Selection-move uses DOM transforms mid-drag (no setGestureLayers per frame).
   * `gestureActive` flips once so LayerNode gets `moving` / will-change without
   * reconciling every layer each frame; chrome bbox is tracked separately.
   */
  const [gestureActive, setGestureActive] = useState(false);
  const [gestureBbox, setGestureBbox] = useState<RectMm | null>(null);
  const didFit = useRef(false);
  const gestureDirtyRef = useRef(false);
  const gestureLayersRef = useRef<CanvasLayer[] | null>(null);
  /** Ids being moved via imperative DOM preview (selection move only). */
  const imperativeMoveIdsRef = useRef<string[] | null>(null);
  const layersRef = useRef(document.layers);

  const onPreviewLayersRef = useRef(onPreviewLayers);
  onPreviewLayersRef.current = onPreviewLayers;
  const onCommitGestureRef = useRef(onCommitGesture);
  onCommitGestureRef.current = onCommitGesture;
  const onChangeLayersRef = useRef(onChangeLayers);
  onChangeLayersRef.current = onChangeLayers;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onSelectIdsRef = useRef(onSelectIds);
  onSelectIdsRef.current = onSelectIds;
  const onCommitEditRef = useRef(onCommitEdit);
  onCommitEditRef.current = onCommitEdit;
  const editingLayerIdRef = useRef(editingLayerId);
  editingLayerIdRef.current = editingLayerId;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pageSizeRef = useRef({ widthMm: document.page.widthMm, heightMm: document.page.heightMm });
  pageSizeRef.current = { widthMm: document.page.widthMm, heightMm: document.page.heightMm };
  const pageMarginMm = resolvePageMarginMm(document.settings);
  const pageMarginRef = useRef(pageMarginMm);
  pageMarginRef.current = pageMarginMm;
  const pageGuides = useMemo(() => guidesForPage(document, pageIndex), [document, pageIndex]);
  const [guideDrag, setGuideDrag] = useState<{
    id: string;
    posMm: number;
    clientX: number;
    clientY: number;
    willRemove: boolean;
  } | null>(null);
  const displayGuides = useMemo(() => {
    if (!guideDrag) return pageGuides;
    return pageGuides.map((g) => (g.id === guideDrag.id ? { ...g, posMm: guideDrag.posMm } : g));
  }, [pageGuides, guideDrag]);
  const manualGuidesRef = useRef(displayGuides);
  manualGuidesRef.current = displayGuides;
  const snapToGridRef = useRef(snapToGrid);
  snapToGridRef.current = snapToGrid;
  const gridSizeMmRef = useRef(gridSizeMm);
  gridSizeMmRef.current = gridSizeMm > 0 ? gridSizeMm : DEFAULT_GRID_MM;

  const applyGestureLayers = useCallback((layers: CanvasLayer[]) => {
    if (pinchGestureRef.current) return;
    // First frame: capture parent baseline so undo can cancel (revert) mid-gesture.
    if (!gestureDirtyRef.current) {
      onPreviewLayersRef.current?.(layersRef.current);
      setCanvasGestureActive(true);
    }
    gestureDirtyRef.current = true;
    gestureLayersRef.current = layers;
    layersRef.current = layers;
    setGestureLayers(layers);
  }, []);

  const endGesture = useCallback(() => {
    if (!gestureDirtyRef.current) return;
    const finalLayers = gestureLayersRef.current;
    const ids = imperativeMoveIdsRef.current;
    const frame = frameRef.current;
    if (frame && finalLayers && ids?.length) {
      clearLayerDomGestureStyles(frame, finalLayers, ids);
    }
    gestureDirtyRef.current = false;
    gestureLayersRef.current = null;
    imperativeMoveIdsRef.current = null;
    setGestureLayers(null);
    setGestureActive(false);
    setGestureBbox(null);
    setCanvasGestureActive(false);
    if (!finalLayers) return;
    if (onPreviewLayersRef.current) {
      onPreviewLayersRef.current(finalLayers);
      onCommitGestureRef.current?.();
    } else {
      onChangeLayersRef.current(finalLayers);
    }
  }, []);

  /** Mid-gesture DOM preview (move/resize/rotate): no per-frame LayerNode reconcile. */
  const applyImperativePreview = useCallback((moved: CanvasLayer[], nextIds: string[]) => {
    if (pinchGestureRef.current) return;
    if (!gestureDirtyRef.current) {
      onPreviewLayersRef.current?.(layersRef.current);
      gestureDirtyRef.current = true;
      setGestureActive(true);
      setCanvasGestureActive(true);
    }
    gestureLayersRef.current = moved;
    layersRef.current = moved;
    imperativeMoveIdsRef.current = nextIds;
    const frame = frameRef.current;
    if (frame) applyLayerDomGeometry(frame, moved, nextIds);
  }, []);

  const prevAbortTokenRef = useRef(gestureAbortToken);
  useEffect(() => {
    if (gestureAbortToken === prevAbortTokenRef.current) return;
    prevAbortTokenRef.current = gestureAbortToken;
    const layers = gestureLayersRef.current;
    const ids = imperativeMoveIdsRef.current;
    const frame = frameRef.current;
    if (frame && layers && ids?.length) {
      clearLayerDomGestureStyles(frame, layers, ids);
    }
    gestureDirtyRef.current = false;
    gestureLayersRef.current = null;
    imperativeMoveIdsRef.current = null;
    setGestureLayers(null);
    setGestureActive(false);
    setGestureBbox(null);
    setCanvasGestureActive(false);
    setMarquee(null);
    setDraft(null);
    setGuidesIfChanged([]);
    setDistanceLabelsIfChanged([]);
    setLassoPts(null);
  }, [gestureAbortToken, setGuidesIfChanged, setDistanceLabelsIfChanged]);

  /** Re-apply DOM geometry after React chrome commits wipe inline styles. */
  useLayoutEffect(() => {
    if (!gestureActive || !imperativeMoveIdsRef.current || !gestureLayersRef.current) return;
    const frame = frameRef.current;
    if (!frame) return;
    applyLayerDomGeometry(frame, gestureLayersRef.current, imperativeMoveIdsRef.current);
  }, [gestureActive, guides, distanceLabels, gestureBbox]);

  const navRef = useRef({ zoom, pan, onZoom, onPan });
  navRef.current = { zoom, pan, onZoom, onPan };

  usePinchZoom(viewportRef, navRef, {
    activeRef: pinchGestureRef,
    onStart: () => {
      // Cancel in-flight single-pointer gesture visuals when the second finger lands.
      setMarquee(null);
      setDraft(null);
      setGuidesIfChanged([]);
      setDistanceLabelsIfChanged([]);
      setLassoPts(null);
      setPanning(false);
    },
  });
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const displayLayers = gestureLayers ?? document.layers;
  // Keep layersRef on the live gesture snapshot while imperative move is in flight
  // (gestureLayers state stays null so LayerNodes skip per-frame reconciliation).
  if (gestureDirtyRef.current && gestureLayersRef.current) {
    layersRef.current = gestureLayersRef.current;
  } else {
    layersRef.current = displayLayers;
  }

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const contentLayers = useMemo(
    () => displayLayers.filter((l) => l.type !== 'frame' && l.visible !== false),
    [displayLayers],
  );
  const interactive = tool === 'select';
  const placing = isPlaceTool(tool);
  const canPanTool = tool === 'hand';
  const pathEditLayer = pathEditingLayerId
    ? displayLayers.find((l) => l.id === pathEditingLayerId && l.type === 'line')
    : selectedIds.length === 1
      ? displayLayers.find((l) => l.id === selectedIds[0] && l.type === 'line') ?? null
      : null;

  const layerById = useMemo(() => new Map(displayLayers.map((l) => [l.id, l])), [displayLayers]);

  // Virtualized rendering: only mount layers inside the visible page region.
  // Widen overscan while the camera moves so layers do not thrash mount/unmount mid-pan.
  const viewRectMm = useMemo(
    () =>
      viewportSize
        ? visiblePageRectMm(
            viewportSize.w,
            viewportSize.h,
            pan,
            zoom,
            A4_WIDTH_PX,
            A4_HEIGHT_PX,
            cameraMoving || panning ? CULLING_MARGIN_MM * 3 : CULLING_MARGIN_MM,
          )
        : null,
    [viewportSize, pan, zoom, cameraMoving, panning],
  );
  const renderLayers = useMemo(() => {
    const always = new Set(selectedIds);
    if (editingLayerId) always.add(editingLayerId);
    if (pathEditingLayerId) always.add(pathEditingLayerId);
    return filterVisibleLayers(contentLayers, viewRectMm, always);
  }, [contentLayers, viewRectMm, selectedIds, editingLayerId, pathEditingLayerId]);

  const editableSelected = useMemo(
    () =>
      selectedIds.filter((id) => {
        const layer = layerById.get(id);
        return layer && layer.type !== 'frame' && !layer.locked && layer.visible !== false;
      }),
    [layerById, selectedIds],
  );
  const bbox = useMemo(() => selectionBounds(displayLayers, editableSelected), [displayLayers, editableSelected]);
  const chromeBbox = gestureBbox ?? bbox;
  const [radiusDrag, setRadiusDrag] = useState<{
    label: string;
    corner: CornerId;
  } | null>(null);
  const radiusTargetLayer = useMemo(() => {
    if (editableSelected.length !== 1) return null;
    const layer = displayLayers.find((l) => l.id === editableSelected[0]);
    if (!layer || !layerSupportsCornerRadius(layer)) return null;
    return layer;
  }, [displayLayers, editableSelected]);
  const showRadiusHandles = Boolean(radiusTargetLayer);
  const cornerRadii = useMemo(() => {
    if (!radiusTargetLayer) return undefined;
    const vars = radiusTargetLayer.cssVars;
    return {
      tl: cornerRadiusPx(vars, 'tl'),
      tr: cornerRadiusPx(vars, 'tr'),
      br: cornerRadiusPx(vars, 'br'),
      bl: cornerRadiusPx(vars, 'bl'),
    };
  }, [radiusTargetLayer]);

  const handleSelect = useCallback((id: string, additive?: boolean) => {
    onSelectRef.current(id, additive);
  }, []);

  const onUpsertGuideRef = useRef(onUpsertGuide);
  onUpsertGuideRef.current = onUpsertGuide;
  const onCancelGuideCreateRef = useRef(onCancelGuideCreate);
  onCancelGuideCreateRef.current = onCancelGuideCreate;
  // Stable identity so memoized rulers skip re-rendering on every gesture frame.
  const handleCreateGuide = useCallback((guide: CanvasGuide) => {
    onUpsertGuideRef.current?.(guide);
  }, []);
  const handleCancelGuideCreate = useCallback((id: string) => {
    onCancelGuideCreateRef.current?.(id);
  }, []);

  useEffect(() => {
    if (didFit.current || !onZoom || !viewportRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || didFit.current) return;
      const { width, height } = entry.contentRect;
      if (width < 40 || height < 40) return;
      const pad = 48;
      const fit = Math.min((width - pad) / A4_WIDTH_PX, (height - pad) / A4_HEIGHT_PX, 1);
      onZoom(Math.max(0.35, Math.round(fit * 100) / 100));
      onPan({ x: 0, y: 0 });
      didFit.current = true;
    });
    ro.observe(viewportRef.current);
    return () => ro.disconnect();
  }, [onZoom, onPan]);

  // Track viewport size for layer culling (cheap; updates only on resize).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setViewportSize((prev) =>
        prev && Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1
          ? prev
          : { w: width, h: height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // After the last pan/zoom tick, restore GPU effects once the camera settles.
  const cameraPrimedRef = useRef(false);
  useEffect(() => {
    if (!cameraPrimedRef.current) {
      cameraPrimedRef.current = true;
      return;
    }
    setCameraMoving(true);
    const timer = window.setTimeout(() => setCameraMoving(false), 140);
    return () => window.clearTimeout(timer);
  }, [pan.x, pan.y, zoom]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    // Viewport client rect is stable across pan/zoom; refresh only on resize.
    let viewportRect = el.getBoundingClientRect();
    let rectDirty = false;
    const refreshViewportRect = () => {
      viewportRect = el.getBoundingClientRect();
      rectDirty = false;
    };
    const ro = new ResizeObserver(() => {
      rectDirty = true;
    });
    ro.observe(el);
    // Coalesce wheel bursts to one camera update per frame (matches drag RAF policy).
    const raf = createGestureRaf((e: WheelEvent) => {
      const { zoom: z, pan: p, onZoom: setZ, onPan: setP } = navRef.current;
      if (rectDirty) refreshViewportRect();
      const cursor = {
        x: e.clientX - viewportRect.left - viewportRect.width / 2,
        y: e.clientY - viewportRect.top - viewportRect.height / 2,
      };

      if (e.ctrlKey || e.metaKey) {
        const factor = wheelZoomFactor(e.deltaY, true);
        const next = zoomAtCursor(z, p, cursor, z * factor);
        setZ?.(next.zoom);
        setP(next.pan);
        return;
      }

      const d = wheelPanDelta(e.deltaX, e.deltaY, e.shiftKey);
      setP({ x: p.x - d.x, y: p.y - d.y });
    });
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      raf.schedule(e);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      raf.cancel();
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  const startPanDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPanning(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { ...navRef.current.pan };
    let lastX = e.clientX;
    let lastY = e.clientY;
    let lastT = performance.now();
    let vx = 0;
    let vy = 0;

    // Pan state updates coalesced to one per frame; velocity sampling stays
    // per raw event so release inertia keeps sub-frame accuracy.
    const raf = createGestureRaf((ev: PointerEvent) => {
      navRef.current.onPan({
        x: origin.x + (ev.clientX - startX),
        y: origin.y + (ev.clientY - startY),
      });
    });
    const onMovePtr = (ev: PointerEvent) => {
      if (pinchGestureRef.current) return;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      // Exponential moving average for smooth velocity
      const instantVx = (ev.clientX - lastX) / dt * 16; // normalize to ~60fps frame
      const instantVy = (ev.clientY - lastY) / dt * 16;
      vx = vx * 0.6 + instantVx * 0.4;
      vy = vy * 0.6 + instantVy * 0.4;
      lastX = ev.clientX;
      lastY = ev.clientY;
      lastT = now;
      raf.schedule(ev);
    };
    const onUp = () => {
      raf.flush();
      setPanning(false);
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
      // Trigger inertial glide if velocity is significant
      if (!pinchGestureRef.current && onStartInertia && (Math.abs(vx) > 1 || Math.abs(vy) > 1)) {
        onStartInertia({ vx, vy });
      }
    };
    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const beginSelectionMove = useCallback(
    (
      ids: string[],
      startClientX: number,
      startClientY: number,
      options?: { onClickWithoutDrag?: () => void; duplicate?: boolean },
    ) => {
      let snapshot = cloneLayers(
        layersRef.current,
        new Set(expandWithDescendants(layersRef.current, ids)),
      );
      let moveIds = ids;
      let didDuplicate = false;
      /** Alt-duplicate needs a React commit so new LayerNodes mount; stay on that path. */
      let useReactPreview = false;
      gestureDirtyRef.current = false;
      let dragging = false;
      const marginMm = pageMarginRef.current;

      const ensureDuplicate = () => {
        if (!options?.duplicate || didDuplicate) return;
        didDuplicate = true;
        const { layers, newIds } = duplicateLayers(snapshot, ids, { offsetMm: 0 });
        if (!newIds.length) return;
        snapshot = layers;
        moveIds = newIds;
        onSelectIdsRef.current(newIds);
        useReactPreview = true;
        applyGestureLayers(snapshot);
      };

      const applyMovePreview = (moved: CanvasLayer[], nextMoveIds: string[]) => {
        applyImperativePreview(moved, nextMoveIds);
      };

      const buildOthers = (snap: CanvasLayer[], moving: string[]) => {
        const exclude = new Set(expandWithDescendants(snap, moving));
        return snap
          .filter((l) => !exclude.has(l.id) && l.type !== 'frame' && l.visible !== false && !l.locked)
          .map((l) => {
            const b = layerBounds(l);
            return { x: b.x, y: b.y, w: b.w, h: b.h };
          });
      };

      let originBounds = selectionBounds(snapshot, moveIds);
      let rails = prepareSnapRails(
        snapshot,
        moveIds,
        pageSizeRef.current,
        manualGuidesRef.current,
        marginMm,
      );
      let othersRects = buildOthers(snapshot, moveIds);
      let refGaps = collectReferenceGaps(othersRects, pageSizeRef.current);

      // Coalesce to one apply per animation frame; latest pointer position wins.
      const raf = createGestureRaf((ev: PointerEvent) => {
        if (pinchGestureRef.current) return;
        const dxPx = ev.clientX - startClientX;
        const dyPx = ev.clientY - startClientY;
        if (!dragging) {
          if (isPointerClick(dxPx, dyPx)) return;
          dragging = true;
          ensureDuplicate();
          originBounds = selectionBounds(snapshot, moveIds);
          rails = prepareSnapRails(
            snapshot,
            moveIds,
            pageSizeRef.current,
            manualGuidesRef.current,
            marginMm,
          );
          othersRects = buildOthers(snapshot, moveIds);
          refGaps = collectReferenceGaps(othersRects, pageSizeRef.current);
        }
        const z = zoomRef.current;
        let rawDx = dxPx / (z * MM_TO_PX);
        let rawDy = dyPx / (z * MM_TO_PX);
        // Figma: Shift while dragging locks to the dominant axis.
        const axisLock = ev.shiftKey;
        ({ dx: rawDx, dy: rawDy } = constrainMoveToAxis(rawDx, rawDy, axisLock));
        const lockHorizontal = axisLock && rawDy === 0;
        const lockVertical = axisLock && rawDx === 0;
        const disableSnap = ev.ctrlKey || ev.metaKey;
        const threshold = snapThresholdMm(z);
        let dx = rawDx;
        let dy = rawDy;
        let nextGuides: SmartGuide[] = [];
        let equalGapLabels: DistanceLabel[] = [];
        if (!disableSnap) {
          const snapped = snapMoveWithGuides(
            snapshot,
            moveIds,
            rawDx,
            rawDy,
            pageSizeRef.current,
            threshold,
            manualGuidesRef.current,
            rails,
            marginMm,
          );
          dx = snapped.dx;
          dy = snapped.dy;
          nextGuides = snapped.guides;
          if (originBounds) {
            const equal = snapEqualGaps(
              originBounds,
              dx,
              dy,
              othersRects,
              pageSizeRef.current,
              threshold,
              refGaps,
            );
            dx = equal.dx;
            dy = equal.dy;
            equalGapLabels = equal.labels;
          }
          if (snapToGridRef.current && originBounds) {
            const grid = gridSizeMmRef.current;
            const nx = snapToGridMm(originBounds.x + dx, grid);
            const ny = snapToGridMm(originBounds.y + dy, grid);
            dx = nx - originBounds.x;
            dy = ny - originBounds.y;
          }
        }
        // Keep axis lock after snap/grid (Figma: guides only on the free axis).
        if (lockHorizontal) {
          dy = 0;
          nextGuides = nextGuides.filter((g) => g.axis === 'x');
          equalGapLabels = equalGapLabels.filter((g) => g.axis === 'x');
        } else if (lockVertical) {
          dx = 0;
          nextGuides = nextGuides.filter((g) => g.axis === 'y');
          equalGapLabels = equalGapLabels.filter((g) => g.axis === 'y');
        }
        setGuidesIfChanged(nextGuides);
        const moved = moveSelection(snapshot, moveIds, dx, dy);
        if (useReactPreview) applyGestureLayers(moved);
        else applyMovePreview(moved, moveIds);
        // Distances always while dragging when neighbors/page gaps exist;
        // equal-gap badges take priority when present.
        const bounds = selectionBounds(moved, moveIds);
        if (bounds) {
          setGestureBbox(bounds);
          const measured = measureSelectionGaps(bounds, othersRects, pageSizeRef.current);
          setDistanceLabelsIfChanged(equalGapLabels.length ? equalGapLabels : measured);
        } else {
          setGestureBbox(null);
          setDistanceLabelsIfChanged([]);
        }
      });
      const onMovePtr = (ev: PointerEvent) => raf.schedule(ev);
      const onUp = () => {
        raf.flush();
        setGuidesIfChanged([]);
        setDistanceLabelsIfChanged([]);
        endGesture();
        window.removeEventListener('pointermove', onMovePtr);
        window.removeEventListener('pointerup', onUp);
        // Figma: Shift/Ctrl+click toggles selection only when there was no drag.
        if (!dragging) options?.onClickWithoutDrag?.();
      };
      window.addEventListener('pointermove', onMovePtr);
      window.addEventListener('pointerup', onUp);
    },
    [applyGestureLayers, applyImperativePreview, endGesture, setGuidesIfChanged, setDistanceLabelsIfChanged],
  );

  const handleLayerPointerDown = useCallback(
    (id: string, additive: boolean, e: ReactPointerEvent<HTMLDivElement>) => {
      // Middle-click pans the viewport; ignore other non-primary buttons.
      if (e.button === 1) return;
      if (e.button !== 0) return;
      if (editingLayerIdRef.current) {
        if (id === editingLayerIdRef.current) return;
        onCommitEditRef.current?.();
      }
      const current = selectedIdsRef.current;
      const wasSelected = current.includes(id);
      let ids: string[];
      let onClickWithoutDrag: (() => void) | undefined;

      if (additive) {
        // Figma: modifier+click toggles; modifier+drag still moves the selection
        // (with Shift also locking axis during the gesture).
        if (wasSelected) {
          ids = current;
          onClickWithoutDrag = () => {
            onSelectIdsRef.current(current.filter((x) => x !== id));
          };
        } else {
          ids = [...current, id];
          onSelectIdsRef.current(ids);
        }
      } else if (wasSelected && current.length > 1) {
        ids = current;
      } else {
        ids = [id];
        onSelectRef.current(id, false);
      }

      const layer = layersRef.current.find((l) => l.id === id);
      if (!layer || layer.locked) return;
      const moveIds = ids.filter((sid) => {
        const l = layersRef.current.find((x) => x.id === sid);
        return l && !l.locked && l.type !== 'frame';
      });
      if (!moveIds.length) return;
      e.preventDefault();
      beginSelectionMove(moveIds, e.clientX, e.clientY, {
        onClickWithoutDrag,
        duplicate: e.altKey,
      });
    },
    [beginSelectionMove],
  );

  const startResize = (e: ReactPointerEvent<HTMLDivElement>, corner: HandlePos) => {
    e.stopPropagation();
    e.preventDefault();
    if (!editableSelected.length) return;
    const snapshot = cloneLayers(
      layersRef.current,
      new Set(expandWithDescendants(layersRef.current, editableSelected)),
    );
    const startX = e.clientX;
    const startY = e.clientY;
    const ids = [...editableSelected];
    const origin = selectionBounds(snapshot, ids);
    if (!origin) return;
    gestureDirtyRef.current = false;
    const rails = prepareSnapRails(
      snapshot,
      ids,
      pageSizeRef.current,
      manualGuidesRef.current,
      pageMarginRef.current,
    );

    const raf = createGestureRaf((ev: PointerEvent) => {
      const z = zoomRef.current;
      if (pinchGestureRef.current) return;
      const dx = (ev.clientX - startX) / (z * MM_TO_PX);
      const dy = (ev.clientY - startY) / (z * MM_TO_PX);
      let nextBox = computeResizeBox(origin, corner, dx, dy, {
        aspectLock: ev.shiftKey,
        fromCenter: ev.altKey,
      });
      if (!ev.ctrlKey && !ev.metaKey) {
        const snapped = snapResizeBox(
          snapshot,
          ids,
          nextBox,
          pageSizeRef.current,
          snapThresholdMm(z),
          manualGuidesRef.current,
          rails,
        );
        nextBox = snapped.box;
        setGuidesIfChanged(snapped.guides);
        if (snapToGridRef.current) {
          nextBox = snapRectToGrid(nextBox, gridSizeMmRef.current);
        }
      } else {
        setGuidesIfChanged([]);
      }
      const resized = resizeSelection(snapshot, ids, corner, 0, 0, { targetBox: nextBox });
      applyImperativePreview(resized, ids);
      setGestureBbox(selectionBounds(resized, ids));
    });
    const onMovePtr = (ev: PointerEvent) => raf.schedule(ev);
    const onUp = () => {
      raf.flush();
      setGuidesIfChanged([]);
      endGesture();
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const startRotate = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (!bbox || !editableSelected.length || !frameRef.current) return;
    const snapshot = cloneLayers(
      layersRef.current,
      new Set(expandWithDescendants(layersRef.current, editableSelected)),
    );
    const ids = [...editableSelected];
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const start = clientToMm(e.clientX, e.clientY, frameRect.read(), zoom);
    const startAngle = angleFromCenter(cx, cy, start.xMm, start.yMm);
    gestureDirtyRef.current = false;

    const raf = createGestureRaf((ev: PointerEvent) => {
      const cur = clientToMm(ev.clientX, ev.clientY, frameRect.read(), zoomRef.current);
      const angle = angleFromCenter(cx, cy, cur.xMm, cur.yMm);
      const delta = angle - startAngle;
      const rotated = rotateSelection(snapshot, ids, delta, { snap15: ev.shiftKey });
      applyImperativePreview(rotated, ids);
      setGestureBbox(selectionBounds(rotated, ids));
    });
    const onMovePtr = (ev: PointerEvent) => raf.schedule(ev);
    const onUp = () => {
      raf.flush();
      endGesture();
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const startRadiusResize = (e: ReactPointerEvent<HTMLDivElement>, corner: CornerId) => {
    e.stopPropagation();
    e.preventDefault();
    if (editableSelected.length !== 1) return;
    const id = editableSelected[0]!;
    const snapshot = cloneLayers(layersRef.current, new Set([id]));
    const layer = snapshot.find((l) => l.id === id);
    if (!layer || !layerSupportsCornerRadius(layer)) return;
    const startRadius = cornerRadiusPx(layer.cssVars, corner);
    const startX = e.clientX;
    const startY = e.clientY;
    gestureDirtyRef.current = false;
    setRadiusDrag({ label: `Radius ${Math.round(startRadius)}`, corner });

    const raf = createGestureRaf((ev: PointerEvent) => {
      const z = zoomRef.current;
      if (pinchGestureRef.current) return;
      const dxPx = (ev.clientX - startX) / z;
      const dyPx = (ev.clientY - startY) / z;
      const base = snapshot.find((l) => l.id === id)!;
      const nextR = computeRadiusFromDrag(
        startRadius,
        corner,
        dxPx,
        dyPx,
        maxCornerRadiusPxForLayer(base),
      );
      applyGestureLayers(
        layersWithCornerRadius(snapshot, id, corner, nextR, { independent: ev.altKey }),
      );
      setRadiusDrag({ label: `Radius ${Math.round(nextR)}`, corner });
    });
    const onMovePtr = (ev: PointerEvent) => raf.schedule(ev);
    const onUp = () => {
      raf.flush();
      setRadiusDrag(null);
      endGesture();
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const beginMarquee = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!frameRef.current) return;
    if (editingLayerId) {
      onCommitEdit?.();
    }
    e.stopPropagation();
    e.preventDefault();
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const { xMm, yMm } = clientToMm(e.clientX, e.clientY, frameRect.read(), zoom);
    const origin = { xMm, yMm };
    setMarquee({ x: xMm, y: yMm, w: 0, h: 0 });
    if (!e.shiftKey) onSelectIds([]);

    const raf = createGestureRaf((ev: PointerEvent) => {
      const cur = clientToMm(ev.clientX, ev.clientY, frameRect.read(), zoomRef.current);
      if (pinchGestureRef.current) return;
      const x = Math.min(origin.xMm, cur.xMm);
      const y = Math.min(origin.yMm, cur.yMm);
      setMarquee({
        x,
        y,
        w: Math.abs(cur.xMm - origin.xMm),
        h: Math.abs(cur.yMm - origin.yMm),
      });
    });
    const onMovePtr = (ev: PointerEvent) => raf.schedule(ev);
    const onUp = (ev: PointerEvent) => {
      raf.cancel();
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
      const cur = clientToMm(ev.clientX, ev.clientY, frameRect.read(), zoomRef.current);
      if (pinchGestureRef.current) {
        setMarquee(null);
        return;
      }
      const box: RectMm = {
        x: Math.min(origin.xMm, cur.xMm),
        y: Math.min(origin.yMm, cur.yMm),
        w: Math.abs(cur.xMm - origin.xMm),
        h: Math.abs(cur.yMm - origin.yMm),
      };
      setMarquee(null);
      const currentLayers = layersRef.current;
      if (box.w < 1 && box.h < 1) {
        // Point pick via spatial index so culled (unmounted) layers remain selectable.
        const hits = buildSpatialIndex(currentLayers).hitTest(cur.xMm, cur.yMm);
        const top = hits[0];
        if (top) {
          if (ev.shiftKey) {
            const merged = Array.from(new Set([...selectedIdsRef.current, top]));
            onSelectIds(merged);
          } else {
            onSelect(top);
          }
        } else if (!ev.shiftKey) {
          onSelect(null);
        }
        return;
      }
      const hit =
        currentLayers.length > 30
          ? buildSpatialIndex(currentLayers).query(box)
          : layersInMarquee(currentLayers, box);
      if (ev.shiftKey) {
        const merged = Array.from(new Set([...selectedIdsRef.current, ...hit]));
        onSelectIds(merged);
      } else {
        onSelectIds(hit);
      }
    };
    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const beginPathPointDrag = (
    pointIndex: number,
    kind: 'anchor' | 'hin' | 'hout',
    e: ReactPointerEvent<SVGCircleElement>,
  ) => {
    if (!pathEditLayer || !frameRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const layerId = pathEditLayer.id;
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);

    const raf = createGestureRaf((ev: PointerEvent) => {
      const cur = clientToMm(ev.clientX, ev.clientY, frameRect.read(), zoomRef.current);
      const current = layersRef.current.find((l) => l.id === layerId);
      if (!current) return;
      const next =
        kind === 'anchor'
          ? dragLineAnchor(current, pointIndex, cur.xMm, cur.yMm)
          : dragLineHandle(current, pointIndex, kind, cur.xMm, cur.yMm, !ev.altKey);
      applyGestureLayers(replaceLayerById(layersRef.current, next));
    });
    const onMovePtr = (ev: PointerEvent) => raf.schedule(ev);

    const onUp = () => {
      raf.flush();
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
      endGesture();
    };

    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const beginBend = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!frameRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const targetId =
      pathEditingLayerId ||
      selectedIds.find((id) => displayLayers.find((l) => l.id === id)?.type === 'line');
    if (!targetId) return;
    if (pathEditingLayerId !== targetId) onStartPathEdit?.(targetId);
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const start = clientToMm(e.clientX, e.clientY, frameRect.read(), zoom);
    const applyAt = (xMm: number, yMm: number) => {
      const current = layersRef.current.find((l) => l.id === targetId);
      if (!current || current.type !== 'line') return;
      const next = bendLineAt(current, xMm, yMm);
      applyGestureLayers(replaceLayerById(layersRef.current, next));
    };
    applyAt(start.xMm, start.yMm);

    const raf = createGestureRaf((ev: PointerEvent) => {
      const cur = clientToMm(ev.clientX, ev.clientY, frameRect.read(), zoomRef.current);
      applyAt(cur.xMm, cur.yMm);
    });
    const onMovePtr = (ev: PointerEvent) => raf.schedule(ev);

    const onUp = () => {
      raf.flush();
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
      endGesture();
    };

    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const beginCut = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!frameRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const targetId =
      pathEditingLayerId ||
      selectedIds.find((id) => displayLayers.find((l) => l.id === id)?.type === 'line');
    if (!targetId) return;
    if (pathEditingLayerId !== targetId) onStartPathEdit?.(targetId);
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const cur = clientToMm(e.clientX, e.clientY, frameRect.read(), zoom);
    const current = layersRef.current.find((l) => l.id === targetId);
    if (!current || current.type !== 'line') return;
    const split = cutLineAt(current, cur.xMm, cur.yMm);
    if (!split) return;
    const [left, right] = split;
    const next = layersRef.current.flatMap((l) => (l.id === targetId ? [left, right] : [l]));
    onChangeLayers(next);
    onSelectIds([left.id, right.id]);
  };

  const beginLasso = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!frameRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const start = clientToMm(e.clientX, e.clientY, frameRect.read(), zoom);
    const pts: Array<{ x: number; y: number }> = [{ x: start.xMm, y: start.yMm }];
    setLassoPts(pts);

    const raf = createGestureRaf((ev: PointerEvent) => {
      if (pinchGestureRef.current) return;
      const cur = clientToMm(ev.clientX, ev.clientY, frameRect.read(), zoomRef.current);
      pts.push({ x: cur.xMm, y: cur.yMm });
      setLassoPts([...pts]);
    });
    const onMovePtr = (ev: PointerEvent) => raf.schedule(ev);

    const onUp = () => {
      raf.flush();
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
      setLassoPts(null);
      if (pinchGestureRef.current || pts.length < 3) return;
      const hit = layersRef.current
        .filter((l) => l.type !== 'frame' && l.visible !== false && !l.locked)
        .filter((l) => {
          if (l.type === 'line') return lineIntersectsPolygon(l, pts);
          const x = parseMm(l.cssVars['--translate-x']);
          const y = parseMm(l.cssVars['--translate-y']);
          const w = parseMm(l.cssVars['--width'], 10);
          const h = parseMm(l.cssVars['--height'], 10);
          return rectIntersectsPolygon({ x, y, w, h }, pts);
        })
        .map((l) => l.id);
      if (e.shiftKey) {
        onSelectIds(Array.from(new Set([...selectedIdsRef.current, ...hit])));
      } else {
        onSelectIds(hit);
      }
    };

    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const beginDraw = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!placing || !onDrawLayer || !frameRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const { xMm, yMm } = clientToMm(e.clientX, e.clientY, frameRect.read(), zoom);
    drawStart.current = { xMm, yMm };
    setDraft({ x: xMm, y: yMm, w: 0, h: 0 });

    const raf = createGestureRaf((ev: PointerEvent) => {
      if (!drawStart.current) return;
      if (pinchGestureRef.current) return;
      const cur = clientToMm(ev.clientX, ev.clientY, frameRect.read(), zoomRef.current);
      const constrainSquare =
        ev.shiftKey && isSquareConstrainTool(tool);
      const next = normalizeDrawRect(drawStart.current.xMm, drawStart.current.yMm, cur.xMm, cur.yMm, {
        constrainSquare,
      });
      if (tool === 'line') {
        next.x0 = drawStart.current.xMm;
        next.y0 = drawStart.current.yMm;
        next.x1 = cur.xMm;
        next.y1 = cur.yMm;
      }
      setDraft(next);
    });
    const onMovePtr = (ev: PointerEvent) => raf.schedule(ev);

    const onUp = (ev: PointerEvent) => {
      raf.cancel();
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
      if (!drawStart.current) {
        setDraft(null);
        return;
      }
      const cur = clientToMm(ev.clientX, ev.clientY, frameRect.read(), zoomRef.current);
      let result = normalizeDrawRect(drawStart.current.xMm, drawStart.current.yMm, cur.xMm, cur.yMm, {
        constrainSquare:
          ev.shiftKey && isSquareConstrainTool(tool),
      });
      if (tool === 'line') {
        result.x0 = drawStart.current.xMm;
        result.y0 = drawStart.current.yMm;
        result.x1 = cur.xMm;
        result.y1 = cur.yMm;
      }
      if (isClickPlace(result)) {
        result = { x: drawStart.current.xMm, y: drawStart.current.yMm, w: 0, h: 0 };
      }
      drawStart.current = null;
      setDraft(null);
      if (!pinchGestureRef.current) onDrawLayer(tool, result);
    };

    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  /** Drag an existing guide: live preview, drop on the ruler to remove, Esc to cancel. */
  const beginGuideDrag = (g: CanvasGuide, e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (!frameRef.current) return;
    const original = g.posMm;
    let lastPos = g.posMm;
    let willRemove = false;
    let cancelled = false;
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const viewportRect = viewportRef.current?.getBoundingClientRect() ?? null;
    setGuideDrag({ id: g.id, posMm: g.posMm, clientX: e.clientX, clientY: e.clientY, willRemove: false });

    const raf = createGestureRaf((ev: PointerEvent) => {
      if (cancelled) return;
      const cur = clientToMm(ev.clientX, ev.clientY, frameRect.read(), zoomRef.current);
      const max = g.axis === 'x' ? pageSizeRef.current.widthMm : pageSizeRef.current.heightMm;
      lastPos = clampGuidePos(g.axis === 'x' ? cur.xMm : cur.yMm, max);
      willRemove = viewportRect
        ? isGuideRemovalPoint(g.axis, ev.clientX, ev.clientY, viewportRect, RULER_SIZE)
        : false;
      setGuideDrag({ id: g.id, posMm: lastPos, clientX: ev.clientX, clientY: ev.clientY, willRemove });
    });

    const cleanup = () => {
      raf.cancel();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };

    const onMove = (ev: PointerEvent) => raf.schedule(ev);

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      cancelled = true;
      cleanup();
      setGuideDrag(null);
    };

    const onUp = () => {
      raf.flush();
      cleanup();
      setGuideDrag(null);
      if (cancelled) return;
      if (willRemove) onRemoveGuide?.(g.id);
      else if (lastPos !== original) onMoveGuide?.(g.id, lastPos);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
  };

  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      startPanDrag(e);
      return;
    }
    if (e.button !== 0) return;
    if (canPanTool) {
      startPanDrag(e);
      return;
    }
  };

  // Figma-like camera: page is always laid out at design resolution (A4 CSS px).
  // CSS `zoom` on the artboard is the camera — it must NOT re-layout layers/text.
  const designW = A4_WIDTH_PX;
  const designH = A4_HEIGHT_PX;
  const visualW = Math.round(A4_WIDTH_PX * zoom);
  const visualH = Math.round(A4_HEIGHT_PX * zoom);
  const panX = Math.round(pan.x);
  const panY = Math.round(pan.y);
  const guideHit = screenChromePx(GUIDE_HIT_PX, zoom);
  const guideLine = screenChromePx(GUIDE_LINE_PX, zoom);

  const cursor = panning
    ? 'grabbing'
    : canPanTool
      ? 'grab'
      : placing || tool === 'bend' || tool === 'cut' || tool === 'lasso'
        ? 'crosshair'
        : 'default';

  return (
    <div
      ref={viewportRef}
      className="canvas-dot-bg absolute inset-0 overflow-hidden"
      data-testid="canvas-viewport"
      data-canvas-tool={tool}
      data-canvas-panning={panning ? '1' : undefined}
      style={{ cursor, touchAction: 'none' }}
      onPointerDown={onCanvasPointerDown}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(null, e.clientX, e.clientY);
      }}
    >
      {showRulers && (
        <CanvasRulers
          zoom={zoom}
          pan={pan}
          pageWidthMm={document.page.widthMm}
          pageHeightMm={document.page.heightMm}
          pageIndex={pageIndex}
          onCreateGuide={handleCreateGuide}
          onCancelCreate={handleCancelGuideCreate}
        />
      )}

      <div
        data-testid="canvas-pan-layer"
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: visualW,
          height: visualH,
          // Compositor pan (avoids left/top layout thrash on every wheel/drag tick).
          transform: `translate3d(calc(-50% + ${panX}px), calc(-50% + ${panY}px), 0)`,
          willChange: panning ? 'transform' : undefined,
        }}
      >
        <div
          ref={frameRef}
          data-testid="canvas-artboard"
          style={{
            position: 'relative',
            width: designW,
            height: designH,
            // Camera zoom (Chromium/Electron): re-rasterizes crisply without reflowing text.
            zoom,
            background: '#ffffff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 12px 40px rgba(0,0,0,0.14)',
            cursor: canPanTool || panning ? cursor : placing ? 'crosshair' : 'default',
            // Design default; do not inherit .canvas-app UI tracking (-0.01em).
            letterSpacing: 'normal',
          }}
          onPointerDown={(e) => {
            if (e.button === 1 || canPanTool) {
              startPanDrag(e);
              return;
            }
            if (placing) {
              beginDraw(e);
              return;
            }
            if (tool === 'lasso' && e.button === 0) {
              beginLasso(e);
              return;
            }
            if (tool === 'bend' && e.button === 0) {
              beginBend(e);
              return;
            }
            if (tool === 'cut' && e.button === 0) {
              beginCut(e);
              return;
            }
            if (tool === 'select' && e.button === 0) {
              beginMarquee(e);
            }
          }}
        >
          {pageMarginMm > 0 && (
            <div
              data-testid="canvas-page-margin"
              aria-hidden
              style={{
                position: 'absolute',
                left: `${pageMarginMm}mm`,
                top: `${pageMarginMm}mm`,
                right: `${pageMarginMm}mm`,
                bottom: `${pageMarginMm}mm`,
                border: '1px dashed rgba(255, 87, 34, 0.45)',
                pointerEvents: 'none',
                zIndex: 1,
                boxSizing: 'border-box',
              }}
            />
          )}
          <div
            style={{
              position: 'absolute',
              top: -22,
              left: 0,
              fontSize: 11,
              lineHeight: '16px',
              color: '#8c8c8c',
              background: 'var(--cv-panel)',
              padding: '1px 6px',
              borderRadius: 3,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            Página A4 — 210 × 297 mm · {Math.round(zoom * 100)}%
            {placing && (
              <span style={{ marginLeft: 8, color: 'var(--cv-accent)' }}>· Arrastra para dibujar</span>
            )}
            {editableSelected.length > 1 && (
              <span style={{ marginLeft: 8, color: 'var(--cv-accent)' }}>
                · {editableSelected.length} seleccionados
              </span>
            )}
          </div>

          {renderLayers.map((layer) => (
            <LayerNode
              key={layer.id}
              layer={layer}
              selected={selectedIdSet.has(layer.id)}
              moving={(gestureLayers !== null || gestureActive) && selectedIdSet.has(layer.id)}
              panning={panning || cameraMoving}
              interactive={interactive && !panning}
              editing={editingLayerId === layer.id}
              pathEditing={pathEditingLayerId === layer.id}
              editingSelectAll={editingSelectAll}
              scale={1}
              onSelect={handleSelect}
              onLayerPointerDown={handleLayerPointerDown}
              onContextMenu={onContextMenu}
              onStartEdit={onStartEdit}
              onEditValue={onEditValue}
              onFitTextHeight={onFitTextHeight}
              onCommitEdit={onCommitEdit}
              onStartPathEdit={onStartPathEdit}
            />
          ))}

          {pathEditLayer && (
            <PathHandlesOverlay
              layer={ensureLinePath(pathEditLayer)}
              zoom={1}
              onPointPointerDown={beginPathPointDrag}
            />
          )}

          {lassoPts && lassoPts.length > 1 && (
            <svg
              data-testid="canvas-lasso"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 50,
                overflow: 'visible',
              }}
            >
              <polyline
                fill="rgba(24,160,251,0.08)"
                stroke="var(--cv-accent)"
                strokeWidth={1}
                points={lassoPts.map((p) => `${mmToScreenPx(p.x, 1)},${mmToScreenPx(p.y, 1)}`).join(' ')}
              />
            </svg>
          )}

          <SmartGuidesOverlay guides={guides} zoom={zoom} />

          {displayGuides.map((g) => {
            const removing = guideDrag?.id === g.id && guideDrag.willRemove;
            return (
              <div
                key={g.id}
                data-testid="canvas-manual-guide"
                data-axis={g.axis}
                onPointerDown={(e) => beginGuideDrag(g, e)}
                style={
                  g.axis === 'x'
                    ? {
                        position: 'absolute',
                        left: mmToScreenPx(g.posMm, 1),
                        top: 0,
                        width: guideHit,
                        height: '100%',
                        marginLeft: -guideHit / 2,
                        cursor: 'ew-resize',
                        zIndex: 44,
                      }
                    : {
                        position: 'absolute',
                        top: mmToScreenPx(g.posMm, 1),
                        left: 0,
                        height: guideHit,
                        width: '100%',
                        marginTop: -guideHit / 2,
                        cursor: 'ns-resize',
                        zIndex: 44,
                      }
                }
              >
                <div
                  style={
                    g.axis === 'x'
                      ? {
                          position: 'absolute',
                          left: '50%',
                          top: 0,
                          width: guideLine,
                          height: '100%',
                          marginLeft: -guideLine / 2,
                          background: removing ? 'var(--cv-danger)' : 'var(--cv-accent)',
                          pointerEvents: 'none',
                        }
                      : {
                          position: 'absolute',
                          top: '50%',
                          left: 0,
                          height: guideLine,
                          width: '100%',
                          marginTop: -guideLine / 2,
                          background: removing ? 'var(--cv-danger)' : 'var(--cv-accent)',
                          pointerEvents: 'none',
                        }
                  }
                />
              </div>
            );
          })}

          {guideDrag && (
            <GuidePositionChip
              x={guideDrag.clientX}
              y={guideDrag.clientY}
              danger={guideDrag.willRemove}
              label={guideDrag.willRemove ? 'Eliminar guía' : formatGapMm(guideDrag.posMm)}
            />
          )}

          {distanceLabels.map((d) => (
            <div key={d.id} data-testid="canvas-distance-label" style={{ pointerEvents: 'none', zIndex: 46 }}>
              <div
                style={{
                  position: 'absolute',
                  left: mmToScreenPx(Math.min(d.x1, d.x2), 1),
                  top: mmToScreenPx(Math.min(d.y1, d.y2), 1),
                  width: Math.max(1, mmToScreenPx(Math.abs(d.x2 - d.x1), 1)),
                  height: Math.max(1, mmToScreenPx(Math.abs(d.y2 - d.y1), 1)),
                  borderTop: d.axis === 'x' ? '1px solid var(--cv-accent-2)' : undefined,
                  borderLeft: d.axis === 'y' ? '1px solid var(--cv-accent-2)' : undefined,
                  boxSizing: 'border-box',
                }}
              />
              <MeasurementBadge
                testId="canvas-distance-value"
                label={formatGapMm(d.valueMm)}
                style={{
                  position: 'absolute',
                  left: mmToScreenPx(d.x, 1),
                  top: mmToScreenPx(d.y, 1),
                  transform: 'translate(-50%, -50%)',
                }}
              />
            </div>
          ))}

          {marquee && marquee.w + marquee.h > 0 && (
            <div
              data-testid="canvas-marquee"
              style={{
                position: 'absolute',
                left: mmToScreenPx(marquee.x, 1),
                top: mmToScreenPx(marquee.y, 1),
                width: Math.max(mmToScreenPx(marquee.w, 1), 1),
                height: Math.max(mmToScreenPx(marquee.h, 1), 1),
                border: '1px solid var(--cv-accent)',
                background: 'color-mix(in srgb, var(--cv-accent) 8%, transparent)',
                pointerEvents: 'none',
                zIndex: 50,
                boxSizing: 'border-box',
              }}
            />
          )}

          {draft && draft.w + draft.h > 0 && tool === 'line' && draft.x0 != null && draft.y0 != null && draft.x1 != null && draft.y1 != null && (
            <svg
              data-testid="canvas-draw-draft"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 50,
                overflow: 'visible',
              }}
            >
              <line
                x1={mmToScreenPx(draft.x0, 1)}
                y1={mmToScreenPx(draft.y0, 1)}
                x2={mmToScreenPx(draft.x1, 1)}
                y2={mmToScreenPx(draft.y1, 1)}
                stroke="var(--cv-accent)"
                strokeWidth={1.5}
              />
            </svg>
          )}

          {draft && draft.w + draft.h > 0 && tool !== 'line' && (
            <div
              data-testid="canvas-draw-draft"
              style={{
                position: 'absolute',
                left: mmToScreenPx(draft.x, 1),
                top: mmToScreenPx(draft.y, 1),
                width: Math.max(mmToScreenPx(draft.w, 1), 1),
                height: Math.max(mmToScreenPx(draft.h, 1), 1),
                border: '1.5px solid var(--cv-accent)',
                background: 'color-mix(in srgb, var(--cv-accent) 8%, transparent)',
                borderRadius: tool === 'ellipse' ? '50%' : 0,
                clipPath: clipPathForLayerType(tool),
                pointerEvents: 'none',
                zIndex: 50,
                boxSizing: 'border-box',
              }}
            />
          )}

          {chromeBbox && interactive && !panning && !editingLayerId && (
            <SelectionChromeOverlay
              bbox={chromeBbox}
              zoom={zoom}
              showRadiusHandles={showRadiusHandles}
              cornerRadii={cornerRadii}
              radiusDragLabel={radiusDrag?.label ?? null}
              radiusDragCorner={radiusDrag?.corner ?? null}
              onResize={startResize}
              onRotate={startRotate}
              onRadiusResize={startRadiusResize}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(Artboard);
