import type { MutableRefObject, RefObject } from 'react';
import type { CanvasGuide, CanvasLayer } from '../types';
import { MM_TO_PX } from '../ops/drawHelpers';
import {
  constrainMoveToAxis,
  isPointerClick,
  moveSelection,
  prepareSnapRails,
  selectionBounds,
  snapMoveWithGuides,
  snapThresholdMm,
  snapUnalignedAxesToGrid,
  type RectMm,
  type SmartGuide,
} from '../ops/selectionTransform';
import {
  collectReferenceGaps,
  measureSelectionGaps,
  snapEqualGaps,
  type DistanceLabel,
} from '../ops/guides';
import { duplicateLayers } from '../ops/layerOps';
import { layerBounds } from '../ops/layerBounds';
import { expandWithDescendants } from '../ops/layerTree';
import { isTextualLayerType } from '../layerKinds';
import { createGestureRaf } from '../ops/gestureRaf';
import { applyLayerDomTransforms, setCanvasGestureActive } from '../ops/imperativeLayerDom';
import type {
  PointerGestureOwner,
  PointerGestureSession,
} from '../ops/pointerGestureSession';
import { escapeToAbort } from './artboardViewportGestures';
import { cloneLayers } from './artboardTransformGestures';

interface SelectionMoveDeps {
  frameRef: RefObject<HTMLDivElement | null>;
  zoomRef: MutableRefObject<number>;
  layersRef: MutableRefObject<CanvasLayer[]>;
  pinchGestureRef: MutableRefObject<boolean>;
  gestureDirtyRef: MutableRefObject<boolean>;
  gestureLayersRef: MutableRefObject<CanvasLayer[] | null>;
  imperativeMoveIdsRef: MutableRefObject<string[] | null>;
  pageSizeRef: MutableRefObject<{ widthMm: number; heightMm: number }>;
  manualGuidesRef: MutableRefObject<CanvasGuide[]>;
  pageMarginRef: MutableRefObject<number>;
  snapToGridRef: MutableRefObject<boolean>;
  gridSizeMmRef: MutableRefObject<number>;
  selectedIdsRef: MutableRefObject<string[]>;
  onSelectIdsRef: MutableRefObject<(ids: string[]) => void>;
  onPreviewLayersRef: MutableRefObject<((layers: CanvasLayer[]) => void) | undefined>;
  pointerGestures: PointerGestureOwner;
  applyGestureLayers: (layers: CanvasLayer[]) => void;
  endGesture: () => void;
  abortGesturePreview: (restore?: { layers: CanvasLayer[]; ids: string[] }) => void;
  setGuidesIfChanged: (next: SmartGuide[]) => void;
  setDistanceLabelsIfChanged: (next: DistanceLabel[]) => void;
  setGestureActive: (active: boolean) => void;
  setGestureBbox: (box: RectMm | null) => void;
}

export function createSelectionMoveStarter(deps: SelectionMoveDeps) {
  const {
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
  } = deps;

  return (
    ids: string[],
    startClientX: number,
    startClientY: number,
    options?: {
      onClickWithoutDrag?: () => void;
      duplicate?: boolean;
      originSelectedIds?: string[];
    },
  ) => {
    const originLayers = layersRef.current;
    const originSelectedIds = options?.originSelectedIds ?? [...selectedIdsRef.current];
    let snapshot = cloneLayers(
      originLayers,
      new Set(expandWithDescendants(originLayers, ids)),
    );
    let moveIds = ids;
    let didDuplicate = false;
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
      if (pinchGestureRef.current) return;
      if (!gestureDirtyRef.current) {
        onPreviewLayersRef.current?.(layersRef.current);
        gestureDirtyRef.current = true;
        setGestureActive(true);
        setCanvasGestureActive(true);
      }
      gestureLayersRef.current = moved;
      layersRef.current = moved;
      imperativeMoveIdsRef.current = nextMoveIds;
      const frame = frameRef.current;
      if (frame) applyLayerDomTransforms(frame, moved, nextMoveIds);
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

    let originBounds: RectMm | null = null;
    let rails: ReturnType<typeof prepareSnapRails> | undefined;
    let othersRects: RectMm[] = [];
    let refGaps: ReturnType<typeof collectReferenceGaps> | undefined;

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
          const equalAxes = new Set(equal.labels.map((label) => label.axis));
          if (equalAxes.size) {
            nextGuides = nextGuides.filter((guide) => !equalAxes.has(guide.axis));
          }
        }
        if (snapToGridRef.current && originBounds) {
          const gridBox = snapUnalignedAxesToGrid(
            { x: originBounds.x + dx, y: originBounds.y + dy, w: originBounds.w, h: originBounds.h },
            gridSizeMmRef.current,
            'position',
            [...nextGuides, ...equalGapLabels],
          );
          dx = gridBox.x - originBounds.x;
          dy = gridBox.y - originBounds.y;
        }
      }
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
      const bounds = selectionBounds(moved, moveIds);
      if (bounds) {
        setGestureBbox(bounds);
        setDistanceLabelsIfChanged(
          equalGapLabels.length
            ? equalGapLabels
            : measureSelectionGaps(bounds, othersRects, pageSizeRef.current),
        );
      } else {
        setGestureBbox(null);
        setDistanceLabelsIfChanged([]);
      }
    });
    let session: PointerGestureSession;
    session = pointerGestures.start({
      onMove: (ev) => raf.schedule(ev),
      onEnd: () => {
        raf.flush();
        setGuidesIfChanged([]);
        setDistanceLabelsIfChanged([]);
        endGesture();
        if (!dragging) options?.onClickWithoutDrag?.();
      },
      onKeyDown: escapeToAbort(() => session),
      onAbort: () => {
        raf.cancel();
        abortGesturePreview({ layers: originLayers, ids });
        if (options?.duplicate && didDuplicate) {
          onSelectIdsRef.current(originSelectedIds);
        }
      },
    });
  };
}

function sampleLayerColor(layer: CanvasLayer | undefined | null): string | null {
  if (!layer) return null;
  const v = layer.cssVars;
  if (isTextualLayerType(layer.type)) {
    if (v['--color']) return v['--color'];
  }
  if (v['--fill-visible'] !== '0' && v['--background-color']) return v['--background-color'];
  if (v['--stroke-visible'] !== '0' && v['--border-color']) return v['--border-color'];
  if (v['--color']) return v['--color'];
  return null;
}

interface SelectionHandlersDeps {
  layersRef: MutableRefObject<CanvasLayer[]>;
  selectedIdsRef: MutableRefObject<string[]>;
  editingLayerIdRef: MutableRefObject<string | null>;
  eyedropperActiveRef: MutableRefObject<boolean>;
  onEyedropperPickRef: MutableRefObject<((color: string) => void) | undefined>;
  onExitGroupEditRef: MutableRefObject<(() => void) | undefined>;
  onSelectIdsRef: MutableRefObject<(ids: string[]) => void>;
  onSelectRef: MutableRefObject<(id: string | null, additive?: boolean) => void>;
  onCommitEditRef: MutableRefObject<(() => void) | undefined>;
  onCancelInertia?: () => void;
  enteredDescendants: () => Set<string> | null;
  pickHit: (
    clientX: number,
    clientY: number,
    opts?: { within?: Set<string> | null; skipSelected?: boolean },
  ) => string | null;
  beginSelectionMove: ReturnType<typeof createSelectionMoveStarter>;
}

export function createArtboardSelectionHandlers(deps: SelectionHandlersDeps) {
  const {
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
  } = deps;

  const handleLayerPointerDown = (
    id: string,
    e: {
      button: number;
      shiftKey: boolean;
      ctrlKey: boolean;
      metaKey: boolean;
      altKey: boolean;
      clientX: number;
      clientY: number;
      preventDefault: () => void;
    },
  ) => {
    if (e.button === 1) return;
    if (e.button !== 0) return;
    onCancelInertia?.();
    if (eyedropperActiveRef.current) {
      const hitId = pickHit(e.clientX, e.clientY);
      const color = sampleLayerColor(layersRef.current.find((l) => l.id === hitId)) ?? '#FFFFFF';
      onEyedropperPickRef.current?.(color);
      return;
    }
    let targetId = id;
    const groupMembers = enteredDescendants();
    if (groupMembers) {
      const hit = pickHit(e.clientX, e.clientY, { within: groupMembers });
      if (!hit) {
        onExitGroupEditRef.current?.();
        onSelectIdsRef.current?.([]);
        return;
      }
      targetId = hit;
    } else if (e.ctrlKey || e.metaKey) {
      targetId = pickHit(e.clientX, e.clientY, { skipSelected: true }) ?? id;
    }
    const additive = e.shiftKey;
    if (editingLayerIdRef.current) {
      if (targetId === editingLayerIdRef.current) return;
      onCommitEditRef.current?.();
    }
    const current = selectedIdsRef.current;
    const wasSelected = current.includes(targetId);
    let ids: string[];
    let onClickWithoutDrag: (() => void) | undefined;

    if (additive) {
      if (wasSelected) {
        ids = current;
        onClickWithoutDrag = () => {
          onSelectIdsRef.current(current.filter((x) => x !== targetId));
        };
      } else {
        ids = [...current, targetId];
        onSelectIdsRef.current(ids);
      }
    } else if (wasSelected && current.length > 1) {
      ids = current;
    } else {
      ids = [targetId];
      onSelectRef.current(targetId, false);
    }

    const layer = layersRef.current.find((l) => l.id === targetId);
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
      originSelectedIds: ids,
    });
  };

  return { handleLayerPointerDown };
}
