import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useLiveRef } from '../../../hooks/useLiveRef';
import type { CanvasDocument, CanvasGuide, CanvasLayer, CanvasTool } from '../types';
import { A4_HEIGHT_PX, A4_WIDTH_PX, resolvePageMarginMm } from '../types';
import {
  clientToMm,
  isPlaceTool,
  mmToScreenPx,
  type DrawRect,
} from '../ops/drawHelpers';
import { clipPathForLayerType } from '../ops/shapePaths';
import {
  selectionBounds,
  prepareSnapRails,
  smartGuidesEqual,
  type RectMm,
  type SmartGuide,
  DEFAULT_GRID_MM,
} from '../ops/selectionTransform';
import { buildSpatialIndex } from '../ops/spatialIndex';
import { layerBounds } from '../ops/layerBounds';
import {
  formatGapMm,
  guidesForPage,
  measureHoverGap,
  type DistanceLabel,
} from '../ops/guides';
import { expandWithDescendants } from '../ops/layerTree';
import { applyWheelBurst } from '../ops/viewportNav';
import { CULLING_MARGIN_MM, filterVisibleLayers, visiblePageRectMm } from '../ops/viewportCulling';
import { compositionHiddenLayerIds } from '../ops/booleanOps';
import { createWheelGestureRaf } from '../ops/gestureRaf';
import {
  createPointerGestureOwner,
  type PointerGestureOwner,
} from '../ops/pointerGestureSession';
import {
  applyLayerDomGeometry,
  clearLayerDomGestureStyles,
  setCanvasGestureActive,
} from '../ops/imperativeLayerDom';
import {
  layerSupportsCornerRadius,
} from '../ops/cornerRadiusGesture';
import { usePinchZoom } from '../hooks/usePinchZoom';
import { ensureLinePath } from '../ops/pathGeometry';
import { cornerRadiusPx, type CornerId } from '../ops/layerStyle';
import type {
  InlineEditStartOpts,
  InlineSelectionRange,
  InlineTextStyle,
} from '../ops/inlineEdit';
import CanvasRulers, { GuidePositionChip, MeasurementBadge } from './CanvasRulers';
import GuideContextMenu from './GuideContextMenu';
import { createArtboardToolGestures } from './artboardToolGestures';
import { createArtboardViewportGestures } from './artboardViewportGestures';
import {
  createArtboardTransformGestures,
  createArtboardPathGapGestures,
} from './artboardTransformGestures';
import {
  createArtboardSelectionHandlers,
  createSelectionMoveStarter,
} from './artboardSelectionGestures';
import { useArtboardGuideInteraction } from './useArtboardGuideInteraction';
import LayerNode from './LayerNode';
import PathHandlesOverlay from './PathHandlesOverlay';
import { SelectionChromeOverlay } from './SelectionChromeOverlay';
import { SmartSelectionOverlay } from './SmartSelectionOverlay';
import { screenChromePx } from '../ops/textTypography';
import { detectSmartSequence } from '../ops/smartSelection';

const GUIDE_HIT_PX = 10;
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
  onPreviewLayers?: (layers: CanvasLayer[]) => void;
  onCommitGesture?: () => void;
  onCancelGesture?: () => void;
  onZoom?: (zoom: number) => void;
  onDrawLayer?: (tool: CanvasTool, rect: DrawRect) => void;
  onContextMenu?: (
    layerId: string | null,
    clientX: number,
    clientY: number,
    pointMm?: { x: number; y: number },
  ) => void;
  onStartEdit?: (id: string, opts?: InlineEditStartOpts) => void;
  onEditValue?: (id: string, value: string, contentHeightPx?: number) => void;
  onFitTextHeight?: (id: string, contentHeightPx: number) => void;
  onEditStyle?: (id: string, style: InlineTextStyle) => void;
  onCommitEdit?: () => void;
  editingSelectAll?: boolean;
  editingRange?: InlineSelectionRange | null;
  onStartPathEdit?: (id: string) => void;
  onUpsertGuide?: (guide: CanvasGuide) => void;
  onCommitGuideCreate?: (guide: CanvasGuide) => void;
  onMoveGuide?: (id: string, posMm: number) => void;
  onNudgeGuide?: (id: string, deltaMm: number) => void;
  onRemoveGuide?: (id: string) => void;
  onCancelGuideCreate?: (id: string) => void;
  showRulers?: boolean;
  snapToGrid?: boolean;
  gridSizeMm?: number;
  onStartInertia?: (velocity: { vx: number; vy: number }) => void;
  onCancelInertia?: () => void;
  gestureAbortToken?: number;
  enteredGroupId?: string | null;
  onExitGroupEdit?: () => void;
  eyedropperActive?: boolean;
  onEyedropperPick?: (color: string) => void;
  camera?: {
    subscribe: (listener: (zoom: number, pan: { x: number; y: number }) => void) => () => void;
    getZoom: () => number;
    getPan: () => { x: number; y: number };
  };
}

const SmartGuidesOverlay = memo(function SmartGuidesOverlay({
  guides,
  zoom,
}: {
  guides: SmartGuide[];
  zoom: number;
}) {
  if (!guides.length) return null;
  const strokeW = screenChromePx(1, zoom);
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
  onCancelGesture,
  onZoom,
  onDrawLayer,
  onContextMenu,
  onStartEdit,
  onEditValue,
  onFitTextHeight,
  onEditStyle,
  onCommitEdit,
  editingSelectAll = true,
  editingRange = null,
  onStartPathEdit,
  onUpsertGuide,
  onCommitGuideCreate,
  onMoveGuide,
  onNudgeGuide,
  onRemoveGuide,
  onCancelGuideCreate,
  showRulers = false,
  snapToGrid = false,
  gridSizeMm = DEFAULT_GRID_MM,
  onStartInertia,
  onCancelInertia,
  gestureAbortToken = 0,
  enteredGroupId = null,
  onExitGroupEdit,
  eyedropperActive = false,
  onEyedropperPick,
  camera,
}: ArtboardProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const panLayerRef = useRef<HTMLDivElement>(null);
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
  const [hoverLabels, setHoverLabels] = useState<DistanceLabel[]>([]);
  const hoverLabelsRef = useRef<DistanceLabel[]>([]);

  const enteredGroupIdRef = useRef<string | null>(enteredGroupId);
  enteredGroupIdRef.current = enteredGroupId;
  const eyedropperActiveRef = useRef(eyedropperActive);
  eyedropperActiveRef.current = eyedropperActive;
  const onEyedropperPickRef = useRef(onEyedropperPick);
  onEyedropperPickRef.current = onEyedropperPick;
  const onExitGroupEditRef = useRef(onExitGroupEdit);
  onExitGroupEditRef.current = onExitGroupEdit;

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

  const setHoverLabelsIfChanged = useCallback((next: DistanceLabel[]) => {
    const prev = hoverLabelsRef.current;
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
    hoverLabelsRef.current = next;
    setHoverLabels(next);
  }, []);
  const [panning, setPanning] = useState(false);
  const [cameraMoving, setCameraMoving] = useState(false);
  const pinchGestureRef = useRef(false);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number } | null>(null);
  const [gestureLayers, setGestureLayers] = useState<CanvasLayer[] | null>(null);
  const [gestureActive, setGestureActive] = useState(false);
  const [gestureBbox, setGestureBbox] = useState<RectMm | null>(null);
  const gestureDirtyRef = useRef(false);
  const gestureLayersRef = useRef<CanvasLayer[] | null>(null);
  const imperativeMoveIdsRef = useRef<string[] | null>(null);
  const layersRef = useRef(document.layers);
  const pointerGesturesRef = useRef<PointerGestureOwner | null>(null);
  if (!pointerGesturesRef.current) pointerGesturesRef.current = createPointerGestureOwner();
  const pointerGestures = pointerGesturesRef.current;

  const onPreviewLayersRef = useRef(onPreviewLayers);
  onPreviewLayersRef.current = onPreviewLayers;
  const onCommitGestureRef = useRef(onCommitGesture);
  onCommitGestureRef.current = onCommitGesture;
  const onCancelGestureRef = useRef(onCancelGesture);
  onCancelGestureRef.current = onCancelGesture;
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
  const {
    guideDrag,
    displayGuides,
    guideDistanceLabels,
    selectedGuideId,
    setSelectedGuideId,
    guideMenu,
    setGuideMenu,
    manualGuidesRef,
    updateGuideMeasurements,
    resetGuideDrag,
    handleCreateGuide,
    handleCommitGuideCreate,
    handleCancelGuideCreate,
    beginGuideDrag,
    onGuideKeyDown,
  } = useArtboardGuideInteraction({
    frameRef,
    viewportRef,
    zoomRef,
    layersRef,
    pageSizeRef,
    pageMarginRef,
    onSelectIdsRef,
    pointerGestures,
    pageIndex,
    pageGuides,
    onCancelInertia,
    onMoveGuide,
    onRemoveGuide,
    onNudgeGuide,
    onUpsertGuide,
    onCommitGuideCreate,
    onCancelGuideCreate,
  });
  const guideSnapRails = useMemo(
    () => prepareSnapRails(document.layers, [], document.page, pageGuides, pageMarginMm),
    [document.layers, document.page, pageGuides, pageMarginMm],
  );
  const snapToGridRef = useRef(snapToGrid);
  snapToGridRef.current = snapToGrid;
  const gridSizeMmRef = useRef(gridSizeMm);
  gridSizeMmRef.current = gridSizeMm > 0 ? gridSizeMm : DEFAULT_GRID_MM;

  const applyGestureLayers = useCallback((layers: CanvasLayer[]) => {
    if (pinchGestureRef.current) return;
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

  const abortGesturePreview = useCallback(
    (restore?: { layers: CanvasLayer[]; ids: string[] }) => {
      const frame = frameRef.current;
      const ids = restore?.ids ?? imperativeMoveIdsRef.current;
      if (frame && restore && ids?.length) {
        applyLayerDomGeometry(frame, restore.layers, ids, { willChange: false });
        clearLayerDomGestureStyles(frame, restore.layers, ids);
        layersRef.current = restore.layers;
      } else if (frame && gestureLayersRef.current && ids?.length) {
        clearLayerDomGestureStyles(frame, gestureLayersRef.current, ids);
      }
      gestureDirtyRef.current = false;
      gestureLayersRef.current = null;
      imperativeMoveIdsRef.current = null;
      setGestureLayers(null);
      setGestureActive(false);
      setGestureBbox(null);
      setCanvasGestureActive(false);
      setGuidesIfChanged([]);
      setDistanceLabelsIfChanged([]);
      // El preview vivo ya llegó al documento vía onPreviewLayers/updateSilent; sin
      // avisar al dueño del baseline quedaba el gesto abortado sin entrada en el
      // historial y el baseline apuntando a un preview muerto.
      onCancelGestureRef.current?.();
    },
    [setGuidesIfChanged, setDistanceLabelsIfChanged],
  );

  const prevAbortTokenRef = useRef(gestureAbortToken);
  useEffect(() => {
    if (gestureAbortToken === prevAbortTokenRef.current) return;
    prevAbortTokenRef.current = gestureAbortToken;
    pointerGestures.abort();
    abortGesturePreview();
    setMarquee(null);
    setDraft(null);
    setLassoPts(null);
    resetGuideDrag();
    setPanning(false);
    setRadiusDrag(null);
  }, [gestureAbortToken, abortGesturePreview, pointerGestures, resetGuideDrag]);

  useEffect(() => () => pointerGestures.dispose(), [pointerGestures]);

  useLayoutEffect(() => {
    if (!gestureActive || !imperativeMoveIdsRef.current || !gestureLayersRef.current) return;
    const frame = frameRef.current;
    if (!frame) return;
    applyLayerDomGeometry(frame, gestureLayersRef.current, imperativeMoveIdsRef.current);
  }, [gestureActive]);

  const navRef = useRef({ zoom, pan, onZoom, onPan });
  navRef.current = { zoom, pan, onZoom, onPan };

  const cameraMovingRef = useRef(false);
  const cameraMovingTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!camera) return;
    return camera.subscribe((z, p) => {
      zoomRef.current = z;
      navRef.current.zoom = z;
      navRef.current.pan = p;
      const panLayer = panLayerRef.current;
      if (panLayer) {
        panLayer.style.transform = `translate3d(calc(-50% + ${p.x}px), calc(-50% + ${p.y}px), 0)`;
      }
      const frame = frameRef.current;
      if (frame) {
        frame.style.transform = `scale(${z})`;
        frame.style.setProperty('--cv-camera-zoom', String(z));
      }
      if (!cameraMovingRef.current) {
        cameraMovingRef.current = true;
        setCameraMoving(true);
      }
      if (cameraMovingTimerRef.current != null) {
        window.clearTimeout(cameraMovingTimerRef.current);
      }
      cameraMovingTimerRef.current = window.setTimeout(() => {
        cameraMovingTimerRef.current = null;
        cameraMovingRef.current = false;
        setCameraMoving(false);
      }, 140);
    });
  }, [camera]);

  useEffect(
    () => () => {
      if (cameraMovingTimerRef.current != null) {
        window.clearTimeout(cameraMovingTimerRef.current);
      }
    },
    [],
  );

  usePinchZoom(viewportRef, navRef, {
    activeRef: pinchGestureRef,
    onStart: () => {
      onCancelInertia?.();
      pointerGestures.abort();
      setMarquee(null);
      setDraft(null);
      setGuidesIfChanged([]);
      setDistanceLabelsIfChanged([]);
      setLassoPts(null);
      setPanning(false);
    },
  });
  const selectedIdsRef = useLiveRef(selectedIds);

  const displayLayers = gestureLayers ?? document.layers;
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
  const masterById = useMemo(() => {
    const map = new Map<string, CanvasLayer>();
    for (const l of displayLayers) {
      if (l.meta?.componentId) map.set(l.meta.componentId, l);
      else if (l.type === 'component' && !l.meta?.instanceOf) map.set(l.id, l);
    }
    return map;
  }, [displayLayers]);

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
    const compositionHidden = compositionHiddenLayerIds(contentLayers);
    return filterVisibleLayers(contentLayers, viewRectMm, always).filter(
      (layer) => !compositionHidden.has(layer.id),
    );
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
  const smartSeq = useMemo(() => {
    if (
      !interactive ||
      editingLayerId ||
      pathEditingLayerId ||
      marquee ||
      draft ||
      lassoPts ||
      eyedropperActive ||
      editableSelected.length < 2
    ) {
      return null;
    }
    return detectSmartSequence(displayLayers, editableSelected);
  }, [
    interactive,
    editingLayerId,
    pathEditingLayerId,
    marquee,
    draft,
    lassoPts,
    eyedropperActive,
    editableSelected,
    displayLayers,
  ]);
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

  const clientPointMm = useCallback((clientX: number, clientY: number) => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const { xMm, yMm } = clientToMm(
      clientX,
      clientY,
      frame.getBoundingClientRect(),
      zoomRef.current,
    );
    return { x: xMm, y: yMm };
  }, []);

  const onFramePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const idle =
        e.altKey &&
        interactive &&
        !panning &&
        !gestureActive &&
        !gestureDirtyRef.current &&
        !editingLayerId &&
        !pathEditingLayerId &&
        !marquee &&
        !draft &&
        !lassoPts;
      if (!idle) {
        if (hoverLabelsRef.current.length) setHoverLabelsIfChanged([]);
        return;
      }
      const ids = selectedIdsRef.current;
      const frame = frameRef.current;
      const sel = ids.length ? selectionBounds(layersRef.current, ids) : null;
      if (!sel || !frame) {
        if (hoverLabelsRef.current.length) setHoverLabelsIfChanged([]);
        return;
      }
      const cur = clientToMm(
        e.clientX,
        e.clientY,
        frame.getBoundingClientRect(),
        zoomRef.current,
      );
      const selSet = new Set(ids);
      const hits = buildSpatialIndex(layersRef.current).hitTest(cur.xMm, cur.yMm);
      const targetId = hits.find((hit) => !selSet.has(hit));
      const targetLayer = targetId ? layersRef.current.find((l) => l.id === targetId) : null;
      const rect = targetLayer ? layerBounds(targetLayer) : null;
      setHoverLabelsIfChanged(measureHoverGap(sel, rect, pageSizeRef.current));
    },
    [
      interactive,
      panning,
      gestureActive,
      editingLayerId,
      pathEditingLayerId,
      marquee,
      draft,
      lassoPts,
      setHoverLabelsIfChanged,
    ],
  );

  const onFramePointerLeave = useCallback(() => {
    if (hoverLabelsRef.current.length) setHoverLabelsIfChanged([]);
  }, [setHoverLabelsIfChanged]);



  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (!viewportSize) {
      const { width, height } = el.getBoundingClientRect();
      if (width >= 1 && height >= 1) {
        setViewportSize({ w: width, h: height });
      }
    }
  }, [viewportSize]);

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



  useEffect(() => {
    if (!selectedIds.length || tool !== 'select') setHoverLabelsIfChanged([]);
  }, [selectedIds.length, tool, setHoverLabelsIfChanged]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && hoverLabelsRef.current.length) setHoverLabelsIfChanged([]);
    };
    window.addEventListener('keyup', onKey);
    return () => window.removeEventListener('keyup', onKey);
  }, [setHoverLabelsIfChanged]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
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
    const raf = createWheelGestureRaf((segments) => {
      const { zoom: z, pan: p, onZoom: setZ, onPan: setP } = navRef.current;
      if (rectDirty) refreshViewportRect();
      const next = applyWheelBurst({ zoom: z, pan: p }, segments, (segment) => ({
        x: segment.clientX - viewportRect.left - viewportRect.width / 2,
        y: segment.clientY - viewportRect.top - viewportRect.height / 2,
      }));
      if (next.zoom !== z) setZ?.(next.zoom);
      if (next.pan.x !== p.x || next.pan.y !== p.y) setP(next.pan);
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

  const beginSelectionMove = useMemo(
    () =>
      createSelectionMoveStarter({
        frameRef,
        zoomRef,
        layersRef,
        pinchGestureRef,
        gestureDirtyRef,
        gestureLayersRef,
        imperativeMoveIdsRef,
        pageSizeRef,
        manualGuidesRef,
        pageMarginRef,
        snapToGridRef,
        gridSizeMmRef,
        selectedIdsRef,
        onSelectIdsRef,
        onPreviewLayersRef,
        pointerGestures,
        applyGestureLayers,
        endGesture,
        abortGesturePreview,
        setGuidesIfChanged,
        setDistanceLabelsIfChanged,
        setGestureActive,
        setGestureBbox,
      }),
    [
      abortGesturePreview,
      applyGestureLayers,
      endGesture,
      pointerGestures,
      setDistanceLabelsIfChanged,
      setGestureBbox,
      setGestureActive,
      setGuidesIfChanged,
    ],
  );

  const enteredDescendants = useCallback((): Set<string> | null => {
    const gid = enteredGroupIdRef.current;
    if (!gid) return null;
    const layers = layersRef.current;
    if (!layers.some((l) => l.id === gid)) return null;
    const set = new Set(expandWithDescendants(layers, [gid]));
    set.delete(gid);
    return set;
  }, []);

  const pickHit = useCallback(
    (
      clientX: number,
      clientY: number,
      opts?: { within?: Set<string> | null; skipSelected?: boolean },
    ): string | null => {
      const point = clientPointMm(clientX, clientY);
      if (!point) return null;
      let hits = buildSpatialIndex(layersRef.current).hitTest(point.x, point.y);
      if (opts?.within) hits = hits.filter((h) => opts.within!.has(h));
      if (!opts?.skipSelected) return hits[0] ?? null;
      const selSet = new Set(selectedIdsRef.current);
      return hits.find((h) => !selSet.has(h)) ?? hits[0] ?? null;
    },
    [clientPointMm],
  );

  const { handleLayerPointerDown } = createArtboardSelectionHandlers({
    layersRef,
    selectedIdsRef,
    editingLayerIdRef,
    eyedropperActiveRef,
    onEyedropperPickRef,
    onExitGroupEditRef,
    onSelectIdsRef,
    onSelectRef,
    onCommitEditRef,
    onCancelInertia,
    enteredDescendants,
    pickHit,
    beginSelectionMove,
  });

  const { startResize, startRotate, startRadiusResize } = createArtboardTransformGestures({
    frameRef,
    zoomRef,
    layersRef,
    pinchGestureRef,
    gestureDirtyRef,
    pageSizeRef,
    manualGuidesRef,
    pageMarginRef,
    snapToGridRef,
    gridSizeMmRef,
    pointerGestures,
    editableSelected,
    bbox,
    onCancelInertia,
    applyImperativePreview,
    applyGestureLayers,
    endGesture,
    abortGesturePreview,
    setGuidesIfChanged,
    setGestureBbox,
    setRadiusDrag,
  });

  const { startPanDrag, beginMarquee } = createArtboardViewportGestures({
    frameRef,
    zoomRef,
    layersRef,
    navRef,
    pinchGestureRef,
    selectedIdsRef,
    onExitGroupEditRef,
    pointerGestures,
    editingLayerId,
    onCommitEdit,
    onCancelInertia,
    onStartInertia,
    onSelect,
    onSelectIds,
    enteredDescendants,
    setPanning,
    setMarquee,
  });

  const { beginGapDrag, tidySmartSelection, beginPathPointDrag } = createArtboardPathGapGestures({
    frameRef,
    zoomRef,
    layersRef,
    gestureDirtyRef,
    pointerGestures,
    pathEditLayer,
    onCancelInertia,
    applyGestureLayers,
    endGesture,
    abortGesturePreview,
  });

  const { beginBend, beginCut, beginLasso, beginDraw } = createArtboardToolGestures({
    frameRef,
    zoomRef,
    layersRef,
    pinchGestureRef,
    drawStart,
    selectedIdsRef,
    pointerGestures,
    selectedIds,
    displayLayers,
    pathEditingLayerId,
    placing,
    tool,
    onDrawLayer,
    onStartPathEdit,
    onChangeLayers,
    onSelectIds,
    applyGestureLayers,
    endGesture,
    abortGesturePreview,
    setDraft,
    setLassoPts,
  });

  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      startPanDrag(e);
      return;
    }
    onCancelInertia?.();
    if (e.button !== 0) return;
    if (canPanTool) {
      startPanDrag(e);
      return;
    }
  };

  const designW = A4_WIDTH_PX;
  const designH = A4_HEIGHT_PX;
  const panX = pan.x;
  const panY = pan.y;
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
      onPointerDownCapture={() => onCancelInertia?.()}
      onPointerDown={onCanvasPointerDown}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(null, e.clientX, e.clientY, clientPointMm(e.clientX, e.clientY));
      }}
    >
      {showRulers && (
        <CanvasRulers
          zoom={zoom}
          pan={pan}
          camera={camera}
          pageWidthMm={document.page.widthMm}
          pageHeightMm={document.page.heightMm}
          pageIndex={pageIndex}
          snapRails={guideSnapRails}
          onCreateGuide={handleCreateGuide}
          onCommitGuideCreate={handleCommitGuideCreate}
          onCancelCreate={handleCancelGuideCreate}
          onGuideMeasure={updateGuideMeasurements}
        />
      )}

      <div
        ref={panLayerRef}
        data-testid="canvas-pan-layer"
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: designW,
          height: designH,
          transform: `translate3d(calc(-50% + ${panX}px), calc(-50% + ${panY}px), 0)`,
          willChange: panning || cameraMoving ? 'transform' : undefined,
        }}
      >
        <div
          ref={frameRef}
          data-testid="canvas-artboard"
          style={{
            '--cv-camera-zoom': zoom,
            position: 'relative',
            width: designW,
            height: designH,
            transform: `scale(${zoom})`,
            transformOrigin: 'center center',
            willChange: 'transform',
            backfaceVisibility: 'hidden',
            background: '#ffffff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 12px 40px rgba(0,0,0,0.14)',
            cursor:
              canPanTool || panning
                ? cursor
                : placing || eyedropperActive
                  ? 'crosshair'
                  : 'default',
            letterSpacing: 'normal',
          } as CSSProperties}
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
              if (eyedropperActiveRef.current) {
                onEyedropperPickRef.current?.('#FFFFFF');
                return;
              }
              beginMarquee(e);
            }
          }}
          onPointerMove={onFramePointerMove}
          onPointerLeave={onFramePointerLeave}
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
                border: `${screenChromePx(1, zoom)}px dashed var(--cv-accent-2)`,
                opacity: 0.65,
                pointerEvents: 'none',
                zIndex: 29,
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
              masterLayer={
                layer.meta?.instanceOf ? masterById.get(layer.meta.instanceOf) ?? null : null
              }
              documentLayers={displayLayers}
              selected={selectedIdSet.has(layer.id)}
              moving={(gestureLayers !== null || gestureActive) && selectedIdSet.has(layer.id)}
              panning={panning || cameraMoving}
              interactive={interactive && !panning}
              editing={editingLayerId === layer.id}
              pathEditing={pathEditingLayerId === layer.id}
              editingSelectAll={editingSelectAll}
              editingRange={editingRange}
              scale={1}
              onSelect={handleSelect}
              onLayerPointerDown={handleLayerPointerDown}
              onContextMenu={(id, x, y) =>
                onContextMenu?.(id, x, y, clientPointMm(x, y))
              }
              onStartEdit={onStartEdit}
              onEditValue={onEditValue}
              onFitTextHeight={onFitTextHeight}
              onEditStyle={onEditStyle}
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
            const selected = selectedGuideId === g.id;
            return (
              <div
                key={g.id}
                data-testid="canvas-manual-guide"
                data-axis={g.axis}
                data-selected={selected ? 'true' : undefined}
                role="button"
                tabIndex={0}
                aria-label={`Guía ${g.axis === 'x' ? 'vertical' : 'horizontal'} en ${formatGapMm(g.posMm)}`}
                onPointerDown={(e) => beginGuideDrag(g, e)}
                onKeyDown={(e) => onGuideKeyDown(g, e)}
                onFocus={() => setSelectedGuideId(g.id)}
                onBlur={() => setSelectedGuideId((current) => (current === g.id ? null : current))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedGuideId(g.id);
                  onSelectIdsRef.current([]);
                  setGuideMenu({ id: g.id, x: e.clientX, y: e.clientY });
                }}
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
                          width: selected ? guideLine : guideLine / 2,
                          height: '100%',
                          marginLeft: -(selected ? guideLine : guideLine / 2) / 2,
                          background: removing ? 'var(--cv-danger)' : 'var(--cv-accent)',
                          pointerEvents: 'none',
                        }
                      : {
                          position: 'absolute',
                          top: '50%',
                          left: 0,
                          height: selected ? guideLine : guideLine / 2,
                          width: '100%',
                          marginTop: -(selected ? guideLine : guideLine / 2) / 2,
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

          {guideMenu &&
            createPortal(
              <GuideContextMenu
                menu={guideMenu}
                onRemove={(id) => {
                  setSelectedGuideId(null);
                  onRemoveGuide?.(id);
                }}
                onClose={() => setGuideMenu(null)}
              />,
              globalThis.document.body,
            )}

          {[...distanceLabels, ...hoverLabels, ...guideDistanceLabels].map((d) => (
            <div key={d.id} data-testid="canvas-distance-label" style={{ pointerEvents: 'none', zIndex: 46 }}>
              <div
                style={{
                  position: 'absolute',
                  left: mmToScreenPx(Math.min(d.x1, d.x2), 1),
                  top: mmToScreenPx(Math.min(d.y1, d.y2), 1),
                  width: Math.max(1, mmToScreenPx(Math.abs(d.x2 - d.x1), 1)),
                  height: Math.max(1, mmToScreenPx(Math.abs(d.y2 - d.y1), 1)),
                  borderTop: d.axis === 'x' ? `${screenChromePx(1, zoom)}px solid var(--cv-accent-2)` : undefined,
                  borderLeft: d.axis === 'y' ? `${screenChromePx(1, zoom)}px solid var(--cv-accent-2)` : undefined,
                  boxSizing: 'border-box',
                }}
              />
              <MeasurementBadge
                testId="canvas-distance-value"
                zoom={zoom}
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
                border: `${screenChromePx(1, zoom)}px solid var(--cv-accent)`,
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

          {smartSeq && !panning && (
            <SmartSelectionOverlay
              seq={smartSeq}
              selectionBbox={chromeBbox}
              zoom={zoom}
              onGapPointerDown={beginGapDrag}
              onTidy={tidySmartSelection}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(Artboard);
