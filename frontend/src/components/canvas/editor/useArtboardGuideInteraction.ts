import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import {
  clampGuidePos,
  createGuide,
  isGuideRemovalPoint,
  measureGuideDistances,
  type DistanceLabel,
} from '../ops/guides';
import { createGestureRaf } from '../ops/gestureRaf';
import { layerBounds } from '../ops/layerBounds';
import type { PointerGestureOwner, PointerGestureSession } from '../ops/pointerGestureSession';
import {
  isPointerClick,
  prepareSnapRails,
  snapGuidePosition,
  snapThresholdMm,
} from '../ops/selectionTransform';
import { clientToMm } from '../ops/drawHelpers';
import type { CanvasGuide, CanvasLayer } from '../types';
import { createFrameRectCache } from './frameRectCache';
import { RULER_SIZE } from './CanvasRulers';
import type { GuideContextMenuState } from './GuideContextMenu';

export interface GuideDragState {
  id: string;
  axis: CanvasGuide['axis'];
  pageIndex: number;
  posMm: number;
  clientX: number;
  clientY: number;
  willRemove: boolean;
}

interface ArtboardGuideInteractionParams {
  frameRef: MutableRefObject<HTMLDivElement | null>;
  viewportRef: MutableRefObject<HTMLDivElement | null>;
  zoomRef: MutableRefObject<number>;
  layersRef: MutableRefObject<CanvasLayer[]>;
  pageSizeRef: MutableRefObject<{ widthMm: number; heightMm: number }>;
  pageMarginRef: MutableRefObject<number>;
  onSelectIdsRef: MutableRefObject<((ids: string[]) => void) | undefined>;
  pointerGestures: PointerGestureOwner;
  pageIndex: number;
  pageGuides: CanvasGuide[];
  onCancelInertia: (() => void) | undefined;
  onMoveGuide: ((id: string, posMm: number) => void) | undefined;
  onRemoveGuide: ((id: string) => void) | undefined;
  onNudgeGuide: ((id: string, deltaMm: number) => void) | undefined;
  onUpsertGuide: ((guide: CanvasGuide) => void) | undefined;
  onCommitGuideCreate: ((guide: CanvasGuide) => void) | undefined;
  onCancelGuideCreate: ((id: string) => void) | undefined;
}

export function useArtboardGuideInteraction({
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
}: ArtboardGuideInteractionParams) {
  const [guideDistanceLabels, setGuideDistanceLabels] = useState<DistanceLabel[]>([]);
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  const [guideMenu, setGuideMenu] = useState<GuideContextMenuState | null>(null);
  const [guideDrag, setGuideDrag] = useState<GuideDragState | null>(null);

  const displayGuides = useMemo(() => {
    if (!guideDrag) return pageGuides;
    let found = false;
    const next = pageGuides.map((g) => {
      if (g.id !== guideDrag.id) return g;
      found = true;
      return { ...g, posMm: guideDrag.posMm };
    });
    if (!found) {
      next.push({
        id: guideDrag.id,
        axis: guideDrag.axis,
        posMm: guideDrag.posMm,
        pageIndex: guideDrag.pageIndex,
      });
    }
    return next;
  }, [pageGuides, guideDrag]);
  const manualGuidesRef = useRef(displayGuides);
  manualGuidesRef.current = displayGuides;

  const updateGuideMeasurements = useCallback(
    (measurement: { axis: CanvasGuide['axis']; posMm: number } | null) => {
      if (!measurement) {
        setGuideDistanceLabels([]);
        return;
      }
      const rects = layersRef.current
        .filter((layer) => layer.type !== 'frame' && layer.visible !== false)
        .map((layer) => {
          const bounds = layerBounds(layer);
          return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
        });
      setGuideDistanceLabels(
        measureGuideDistances(measurement.axis, measurement.posMm, rects, pageSizeRef.current),
      );
    },
    [layersRef, pageSizeRef],
  );

  const resetGuideDrag = useCallback(() => {
    setGuideDrag(null);
    setGuideDistanceLabels([]);
  }, []);

  useEffect(() => {
    if (
      selectedGuideId &&
      guideDrag?.id !== selectedGuideId &&
      !pageGuides.some((guide) => guide.id === selectedGuideId)
    ) {
      setSelectedGuideId(null);
    }
  }, [guideDrag?.id, pageGuides, selectedGuideId]);

  const onUpsertGuideRef = useRef(onUpsertGuide);
  onUpsertGuideRef.current = onUpsertGuide;
  const onCommitGuideCreateRef = useRef(onCommitGuideCreate);
  onCommitGuideCreateRef.current = onCommitGuideCreate;
  const onCancelGuideCreateRef = useRef(onCancelGuideCreate);
  onCancelGuideCreateRef.current = onCancelGuideCreate;
  const handleCreateGuide = useCallback((guide: CanvasGuide) => {
    onUpsertGuideRef.current?.(guide);
  }, []);
  const handleCommitGuideCreate = useCallback((guide: CanvasGuide) => {
    (onCommitGuideCreateRef.current ?? onUpsertGuideRef.current)?.(guide);
  }, []);
  const handleCancelGuideCreate = useCallback((id: string) => {
    onCancelGuideCreateRef.current?.(id);
  }, []);

  const beginGuideDrag = (g: CanvasGuide, e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.focus();
    onCancelInertia?.();
    if (!frameRef.current) return;
    setGuideMenu(null);
    setSelectedGuideId(g.id);
    onSelectIdsRef.current?.([]);
    const original = g.posMm;
    let lastPos = g.posMm;
    let willRemove = false;
    let cancelled = false;
    let dragging = false;
    const duplicate = e.altKey;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let activeGuide = g;
    const frameRect = createFrameRectCache(frameRef.current, zoomRef);
    const viewportRect = viewportRef.current?.getBoundingClientRect() ?? null;
    const guideRails = prepareSnapRails(
      layersRef.current,
      [],
      pageSizeRef.current,
      manualGuidesRef.current.filter((guide) => duplicate || guide.id !== g.id),
      pageMarginRef.current,
    );
    if (!duplicate) {
      setGuideDrag({
        id: g.id,
        axis: g.axis,
        pageIndex: g.pageIndex ?? pageIndex,
        posMm: g.posMm,
        clientX: e.clientX,
        clientY: e.clientY,
        willRemove: false,
      });
    }

    const raf = createGestureRaf((ev: PointerEvent) => {
      if (cancelled) return;
      if (!dragging) {
        if (isPointerClick(ev.clientX - startClientX, ev.clientY - startClientY)) return;
        dragging = true;
        if (duplicate) {
          activeGuide = createGuide(g.axis, g.posMm, g.pageIndex ?? pageIndex);
          setSelectedGuideId(activeGuide.id);
        }
      }
      const cur = clientToMm(ev.clientX, ev.clientY, frameRect.read(), zoomRef.current);
      const max = g.axis === 'x' ? pageSizeRef.current.widthMm : pageSizeRef.current.heightMm;
      const rawPos = clampGuidePos(g.axis === 'x' ? cur.xMm : cur.yMm, max);
      lastPos = ev.ctrlKey || ev.metaKey
        ? rawPos
        : snapGuidePosition(g.axis, rawPos, guideRails, snapThresholdMm(zoomRef.current)).posMm;
      activeGuide = { ...activeGuide, posMm: lastPos };
      willRemove = viewportRect
        ? isGuideRemovalPoint(g.axis, ev.clientX, ev.clientY, viewportRect, RULER_SIZE)
        : false;
      setGuideDrag({
        id: activeGuide.id,
        axis: activeGuide.axis,
        pageIndex: activeGuide.pageIndex ?? pageIndex,
        posMm: lastPos,
        clientX: ev.clientX,
        clientY: ev.clientY,
        willRemove,
      });
      updateGuideMeasurements(ev.altKey ? { axis: activeGuide.axis, posMm: lastPos } : null);
    });

    let session: PointerGestureSession;
    session = pointerGestures.start({
      onMove: (ev) => raf.schedule(ev),
      onEnd: () => {
        raf.flush();
        setGuideDrag(null);
        setGuideDistanceLabels([]);
        if (cancelled) return;
        if (duplicate) {
          if (dragging && !willRemove) handleCommitGuideCreate(activeGuide);
          if (!dragging || willRemove) setSelectedGuideId(g.id);
        } else if (willRemove) onRemoveGuide?.(g.id);
        else if (lastPos !== original) onMoveGuide?.(g.id, lastPos);
      },
      onKeyDown: (ev) => {
        if (ev.key !== 'Escape') return;
        cancelled = true;
        session.abort();
      },
      onAbort: () => {
        raf.cancel();
        setGuideDrag(null);
        setGuideDistanceLabels([]);
        if (duplicate) setSelectedGuideId(g.id);
      },
    });
  };

  const onGuideKeyDown = (guide: CanvasGuide, e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.currentTarget.blur();
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      const movesOnAxis =
        guide.axis === 'x'
          ? e.key === 'ArrowLeft' || e.key === 'ArrowRight'
          : e.key === 'ArrowUp' || e.key === 'ArrowDown';
      if (!movesOnAxis) return;
      const stepMm = e.altKey ? 0.1 : e.shiftKey ? 10 : 1;
      const direction = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
      if (onNudgeGuide) {
        onNudgeGuide(guide.id, direction * stepMm);
      } else {
        const maxMm = guide.axis === 'x' ? pageSizeRef.current.widthMm : pageSizeRef.current.heightMm;
        const nextPos = clampGuidePos(guide.posMm + direction * stepMm, maxMm);
        if (nextPos !== guide.posMm) onMoveGuide?.(guide.id, nextPos);
      }
      return;
    }
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedGuideId(null);
    onRemoveGuide?.(guide.id);
  };

  return {
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
  };
}
