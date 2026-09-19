import type { MutableRefObject, RefObject } from 'react';
import type { CanvasLayer, CanvasTool } from '../types';
import { parseMm } from '../types';
import { clientToMm, isClickPlace, normalizeDrawRect, type DrawRect } from '../ops/drawHelpers';
import { isSquareConstrainTool } from '../ops/shapePaths';
import { replaceLayerById } from '../ops/patchLayers';
import { createGestureRaf } from '../ops/gestureRaf';
import type { PointerGestureOwner } from '../ops/pointerGestureSession';
import { bendLineAt, cutLineAt } from '../ops/pathEditGestures';
import { lineIntersectsPolygon, rectIntersectsPolygon } from '../ops/pathGeometry';
import { createFrameRectCache } from './frameRectCache';

interface ArtboardToolGestureDeps {
  frameRef: RefObject<HTMLDivElement | null>;
  zoomRef: MutableRefObject<number>;
  layersRef: MutableRefObject<CanvasLayer[]>;
  pinchGestureRef: MutableRefObject<boolean>;
  drawStart: MutableRefObject<{ xMm: number; yMm: number } | null>;
  selectedIdsRef: MutableRefObject<string[]>;
  pointerGestures: PointerGestureOwner;
  selectedIds: string[];
  displayLayers: CanvasLayer[];
  pathEditingLayerId?: string | null;
  placing: boolean;
  tool: CanvasTool;
  onDrawLayer?: (tool: CanvasTool, rect: DrawRect) => void;
  onStartPathEdit?: (id: string) => void;
  onChangeLayers: (layers: CanvasLayer[]) => void;
  onSelectIds: (ids: string[]) => void;
  applyGestureLayers: (layers: CanvasLayer[]) => void;
  endGesture: () => void;
  abortGesturePreview: (restore?: { layers: CanvasLayer[]; ids: string[] }) => void;
  setDraft: (draft: DrawRect | null) => void;
  setLassoPts: (pts: Array<{ x: number; y: number }> | null) => void;
}

export function createArtboardToolGestures(deps: ArtboardToolGestureDeps) {
  const {
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
  } = deps;

  const beginBend = (e: { stopPropagation: () => void; preventDefault: () => void; clientX: number; clientY: number }) => {
    if (!frameRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const targetId =
      pathEditingLayerId ||
      selectedIds.find((id) => displayLayers.find((l) => l.id === id)?.type === 'line');
    if (!targetId) return;
    if (pathEditingLayerId !== targetId) onStartPathEdit?.(targetId);
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const start = clientToMm(e.clientX, e.clientY, frameRect.read(), zoomRef.current);
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
    pointerGestures.start({
      onMove: (ev) => raf.schedule(ev),
      onEnd: () => {
        raf.flush();
        endGesture();
      },
      onAbort: () => {
        raf.cancel();
        abortGesturePreview();
      },
    });
  };

  const beginCut = (e: { stopPropagation: () => void; preventDefault: () => void; clientX: number; clientY: number }) => {
    if (!frameRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const targetId =
      pathEditingLayerId ||
      selectedIds.find((id) => displayLayers.find((l) => l.id === id)?.type === 'line');
    if (!targetId) return;
    if (pathEditingLayerId !== targetId) onStartPathEdit?.(targetId);
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const cur = clientToMm(e.clientX, e.clientY, frameRect.read(), zoomRef.current);
    const current = layersRef.current.find((l) => l.id === targetId);
    if (!current || current.type !== 'line') return;
    const split = cutLineAt(current, cur.xMm, cur.yMm);
    if (!split) return;
    const [left, right] = split;
    const next = layersRef.current.flatMap((l) => (l.id === targetId ? [left, right] : [l]));
    onChangeLayers(next);
    onSelectIds([left.id, right.id]);
  };

  const beginLasso = (e: { stopPropagation: () => void; preventDefault: () => void; clientX: number; clientY: number; shiftKey: boolean }) => {
    if (!frameRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const start = clientToMm(e.clientX, e.clientY, frameRect.read(), zoomRef.current);
    const pts: Array<{ x: number; y: number }> = [{ x: start.xMm, y: start.yMm }];
    setLassoPts(pts);

    const raf = createGestureRaf((ev: PointerEvent) => {
      if (pinchGestureRef.current) return;
      const cur = clientToMm(ev.clientX, ev.clientY, frameRect.read(), zoomRef.current);
      pts.push({ x: cur.xMm, y: cur.yMm });
      setLassoPts([...pts]);
    });
    pointerGestures.start({
      onMove: (ev) => raf.schedule(ev),
      onEnd: () => {
        raf.flush();
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
      },
      onAbort: () => {
        raf.cancel();
        setLassoPts(null);
      },
    });
  };

  const beginDraw = (e: { stopPropagation: () => void; preventDefault: () => void; clientX: number; clientY: number }) => {
    if (!placing || !onDrawLayer || !frameRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const { xMm, yMm } = clientToMm(e.clientX, e.clientY, frameRect.read(), zoomRef.current);
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
    pointerGestures.start({
      onMove: (ev) => raf.schedule(ev),
      onEnd: (ev) => {
        raf.cancel();
        if (!drawStart.current || !ev) {
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
      },
      onAbort: () => {
        raf.cancel();
        drawStart.current = null;
        setDraft(null);
      },
    });
  };

  return { beginBend, beginCut, beginLasso, beginDraw };
}
