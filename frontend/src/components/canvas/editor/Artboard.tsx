import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import type { CanvasDocument, CanvasGuide, CanvasLayer, CanvasTool } from '../types';
import { A4_HEIGHT_PX, A4_WIDTH_PX, parseMm } from '../types';
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
  type HandlePos,
  type RectMm,
  type SmartGuide,
  DEFAULT_GRID_MM,
} from '../ops/selectionTransform';
import { buildSpatialIndex } from '../ops/spatialIndex';
import {
  clampGuidePos,
  formatGapMm,
  guidesForPage,
  isGuideRemovalPoint,
  measureSelectionGaps,
  type DistanceLabel,
} from '../ops/guides';
import { wheelPanDelta, wheelZoomFactor, zoomAtCursor } from '../ops/viewportNav';
import { filterVisibleLayers, visiblePageRectMm } from '../ops/viewportCulling';
import { createGestureRaf } from '../ops/gestureRaf';
import { usePinchZoom } from '../hooks/usePinchZoom';
import {
  bendLineAt,
  cutLineAt,
  dragLineAnchor,
  dragLineHandle,
} from '../ops/pathEditGestures';
import { ensureLinePath, lineIntersectsPolygon, rectIntersectsPolygon } from '../ops/pathGeometry';
import CanvasRulers, { GuidePositionChip, RULER_SIZE } from './CanvasRulers';
import LayerNode from './LayerNode';
import PathHandlesOverlay from './PathHandlesOverlay';
import { screenChromePx } from '../ops/textTypography';

const HANDLE = 8;
/** Invisible grab zone around a guide line (Figma uses a generous hit area). */
const GUIDE_HIT_PX = 10;
const ROTATE_HANDLE_OFFSET = 24;
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
}

function handleStyle(left: number, top: number, cursor: string, cameraZoom: number): CSSProperties {
  const size = screenChromePx(HANDLE, cameraZoom);
  return {
    position: 'absolute',
    left,
    top,
    width: size,
    height: size,
    marginLeft: -size / 2,
    marginTop: -size / 2,
    background: '#fff',
    border: `${screenChromePx(1.5, cameraZoom)}px solid var(--cv-accent)`,
    borderRadius: 1,
    zIndex: 40,
    cursor,
    boxSizing: 'border-box',
  };
}

function cloneLayers(layers: CanvasLayer[]): CanvasLayer[] {
  return layers.map((l) => ({ ...l, cssVars: { ...l.cssVars }, meta: l.meta ? { ...l.meta } : undefined }));
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
  return (
    <>
      {guides.map((g) =>
        g.axis === 'x' ? (
          <div
            key={`gx-${g.pos}`}
            data-testid="canvas-smart-guide"
            style={{
              position: 'absolute',
              left: mmToScreenPx(g.pos, 1),
              top: 0,
              width: screenChromePx(1, zoom),
              height: '100%',
              background: 'var(--cv-accent-2)',
              pointerEvents: 'none',
              zIndex: 45,
            }}
          />
        ) : (
          <div
            key={`gy-${g.pos}`}
            data-testid="canvas-smart-guide"
            style={{
              position: 'absolute',
              top: mmToScreenPx(g.pos, 1),
              left: 0,
              height: screenChromePx(1, zoom),
              width: '100%',
              background: 'var(--cv-accent-2)',
              pointerEvents: 'none',
              zIndex: 45,
            }}
          />
        ),
      )}
    </>
  );
});

export default function Artboard({
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
  /** True while a two-finger pinch is (or was, until all fingers lift) active. */
  const pinchGestureRef = useRef(false);
  /** Viewport size in CSS px — drives layer culling (virtualized rendering). */
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number } | null>(null);
  /** Live gesture preview stays in Artboard so CanvasView/sidebars skip per-frame updates. */
  const [gestureLayers, setGestureLayers] = useState<CanvasLayer[] | null>(null);
  const didFit = useRef(false);
  const gestureDirtyRef = useRef(false);
  const gestureLayersRef = useRef<CanvasLayer[] | null>(null);
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
    gestureDirtyRef.current = true;
    gestureLayersRef.current = layers;
    layersRef.current = layers;
    setGestureLayers(layers);
  }, []);

  const endGesture = useCallback(() => {
    if (!gestureDirtyRef.current) return;
    const finalLayers = gestureLayersRef.current;
    gestureDirtyRef.current = false;
    gestureLayersRef.current = null;
    setGestureLayers(null);
    if (!finalLayers) return;
    if (onPreviewLayersRef.current) {
      onPreviewLayersRef.current(finalLayers);
      onCommitGestureRef.current?.();
    } else {
      onChangeLayersRef.current(finalLayers);
    }
  }, []);

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
  layersRef.current = displayLayers;

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
  const viewRectMm = useMemo(
    () =>
      viewportSize
        ? visiblePageRectMm(viewportSize.w, viewportSize.h, pan, zoom, A4_WIDTH_PX, A4_HEIGHT_PX)
        : null,
    [viewportSize, pan, zoom],
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

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const { zoom: z, pan: p, onZoom: setZ, onPan: setP } = navRef.current;
      const rect = el.getBoundingClientRect();
      const cursor = {
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2,
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
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
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
    (ids: string[], startClientX: number, startClientY: number) => {
      const snapshot = cloneLayers(layersRef.current);
      gestureDirtyRef.current = false;
      let dragging = false;
      const originBounds = selectionBounds(snapshot, ids);
      const rails = prepareSnapRails(snapshot, ids, pageSizeRef.current, manualGuidesRef.current);
      const exclude = new Set(ids);
      const othersRects = snapshot
        .filter((l) => !exclude.has(l.id) && l.type !== 'frame' && l.visible !== false && !l.locked)
        .map((l) => {
          const x = parseMm(l.cssVars['--translate-x']);
          const y = parseMm(l.cssVars['--translate-y']);
          const w = parseMm(l.cssVars['--width'], 10);
          const h = parseMm(l.cssVars['--height'], 10);
          return { x, y, w, h };
        });

      // Coalesce to one apply per animation frame; latest pointer position wins.
      const raf = createGestureRaf((ev: PointerEvent) => {
        if (pinchGestureRef.current) return;
        const dxPx = ev.clientX - startClientX;
        const dyPx = ev.clientY - startClientY;
        if (!dragging) {
          if (isPointerClick(dxPx, dyPx)) return;
          dragging = true;
        }
        const z = zoomRef.current;
        const rawDx = dxPx / (z * MM_TO_PX);
        const rawDy = dyPx / (z * MM_TO_PX);
        const disableSnap = ev.ctrlKey || ev.metaKey;
        const threshold = snapThresholdMm(z);
        let dx = rawDx;
        let dy = rawDy;
        let nextGuides: SmartGuide[] = [];
        if (!disableSnap) {
          const snapped = snapMoveWithGuides(
            snapshot,
            ids,
            rawDx,
            rawDy,
            pageSizeRef.current,
            threshold,
            manualGuidesRef.current,
            rails,
          );
          dx = snapped.dx;
          dy = snapped.dy;
          nextGuides = snapped.guides;
          if (snapToGridRef.current && originBounds) {
            const grid = gridSizeMmRef.current;
            const nx = snapToGridMm(originBounds.x + dx, grid);
            const ny = snapToGridMm(originBounds.y + dy, grid);
            dx = nx - originBounds.x;
            dy = ny - originBounds.y;
          }
        }
        setGuidesIfChanged(nextGuides);
        const moved = moveSelection(snapshot, ids, dx, dy);
        applyGestureLayers(moved);
        if (ev.altKey) {
          const bounds = selectionBounds(moved, ids);
          if (bounds) {
            setDistanceLabelsIfChanged(
              measureSelectionGaps(bounds, othersRects, pageSizeRef.current),
            );
          }
        } else {
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
      };
      window.addEventListener('pointermove', onMovePtr);
      window.addEventListener('pointerup', onUp);
    },
    [applyGestureLayers, endGesture, setGuidesIfChanged, setDistanceLabelsIfChanged],
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
      let ids: string[];
      if (additive) {
        ids = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
        onSelectIdsRef.current(ids);
        return;
      }
      if (current.includes(id) && current.length > 1) {
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
      beginSelectionMove(moveIds, e.clientX, e.clientY);
    },
    [beginSelectionMove],
  );

  const startResize = (e: ReactPointerEvent<HTMLDivElement>, corner: HandlePos) => {
    e.stopPropagation();
    e.preventDefault();
    if (!editableSelected.length) return;
    const snapshot = cloneLayers(layersRef.current);
    const startX = e.clientX;
    const startY = e.clientY;
    const ids = [...editableSelected];
    const origin = selectionBounds(snapshot, ids);
    if (!origin) return;
    gestureDirtyRef.current = false;
    const rails = prepareSnapRails(snapshot, ids, pageSizeRef.current, manualGuidesRef.current);

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
      applyGestureLayers(
        resizeSelection(snapshot, ids, corner, 0, 0, { targetBox: nextBox }),
      );
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
    const snapshot = cloneLayers(layersRef.current);
    const ids = [...editableSelected];
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const rect = frameRef.current.getBoundingClientRect();
    const start = clientToMm(e.clientX, e.clientY, rect, zoom);
    const startAngle = angleFromCenter(cx, cy, start.xMm, start.yMm);
    gestureDirtyRef.current = false;

    const raf = createGestureRaf((ev: PointerEvent) => {
      if (!frameRef.current) return;
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
      const angle = angleFromCenter(cx, cy, cur.xMm, cur.yMm);
      const delta = angle - startAngle;
      applyGestureLayers(rotateSelection(snapshot, ids, delta, { snap15: ev.shiftKey }));
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

  const beginMarquee = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!frameRef.current) return;
    if (editingLayerId) {
      onCommitEdit?.();
    }
    e.stopPropagation();
    e.preventDefault();
    const rect = frameRef.current.getBoundingClientRect();
    const { xMm, yMm } = clientToMm(e.clientX, e.clientY, rect, zoom);
    const origin = { xMm, yMm };
    setMarquee({ x: xMm, y: yMm, w: 0, h: 0 });
    if (!e.shiftKey) onSelectIds([]);

    const raf = createGestureRaf((ev: PointerEvent) => {
      if (!frameRef.current) return;
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
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
      if (!frameRef.current) {
        setMarquee(null);
        return;
      }
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
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
      if (box.w < 1 && box.h < 1) {
        if (!ev.shiftKey) onSelect(null);
        return;
      }
      // Use spatial index for fast marquee hit-testing with many layers
      const currentLayers = layersRef.current;
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

    const raf = createGestureRaf((ev: PointerEvent) => {
      if (!frameRef.current) return;
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
      const current = layersRef.current.find((l) => l.id === layerId);
      if (!current) return;
      const next =
        kind === 'anchor'
          ? dragLineAnchor(current, pointIndex, cur.xMm, cur.yMm)
          : dragLineHandle(current, pointIndex, kind, cur.xMm, cur.yMm, !ev.altKey);
      applyGestureLayers(layersRef.current.map((l) => (l.id === layerId ? next : l)));
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
    const r0 = frameRef.current.getBoundingClientRect();
    const start = clientToMm(e.clientX, e.clientY, r0, zoom);
    const applyAt = (xMm: number, yMm: number) => {
      const current = layersRef.current.find((l) => l.id === targetId);
      if (!current || current.type !== 'line') return;
      const next = bendLineAt(current, xMm, yMm);
      applyGestureLayers(layersRef.current.map((l) => (l.id === targetId ? next : l)));
    };
    applyAt(start.xMm, start.yMm);

    const raf = createGestureRaf((ev: PointerEvent) => {
      if (!frameRef.current) return;
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
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
    const r = frameRef.current.getBoundingClientRect();
    const cur = clientToMm(e.clientX, e.clientY, r, zoom);
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
    const r = frameRef.current.getBoundingClientRect();
    const start = clientToMm(e.clientX, e.clientY, r, zoom);
    const pts: Array<{ x: number; y: number }> = [{ x: start.xMm, y: start.yMm }];
    setLassoPts(pts);

    const raf = createGestureRaf((ev: PointerEvent) => {
      if (!frameRef.current) return;
      if (pinchGestureRef.current) return;
      const fr = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, fr, zoom);
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
    const rect = frameRef.current.getBoundingClientRect();
    const { xMm, yMm } = clientToMm(e.clientX, e.clientY, rect, zoom);
    drawStart.current = { xMm, yMm };
    setDraft({ x: xMm, y: yMm, w: 0, h: 0 });

    const raf = createGestureRaf((ev: PointerEvent) => {
      if (!drawStart.current || !frameRef.current) return;
      if (pinchGestureRef.current) return;
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
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
      if (!drawStart.current || !frameRef.current) {
        setDraft(null);
        return;
      }
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
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
    setGuideDrag({ id: g.id, posMm: g.posMm, clientX: e.clientX, clientY: e.clientY, willRemove: false });

    const raf = createGestureRaf((ev: PointerEvent) => {
      if (!frameRef.current || cancelled) return;
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoomRef.current);
      const max = g.axis === 'x' ? pageSizeRef.current.widthMm : pageSizeRef.current.heightMm;
      lastPos = clampGuidePos(g.axis === 'x' ? cur.xMm : cur.yMm, max);
      const vr = viewportRef.current?.getBoundingClientRect();
      willRemove = vr ? isGuideRemovalPoint(g.axis, ev.clientX, ev.clientY, vr, RULER_SIZE) : false;
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
  const selX = bbox ? mmToScreenPx(bbox.x, 1) : 0;
  const selY = bbox ? mmToScreenPx(bbox.y, 1) : 0;
  const selW = bbox ? mmToScreenPx(bbox.w, 1) : 0;
  const selH = bbox ? mmToScreenPx(bbox.h, 1) : 0;
  const rotateHandleX = selX + selW / 2;
  const rotateOffset = screenChromePx(ROTATE_HANDLE_OFFSET, zoom);
  const rotateHandleY = selY - rotateOffset;
  const guideHit = screenChromePx(GUIDE_HIT_PX, zoom);
  const guideLine = screenChromePx(GUIDE_LINE_PX, zoom);
  const handleSize = screenChromePx(HANDLE, zoom);

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
          left: `calc(50% + ${panX}px)`,
          top: `calc(50% + ${panY}px)`,
          width: visualW,
          height: visualH,
          marginLeft: -visualW / 2,
          marginTop: -visualH / 2,
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
              moving={gestureLayers !== null && selectedIdSet.has(layer.id)}
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
              <div
                style={{
                  position: 'absolute',
                  left: mmToScreenPx(d.x, 1),
                  top: mmToScreenPx(d.y, 1),
                  transform: 'translate(-50%, -50%)',
                  background: 'var(--cv-accent-2)',
                  color: '#fff',
                  fontSize: 10,
                  padding: '1px 4px',
                  borderRadius: 2,
                  whiteSpace: 'nowrap',
                }}
              >
                {formatGapMm(d.valueMm)}
              </div>
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

          {bbox && interactive && !panning && !editingLayerId && (
            <>
              <div
                style={{
                  position: 'absolute',
                  left: selX,
                  top: selY,
                  width: selW,
                  height: selH,
                  outline: '1.5px solid var(--cv-accent)',
                  pointerEvents: 'none',
                  zIndex: 30,
                  boxSizing: 'border-box',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: rotateHandleX,
                  top: selY,
                  width: screenChromePx(1, zoom),
                  height: rotateOffset,
                  marginLeft: -screenChromePx(0.5, zoom),
                  background: 'var(--cv-accent)',
                  pointerEvents: 'none',
                  zIndex: 39,
                }}
              />
              <WithHoverTooltip
                label="Rotar"
                shortcut="Shift · 15°"
                placement="top"
                variant="dark"
                className="!absolute"
                style={{
                  left: rotateHandleX,
                  top: rotateHandleY,
                  width: handleSize,
                  height: handleSize,
                  marginLeft: -handleSize / 2,
                  marginTop: -handleSize / 2,
                  zIndex: 40,
                }}
              >
                <div
                  data-testid="canvas-rotate-handle"
                  aria-label="Rotar"
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: '50%',
                    background: 'var(--cv-accent)',
                    border: `${screenChromePx(1.5, zoom)}px solid #fff`,
                    cursor: 'grab',
                    boxSizing: 'border-box',
                  }}
                  onPointerDown={startRotate}
                />
              </WithHoverTooltip>
              {(
                [
                  ['nw', selX, selY, 'nwse-resize'],
                  ['n', selX + selW / 2, selY, 'ns-resize'],
                  ['ne', selX + selW, selY, 'nesw-resize'],
                  ['e', selX + selW, selY + selH / 2, 'ew-resize'],
                  ['se', selX + selW, selY + selH, 'nwse-resize'],
                  ['s', selX + selW / 2, selY + selH, 'ns-resize'],
                  ['sw', selX, selY + selH, 'nesw-resize'],
                  ['w', selX, selY + selH / 2, 'ew-resize'],
                ] as const
              ).map(([pos, left, top, cursorName]) => (
                <div
                  key={pos}
                  style={handleStyle(left, top, cursorName, zoom)}
                  onPointerDown={(ev) => startResize(ev, pos)}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
