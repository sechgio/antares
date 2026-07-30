import { useCallback, useRef } from 'react';
import { cloneDocumentBaseline } from '../ops/document';
import { applyLivePanelLayerChange } from '../ops/gridLayout';
import { setActivePageLayers, syncImagesPerPage } from '../ops/pages';
import { syncLinkedStylesFromLayer } from '../ops/syncLinkedStyles';
import type { CanvasDocument, CanvasLayer } from '../types';
import type { useCanvasHistory } from './useCanvasHistory';

interface UseGestureBaselinesOptions {
  history: ReturnType<typeof useCanvasHistory>;
  pageIndex: number;
}

/** Gesture/panel live-preview + commit baselines. Both share the same shape:
 * capture the document on the first live update, `updateSilent` while the
 * gesture/panel is in flight, `commitFromBaseline` once on release so the
 * whole interaction is a single undo entry.
 *
 * `panelBaselineRef` / `gestureBaselineRef` are exposed so CanvasView can seal
 * panel edits and cancel in-flight gestures (undo, dirty sync gate). */
export function useGestureBaselines({ history, pageIndex }: UseGestureBaselinesOptions) {
  const gestureBaselineRef = useRef<CanvasDocument | null>(null);
  const panelBaselineRef = useRef<CanvasDocument | null>(null);

  const setPageLayersLive = useCallback(
    (layers: CanvasLayer[]) => {
      if (!gestureBaselineRef.current) {
        gestureBaselineRef.current = cloneDocumentBaseline(history.document, pageIndex);
      }
      // First call (gesture start) captures baseline; later calls push live layers.
      history.updateSilent(
        syncImagesPerPage(setActivePageLayers(history.document, pageIndex, layers)),
      );
    },
    [history, pageIndex],
  );

  const commitPageLayersGesture = useCallback(() => {
    const baseline = gestureBaselineRef.current;
    if (!baseline) return;
    gestureBaselineRef.current = null;
    history.commitFromBaseline(baseline);
  }, [history]);

  const onPanelChangeLive = useCallback(
    (layer: CanvasLayer) => {
      if (!panelBaselineRef.current) {
        panelBaselineRef.current = cloneDocumentBaseline(history.document, pageIndex);
      }
      const prev = history.document.layers.find((l) => l.id === layer.id);
      const layers = applyLivePanelLayerChange(history.document.layers, prev, layer);
      const doc = syncLinkedStylesFromLayer({ ...history.document, layers }, prev, layer);
      history.updateSilent(syncImagesPerPage(doc));
    },
    [history, pageIndex],
  );

  const onPanelCommitLive = useCallback(() => {
    const baseline = panelBaselineRef.current;
    if (!baseline) return;
    panelBaselineRef.current = null;
    history.commitFromBaseline(baseline);
  }, [history]);

  /** Revert in-flight gesture to the captured baseline (prefer cancel over commit). */
  const cancelPageLayersGesture = useCallback(() => {
    const baseline = gestureBaselineRef.current;
    if (!baseline) return false;
    gestureBaselineRef.current = null;
    history.updateSilent(baseline);
    return true;
  }, [history]);

  return {
    panelBaselineRef,
    gestureBaselineRef,
    setPageLayersLive,
    commitPageLayersGesture,
    cancelPageLayersGesture,
    onPanelChangeLive,
    onPanelCommitLive,
  };
}
