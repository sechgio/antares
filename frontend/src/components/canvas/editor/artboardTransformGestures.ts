import type { MutableRefObject, RefObject } from 'react';
import type { CanvasGuide, CanvasLayer } from '../types';
import { clientToMm, MM_TO_PX } from '../ops/drawHelpers';
import {
  angleFromCenter,
  computeResizeBox,
  prepareSnapRails,
  resizeSelection,
  rotateSelection,
  selectionBounds,
  snapResizeBox,
  snapThresholdMm,
  snapUnalignedAxesToGrid,
  type HandlePos,
  type RectMm,
  type SmartGuide,
} from '../ops/selectionTransform';
import { expandWithDescendants } from '../ops/layerTree';
import { replaceLayerById } from '../ops/patchLayers';
import { dragLineAnchor, dragLineHandle } from '../ops/pathEditGestures';
import { resizeSmartGap, tidySmartSequence, type SmartSequence } from '../ops/smartSelection';
import { createGestureRaf } from '../ops/gestureRaf';
import type {
  PointerGestureOwner,
  PointerGestureSession,
} from '../ops/pointerGestureSession';
import {
  computeRadiusFromDrag,
  layerSupportsCornerRadius,
  layersWithCornerRadius,
  maxCornerRadiusPxForLayer,
} from '../ops/cornerRadiusGesture';
import { cornerRadiusPx, type CornerId } from '../ops/layerStyle';
import { createFrameRectCache } from './frameRectCache';
import { escapeToAbort } from './artboardViewportGestures';

export function cloneLayers(layers: CanvasLayer[], deepIds?: ReadonlySet<string>): CanvasLayer[] {
  if (!deepIds || deepIds.size === 0) {
    return layers.map((l) => ({ ...l, cssVars: { ...l.cssVars }, meta: l.meta ? { ...l.meta } : undefined }));
  }
  return layers.map((l) =>
    deepIds.has(l.id)
      ? { ...l, cssVars: { ...l.cssVars }, meta: l.meta ? { ...l.meta } : undefined }
      : l,
  );
}

interface PointerDownEvent {
  stopPropagation: () => void;
  preventDefault: () => void;
  clientX: number;
  clientY: number;
}

interface ArtboardTransformGestureDeps {
  frameRef: RefObject<HTMLDivElement | null>;
  zoomRef: MutableRefObject<number>;
  layersRef: MutableRefObject<CanvasLayer[]>;
  pinchGestureRef: MutableRefObject<boolean>;
  gestureDirtyRef: MutableRefObject<boolean>;
  pageSizeRef: MutableRefObject<{ widthMm: number; heightMm: number }>;
  manualGuidesRef: MutableRefObject<CanvasGuide[]>;
  pageMarginRef: MutableRefObject<number>;
  snapToGridRef: MutableRefObject<boolean>;
  gridSizeMmRef: MutableRefObject<number>;
  pointerGestures: PointerGestureOwner;
  editableSelected: string[];
  bbox: RectMm | null;
  onCancelInertia?: () => void;
  applyImperativePreview: (moved: CanvasLayer[], nextIds: string[]) => void;
  applyGestureLayers: (layers: CanvasLayer[]) => void;
  endGesture: () => void;
  abortGesturePreview: (restore?: { layers: CanvasLayer[]; ids: string[] }) => void;
  setGuidesIfChanged: (next: SmartGuide[]) => void;
  setGestureBbox: (box: RectMm | null) => void;
  setRadiusDrag: (drag: { label: string; corner: CornerId } | null) => void;
}

export function createArtboardTransformGestures(deps: ArtboardTransformGestureDeps) {
  const {
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
  } = deps;

  const startResize = (e: PointerDownEvent, corner: HandlePos) => {
    e.stopPropagation();
    e.preventDefault();
    onCancelInertia?.();
    if (!editableSelected.length) return;
    const originLayers = layersRef.current;
    const snapshot = cloneLayers(
      originLayers,
      new Set(expandWithDescendants(originLayers, editableSelected)),
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
          nextBox = snapUnalignedAxesToGrid(nextBox, gridSizeMmRef.current, 'bounds', snapped.guides);
        }
      } else {
        setGuidesIfChanged([]);
      }
      const resized = resizeSelection(snapshot, ids, corner, 0, 0, { targetBox: nextBox });
      applyImperativePreview(resized, ids);
      setGestureBbox(selectionBounds(resized, ids));
    });
    let session: PointerGestureSession;
    session = pointerGestures.start({
      onMove: (ev) => raf.schedule(ev),
      onEnd: () => {
        raf.flush();
        setGuidesIfChanged([]);
        endGesture();
      },
      onKeyDown: escapeToAbort(() => session),
      onAbort: () => {
        raf.cancel();
        abortGesturePreview({ layers: originLayers, ids });
      },
    });
  };

  const startRotate = (e: PointerDownEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!bbox || !editableSelected.length || !frameRef.current) return;
    const originLayers = layersRef.current;
    const snapshot = cloneLayers(
      originLayers,
      new Set(expandWithDescendants(originLayers, editableSelected)),
    );
    const ids = [...editableSelected];
    const cx = bbox.x + bbox.w / 2;
    const cy = bbox.y + bbox.h / 2;
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const start = clientToMm(e.clientX, e.clientY, frameRect.read(), zoomRef.current);
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
    let session: PointerGestureSession;
    session = pointerGestures.start({
      onMove: (ev) => raf.schedule(ev),
      onEnd: () => {
        raf.flush();
        endGesture();
      },
      onKeyDown: escapeToAbort(() => session),
      onAbort: () => {
        raf.cancel();
        abortGesturePreview({ layers: originLayers, ids });
      },
    });
  };

  const startRadiusResize = (e: PointerDownEvent, corner: CornerId) => {
    e.stopPropagation();
    e.preventDefault();
    if (editableSelected.length !== 1) return;
    const id = editableSelected[0]!;
    const originLayers = layersRef.current;
    const snapshot = cloneLayers(originLayers, new Set([id]));
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
    let session: PointerGestureSession;
    session = pointerGestures.start({
      onMove: (ev) => raf.schedule(ev),
      onEnd: () => {
        raf.flush();
        setRadiusDrag(null);
        endGesture();
      },
      onKeyDown: escapeToAbort(() => session),
      onAbort: () => {
        raf.cancel();
        setRadiusDrag(null);
        abortGesturePreview({ layers: originLayers, ids: [id] });
      },
    });
  };

  return { startResize, startRotate, startRadiusResize };
}

interface PathGapGestureDeps {
  frameRef: RefObject<HTMLDivElement | null>;
  zoomRef: MutableRefObject<number>;
  layersRef: MutableRefObject<CanvasLayer[]>;
  gestureDirtyRef: MutableRefObject<boolean>;
  pointerGestures: PointerGestureOwner;
  pathEditLayer: CanvasLayer | null | undefined;
  onCancelInertia?: () => void;
  applyGestureLayers: (layers: CanvasLayer[]) => void;
  endGesture: () => void;
  abortGesturePreview: (restore?: { layers: CanvasLayer[]; ids: string[] }) => void;
}

export function createArtboardPathGapGestures(deps: PathGapGestureDeps) {
  const {
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
  } = deps;

  const beginGapDrag = (
    seq: SmartSequence,
    index: number,
    e: PointerDownEvent & { button: number },
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onCancelInertia?.();
    if (!frameRef.current) return;
    const snapshot = cloneLayers(
      layersRef.current,
      new Set(expandWithDescendants(layersRef.current, seq.ids)),
    );
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const originGap = seq.gaps[index] ?? 0;
    const start = clientToMm(e.clientX, e.clientY, frameRect.read(), zoomRef.current);
    gestureDirtyRef.current = false;
    const raf = createGestureRaf((ev: PointerEvent) => {
      const cur = clientToMm(ev.clientX, ev.clientY, frameRect.read(), zoomRef.current);
      const delta = seq.axis === 'x' ? cur.xMm - start.xMm : cur.yMm - start.yMm;
      applyGestureLayers(resizeSmartGap(snapshot, seq, index, originGap + delta));
    });
    let session: PointerGestureSession;
    session = pointerGestures.start({
      onMove: (ev) => raf.schedule(ev),
      onEnd: (ev) => {
        if (!ev) {
          raf.cancel();
          abortGesturePreview();
          return;
        }
        raf.flush();
        endGesture();
      },
      onKeyDown: escapeToAbort(() => session),
      onAbort: () => {
        raf.cancel();
        abortGesturePreview();
      },
    });
  };

  const tidySmartSelection = (
    seq: SmartSequence,
    e: PointerDownEvent & { button: number },
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onCancelInertia?.();
    applyGestureLayers(tidySmartSequence(layersRef.current, seq));
    endGesture();
  };

  const beginPathPointDrag = (
    pointIndex: number,
    kind: 'anchor' | 'hin' | 'hout',
    e: PointerDownEvent,
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

  return { beginGapDrag, tidySmartSelection, beginPathPointDrag };
}
