import { useCallback, useEffect, useRef } from 'react';
import { cloneDocumentBaseline } from '../ops/document';
import { applyLivePanelLayerChange } from '../ops/gridLayout';
import { applyContainerLayoutPanelEffects } from '../ops/layerOps';
import { createGestureRaf } from '../ops/gestureRaf';
import { setActivePageLayers, syncImagesPerPage } from '../ops/pages';
import {
  bakeAllInstances,
  bakeInstanceOverrides,
  findComponentMaster,
  syncChangedMasters,
  syncComponentFromLayer,
} from '../ops/components';
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
  const historyRef = useRef(history);
  const pageIndexRef = useRef(pageIndex);
  historyRef.current = history;
  pageIndexRef.current = pageIndex;

  const applyPanelLayerRef = useRef<(layer: CanvasLayer) => void>(() => {});
  applyPanelLayerRef.current = (layer: CanvasLayer) => {
    const hist = historyRef.current;
    const idx = pageIndexRef.current;
    if (!panelBaselineRef.current) {
      panelBaselineRef.current = cloneDocumentBaseline(hist.document, idx);
    }
    let nextLayer = layer;
    if (layer.meta?.instanceOf) {
      nextLayer = bakeInstanceOverrides(
        layer,
        findComponentMaster(hist.document.layers, layer.meta.instanceOf),
      );
    }
    const prev = hist.document.layers.find((l) => l.id === nextLayer.id);
    const layers = applyContainerLayoutPanelEffects(
      applyLivePanelLayerChange(hist.document.layers, prev, nextLayer),
      prev,
      nextLayer,
    );
    const styleSynced = syncLinkedStylesFromLayer({ ...hist.document, layers }, prev, nextLayer);
    const doc = syncComponentFromLayer(styleSynced, prev, nextLayer);
    hist.updateSilent(syncImagesPerPage(doc));
  };

  const panelRafRef = useRef(
    createGestureRaf((layer: CanvasLayer) => applyPanelLayerRef.current(layer)),
  );
  useEffect(() => () => panelRafRef.current.cancel(), []);

  const setPageLayersLive = useCallback(
    (layers: CanvasLayer[]) => {
      if (!gestureBaselineRef.current) {
        gestureBaselineRef.current = cloneDocumentBaseline(history.document, pageIndex);
      }
      const layered = setActivePageLayers(history.document, pageIndex, layers);
      // Gesture-start baseline passes identical layer refs — skip the React commit
      // (avoid syncImagesPerPage stamping settings and forcing a Capas re-render).
      if (layered === history.document) return;
      history.updateSilent(syncImagesPerPage(layered));
    },
    [history, pageIndex],
  );

  const commitPageLayersGesture = useCallback(() => {
    const baseline = gestureBaselineRef.current;
    if (!baseline) return;
    gestureBaselineRef.current = null;
    let doc = bakeAllInstances(history.document);
    doc = syncChangedMasters(doc, baseline);
    if (doc !== history.document) {
      history.updateSilent(syncImagesPerPage(doc));
    }
    history.commitFromBaseline(baseline);
  }, [history]);

  const onPanelChangeLive = useCallback((layer: CanvasLayer) => {
    // Mark dirty immediately so focus/undo gates see an in-flight panel edit.
    if (!panelBaselineRef.current) {
      panelBaselineRef.current = cloneDocumentBaseline(
        historyRef.current.document,
        pageIndexRef.current,
      );
    }
    panelRafRef.current.schedule(layer);
  }, []);

  const onPanelCommitLive = useCallback(() => {
    panelRafRef.current.flush();
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
