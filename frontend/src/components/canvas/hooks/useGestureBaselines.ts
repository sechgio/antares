import { useCallback, useRef } from 'react';
import { cloneDocumentBaseline } from '../ops/document';
import { rebuildGridSlots } from '../ops/gridLayout';
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
 * `panelBaselineRef` is exposed so `onSelect` can detect an in-flight panel
 * edit and seal it when the user clicks elsewhere. */
export function useGestureBaselines({ history, pageIndex }: UseGestureBaselinesOptions) {
  const gestureBaselineRef = useRef<CanvasDocument | null>(null);
  const panelBaselineRef = useRef<CanvasDocument | null>(null);

  const setPageLayersLive = useCallback(
    (layers: CanvasLayer[]) => {
      if (!gestureBaselineRef.current) {
        gestureBaselineRef.current = cloneDocumentBaseline(history.document, pageIndex);
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
        panelBaselineRef.current = cloneDocumentBaseline(history.document, pageIndex);
      }
      const prev = history.document.layers.find((l) => l.id === layer.id);
      let layers = history.document.layers.map((l) => (l.id === layer.id ? layer : l));
      // Only cols/rows/gap rebuild touches siblings. Slot W/H edits stay per-cell.
      if (layer.type === 'grid') {
        layers = rebuildGridSlots(layers, layer.id);
      }
      let doc = syncLinkedStylesFromLayer({ ...history.document, layers }, prev, layer);
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

  return {
    panelBaselineRef,
    setPageLayersLive,
    commitPageLayersGesture,
    onPanelChangeLive,
    onPanelCommitLive,
  };
}
