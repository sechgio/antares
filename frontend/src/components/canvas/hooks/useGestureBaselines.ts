import { useCallback, useRef } from 'react';
import { cloneDocument } from '../ops/document';
import { rebuildGridSlots } from '../ops/gridLayout';
import { setActivePageLayers, syncImagesPerPage } from '../ops/pages';
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
 * `panelBaselineRef` is exposed so `onSelect` can detect an in-flight panel
 * edit and seal it when the user clicks elsewhere. */
export function useGestureBaselines({ history, pageIndex }: UseGestureBaselinesOptions) {
  const gestureBaselineRef = useRef<CanvasDocument | null>(null);
  const panelBaselineRef = useRef<CanvasDocument | null>(null);

  const setPageLayersLive = useCallback(
    (layers: CanvasLayer[]) => {
      if (!gestureBaselineRef.current) {
        gestureBaselineRef.current = cloneDocument(history.document);
      }
      // Called once at gesture end (Artboard keeps live preview local) — sync here is fine.
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
        panelBaselineRef.current = cloneDocument(history.document);
      }
      let layers = history.document.layers.map((l) => (l.id === layer.id ? layer : l));
      if (layer.type === 'grid') {
        layers = rebuildGridSlots(layers, layer.id);
      }
      history.updateSilent(syncImagesPerPage({ ...history.document, layers }));
    },
    [history],
  );

  const onPanelCommitLive = useCallback(() => {
    const baseline = panelBaselineRef.current;
    if (!baseline) return;
    panelBaselineRef.current = null;
    history.commitFromBaseline(baseline);
  }, [history]);

  return {
    panelBaselineRef,
    setPageLayersLive,
    commitPageLayersGesture,
    onPanelChangeLive,
    onPanelCommitLive,
  };
}
