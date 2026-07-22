import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import { clipPathForLayerType } from '../ops/shapePaths';
import {
  angleFromCenter,
  computeResizeBox,
  isPointerClick,
  layersInMarquee,
  moveSelection,
  resizeSelection,
  rotateSelection,
  selectionBounds,
  snapMoveWithGuides,
  snapResizeBox,
  snapThresholdMm,
  type HandlePos,
  type RectMm,
  type SmartGuide,
} from '../ops/selectionTransform';
import { formatGapMm, guidesForPage, measureSelectionGaps, type DistanceLabel } from '../ops/guides';
import { wheelZoomFactor, zoomAtCursor } from '../ops/viewportNav';
import {
  bendLineAt,
  cutLineAt,
  dragLineAnchor,
  dragLineHandle,
} from '../ops/pathEditGestures';
import { ensureLinePath, lineIntersectsPolygon, rectIntersectsPolygon } from '../ops/pathGeometry';
import CanvasRulers, { RULER_SIZE } from './CanvasRulers';
import LayerNode from './LayerNode';
import PathHandlesOverlay from './PathHandlesOverlay';

const HANDLE = 8;
const ROTATE_HANDLE_OFFSET = 24;

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
  onEditValue?: (id: string, value: string) => void;
  onFitTextHeight?: (id: string, contentHeightPx: number) => void;
  onCommitEdit?: () => void;
  editingSelectAll?: boolean;
  onStartPathEdit?: (id: string) => void;
  onUpsertGuide?: (guide: CanvasGuide) => void;
  onMoveGuide?: (id: string, posMm: number) => void;
  onRemoveGuide?: (id: string) => void;
}

function handleStyle(left: number, top: number, cursor: string): CSSProperties {
  return {
    position: 'absolute',
    left,
    top,
    width: HANDLE,
    height: HANDLE,
    marginLeft: -HANDLE / 2,
    marginTop: -HANDLE / 2,
    background: '#fff',
    border: '1.5px solid #18a0fb',
    borderRadius: 1,
    zIndex: 40,
    cursor,
    boxSizing: 'border-box',
  };
}

function cloneLayers(layers: CanvasLayer[]): CanvasLayer[] {
  return layers.map((l) => ({ ...l, cssVars: { ...l.cssVars }, meta: l.meta ? { ...l.meta } : undefined }));
}

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
}: ArtboardProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const drawStart = useRef<{ xMm: number; yMm: number } | null>(null);
  const [draft, setDraft] = useState<DrawRect | null>(null);
  const [marquee, setMarquee] = useState<RectMm | null>(null);
  const [lassoPts, setLassoPts] = useState<Array<{ x: number; y: number }> | null>(null);
  const [guides, setGuides] = useState<SmartGuide[]>([]);
  const [distanceLabels, setDistanceLabels] = useState<DistanceLabel[]>([]);
  const [panning, setPanning] = useState(false);
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
  const manualGuidesRef = useRef(pageGuides);
  manualGuidesRef.current = pageGuides;

  const applyGestureLayers = useCallback((layers: CanvasLayer[]) => {
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

  const editableSelected = selectedIds.filter((id) => {
    const layer = displayLayers.find((l) => l.id === id);
    return layer && layer.type !== 'frame' && !layer.locked && layer.visible !== false;
  });
  const bbox = selectionBounds(displayLayers, editableSelected);

  const handleSelect = useCallback((id: string, additive?: boolean) => {
    onSelectRef.current(id, additive);
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

      setP({ x: p.x - e.deltaX, y: p.y - e.deltaY });
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

    const onMovePtr = (ev: PointerEvent) => {
      navRef.current.onPan({
        x: origin.x + (ev.clientX - startX),
        y: origin.y + (ev.clientY - startY),
      });
    };
    const onUp = () => {
      setPanning(false);
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
  };

  const beginSelectionMove = useCallback(
    (ids: string[], startClientX: number, startClientY: number) => {
      const snapshot = cloneLayers(layersRef.current);
      gestureDirtyRef.current = false;
      let dragging = false;

      const onMovePtr = (ev: PointerEvent) => {
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
        const snapped = disableSnap
          ? { dx: rawDx, dy: rawDy, guides: [] as SmartGuide[] }
          : snapMoveWithGuides(
              snapshot,
              ids,
              rawDx,
              rawDy,
              pageSizeRef.current,
              threshold,
              manualGuidesRef.current,
            );
        setGuides(snapped.guides);
        const moved = moveSelection(snapshot, ids, snapped.dx, snapped.dy);
        applyGestureLayers(moved);
        if (ev.altKey) {
          const bounds = selectionBounds(moved, ids);
          if (bounds) {
            const exclude = new Set(ids);
            const others = snapshot
              .filter((l) => !exclude.has(l.id) && l.type !== 'frame' && l.visible !== false && !l.locked)
              .map((l) => {
                const x = parseMm(l.cssVars['--translate-x']);
                const y = parseMm(l.cssVars['--translate-y']);
                const w = parseMm(l.cssVars['--width'], 10);
                const h = parseMm(l.cssVars['--height'], 10);
                return { x, y, w, h };
              });
            setDistanceLabels(measureSelectionGaps(bounds, others, pageSizeRef.current));
          }
        } else {
          setDistanceLabels([]);
        }
      };
      const onUp = () => {
        setGuides([]);
        setDistanceLabels([]);
        endGesture();
        window.removeEventListener('pointermove', onMovePtr);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMovePtr);
      window.addEventListener('pointerup', onUp);
    },
    [applyGestureLayers, endGesture],
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

    const onMovePtr = (ev: PointerEvent) => {
      const z = zoomRef.current;
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
        );
        nextBox = snapped.box;
        setGuides(snapped.guides);
      } else {
        setGuides([]);
      }
      applyGestureLayers(
        resizeSelection(snapshot, ids, corner, 0, 0, { targetBox: nextBox }),
      );
    };
    const onUp = () => {
      setGuides([]);
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

    const onMovePtr = (ev: PointerEvent) => {
      if (!frameRef.current) return;
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
      const angle = angleFromCenter(cx, cy, cur.xMm, cur.yMm);
      const delta = angle - startAngle;
      applyGestureLayers(rotateSelection(snapshot, ids, delta, { snap15: ev.shiftKey }));
    };
    const onUp = () => {
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

    const onMovePtr = (ev: PointerEvent) => {
      if (!frameRef.current) return;
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
      const x = Math.min(origin.xMm, cur.xMm);
      const y = Math.min(origin.yMm, cur.yMm);
      setMarquee({
        x,
        y,
        w: Math.abs(cur.xMm - origin.xMm),
        h: Math.abs(cur.yMm - origin.yMm),
      });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
      if (!frameRef.current) {
        setMarquee(null);
        return;
      }
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
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
      const hit = layersInMarquee(layersRef.current, box);
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

    const onMovePtr = (ev: PointerEvent) => {
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
    };

    const onUp = () => {
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

    const onMovePtr = (ev: PointerEvent) => {
      if (!frameRef.current) return;
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
      applyAt(cur.xMm, cur.yMm);
    };

    const onUp = () => {
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

    const onMovePtr = (ev: PointerEvent) => {
      if (!frameRef.current) return;
      const fr = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, fr, zoom);
      pts.push({ x: cur.xMm, y: cur.yMm });
      setLassoPts([...pts]);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMovePtr);
      window.removeEventListener('pointerup', onUp);
      setLassoPts(null);
      if (pts.length < 3) return;
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

    const onMovePtr = (ev: PointerEvent) => {
      if (!drawStart.current || !frameRef.current) return;
      const r = frameRef.current.getBoundingClientRect();
      const cur = clientToMm(ev.clientX, ev.clientY, r, zoom);
      const constrainSquare =
        ev.shiftKey && (tool === 'rect' || tool === 'ellipse' || tool === 'polygon' || tool === 'star');
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
    };

    const onUp = (ev: PointerEvent) => {
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
          ev.shiftKey && (tool === 'rect' || tool === 'ellipse' || tool === 'polygon' || tool === 'star'),
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
      onDrawLayer(tool, result);
    };

    window.addEventListener('pointermove', onMovePtr);
    window.addEventListener('pointerup', onUp);
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

  // Integer CSS px — fractional frame size + CSS transform pan promotes a soft compositor layer.
  const frameW = Math.round(A4_WIDTH_PX * zoom);
  const frameH = Math.round(A4_HEIGHT_PX * zoom);
  const panX = Math.round(pan.x);
  const panY = Math.round(pan.y);
  const selX = bbox ? mmToScreenPx(bbox.x, zoom) : 0;
  const selY = bbox ? mmToScreenPx(bbox.y, zoom) : 0;
  const selW = bbox ? mmToScreenPx(bbox.w, zoom) : 0;
  const selH = bbox ? mmToScreenPx(bbox.h, zoom) : 0;
  const rotateHandleX = selX + selW / 2;
  const rotateHandleY = selY - ROTATE_HANDLE_OFFSET;

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
      <CanvasRulers
        zoom={zoom}
        pan={pan}
        pageWidthMm={document.page.widthMm}
        pageHeightMm={document.page.heightMm}
        pageIndex={pageIndex}
        onCreateGuide={(guide) => onUpsertGuide?.(guide)}
      />

      <div
        data-testid="canvas-pan-layer"
        style={{
          position: 'absolute',
          left: `calc(50% + ${panX}px)`,
          top: `calc(50% + ${panY}px)`,
          width: frameW,
          height: frameH,
          marginLeft: -frameW / 2,
          marginTop: -frameH / 2,
        }}
      >
        <div
          ref={frameRef}
          data-testid="canvas-artboard"
          style={{
            position: 'relative',
            width: frameW,
            height: frameH,
            background: '#ffffff',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.08), 0 12px 40px rgba(0,0,0,0.14)',
            cursor: canPanTool || panning ? cursor : placing ? 'crosshair' : 'default',
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
              color: '#8c8c8c',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            Página A4 — 210 × 297 mm · {Math.round(zoom * 100)}%
            {placing && (
              <span style={{ marginLeft: 8, color: '#18a0fb' }}>· Arrastra para dibujar</span>
            )}
            {editableSelected.length > 1 && (
              <span style={{ marginLeft: 8, color: '#18a0fb' }}>
                · {editableSelected.length} seleccionados
              </span>
            )}
          </div>

          {contentLayers.map((layer) => (
            <LayerNode
              key={layer.id}
              layer={layer}
              selected={selectedIdSet.has(layer.id)}
              interactive={interactive && !panning}
              editing={editingLayerId === layer.id}
              pathEditing={pathEditingLayerId === layer.id}
              editingSelectAll={editingSelectAll}
              scale={zoom}
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
              zoom={zoom}
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
                stroke="#18a0fb"
                strokeWidth={1}
                points={lassoPts.map((p) => `${mmToScreenPx(p.x, zoom)},${mmToScreenPx(p.y, zoom)}`).join(' ')}
              />
            </svg>
          )}

          {guides.map((g) =>
            g.axis === 'x' ? (
              <div
                key={`gx-${g.pos}`}
                data-testid="canvas-smart-guide"
                style={{
                  position: 'absolute',
                  left: mmToScreenPx(g.pos, zoom),
                  top: 0,
                  width: 1,
                  height: '100%',
                  background: '#f12dd2',
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
                  top: mmToScreenPx(g.pos, zoom),
                  left: 0,
                  height: 1,
                  width: '100%',
                  background: '#f12dd2',
                  pointerEvents: 'none',
                  zIndex: 45,
                }}
              />
            ),
          )}

          {pageGuides.map((g) => (
            <div
              key={g.id}
              data-testid="canvas-manual-guide"
              data-axis={g.axis}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.preventDefault();
                if (!frameRef.current) return;
                const onMove = (ev: PointerEvent) => {
                  if (!frameRef.current) return;
                  const r = frameRef.current.getBoundingClientRect();
                  const cur = clientToMm(ev.clientX, ev.clientY, r, zoomRef.current);
                  const max = g.axis === 'x' ? document.page.widthMm : document.page.heightMm;
                  const pos = Math.max(0, Math.min(max, g.axis === 'x' ? cur.xMm : cur.yMm));
                  // Drag back into ruler strip → delete
                  if (g.axis === 'x' && ev.clientX < (viewportRef.current?.getBoundingClientRect().left ?? 0) + RULER_SIZE + 4) {
                    onRemoveGuide?.(g.id);
                    return;
                  }
                  if (g.axis === 'y' && ev.clientY < (viewportRef.current?.getBoundingClientRect().top ?? 0) + RULER_SIZE + 4) {
                    onRemoveGuide?.(g.id);
                    return;
                  }
                  onMoveGuide?.(g.id, pos);
                };
                const onUp = () => {
                  window.removeEventListener('pointermove', onMove);
                  window.removeEventListener('pointerup', onUp);
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
              }}
              style={
                g.axis === 'x'
                  ? {
                      position: 'absolute',
                      left: mmToScreenPx(g.posMm, zoom),
                      top: 0,
                      width: 2,
                      height: '100%',
                      marginLeft: -1,
                      background: '#18a0fb',
                      cursor: 'ew-resize',
                      zIndex: 44,
                    }
                  : {
                      position: 'absolute',
                      top: mmToScreenPx(g.posMm, zoom),
                      left: 0,
                      height: 2,
                      width: '100%',
                      marginTop: -1,
                      background: '#18a0fb',
                      cursor: 'ns-resize',
                      zIndex: 44,
                    }
              }
            />
          ))}

          {distanceLabels.map((d) => (
            <div key={d.id} data-testid="canvas-distance-label" style={{ pointerEvents: 'none', zIndex: 46 }}>
              <div
                style={{
                  position: 'absolute',
                  left: mmToScreenPx(Math.min(d.x1, d.x2), zoom),
                  top: mmToScreenPx(Math.min(d.y1, d.y2), zoom),
                  width: Math.max(1, mmToScreenPx(Math.abs(d.x2 - d.x1), zoom)),
                  height: Math.max(1, mmToScreenPx(Math.abs(d.y2 - d.y1), zoom)),
                  borderTop: d.axis === 'x' ? '1px solid #f12dd2' : undefined,
                  borderLeft: d.axis === 'y' ? '1px solid #f12dd2' : undefined,
                  boxSizing: 'border-box',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: mmToScreenPx(d.x, zoom),
                  top: mmToScreenPx(d.y, zoom),
                  transform: 'translate(-50%, -50%)',
                  background: '#f12dd2',
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
                left: mmToScreenPx(marquee.x, zoom),
                top: mmToScreenPx(marquee.y, zoom),
                width: Math.max(mmToScreenPx(marquee.w, zoom), 1),
                height: Math.max(mmToScreenPx(marquee.h, zoom), 1),
                border: '1px solid #18a0fb',
                background: 'rgba(24,160,251,0.08)',
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
                x1={mmToScreenPx(draft.x0, zoom)}
                y1={mmToScreenPx(draft.y0, zoom)}
                x2={mmToScreenPx(draft.x1, zoom)}
                y2={mmToScreenPx(draft.y1, zoom)}
                stroke="#18a0fb"
                strokeWidth={1.5}
              />
            </svg>
          )}

          {draft && draft.w + draft.h > 0 && tool !== 'line' && (
            <div
              data-testid="canvas-draw-draft"
              style={{
                position: 'absolute',
                left: mmToScreenPx(draft.x, zoom),
                top: mmToScreenPx(draft.y, zoom),
                width: Math.max(mmToScreenPx(draft.w, zoom), 1),
                height: Math.max(mmToScreenPx(draft.h, zoom), 1),
                border: '1.5px solid #18a0fb',
                background: 'rgba(24,160,251,0.08)',
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
                  outline: '1.5px solid #18a0fb',
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
                  width: 1,
                  height: ROTATE_HANDLE_OFFSET,
                  marginLeft: -0.5,
                  background: '#18a0fb',
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
                  width: HANDLE,
                  height: HANDLE,
                  marginLeft: -HANDLE / 2,
                  marginTop: -HANDLE / 2,
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
                    background: '#18a0fb',
                    border: '1.5px solid #fff',
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
                  style={handleStyle(left, top, cursorName)}
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
