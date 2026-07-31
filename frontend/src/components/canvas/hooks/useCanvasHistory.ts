import { useCallback, useMemo, useRef, useState } from 'react';
import type { CanvasDocument } from '../types';
import {
  applyDocumentDiff,
  computeDocumentDiff,
  isHistoryStepDiff,
  type HistoryStep,
  type HistoryStepDiff,
} from '../utils/canvasDiff';

/** Cap undo depth to limit RAM when documents embed large data-URL images. */
export const MAX_HISTORY = 30;

export function useCanvasHistory(initial: CanvasDocument) {
  const [document, setDocumentState] = useState<CanvasDocument>(initial);
  const [past, setPast] = useState<HistoryStep[]>([]);
  const [future, setFuture] = useState<HistoryStep[]>([]);

  // Refs stay in sync so rapid undo/redo / setDocument see the latest stacks.
  const documentRef = useRef(document);
  const pastRef = useRef(past);
  const futureRef = useRef(future);
  documentRef.current = document;
  pastRef.current = past;
  futureRef.current = future;

  const setDocument = useCallback((next: CanvasDocument) => {
    // Skip no-op commits: identical reference would push a useless undo entry.
    if (next === documentRef.current) return;
    const prev = documentRef.current;
    const step: HistoryStepDiff = {
      type: 'diff',
      undoDiff: computeDocumentDiff(next, prev),
      redoDiff: computeDocumentDiff(prev, next),
    };
    const nextPast = [...pastRef.current.slice(-(MAX_HISTORY - 1)), step];
    pastRef.current = nextPast;
    futureRef.current = [];
    documentRef.current = next;
    setPast(nextPast);
    setFuture([]);
    setDocumentState(next);
  }, []);

  const replaceDocument = useCallback((next: CanvasDocument) => {
    pastRef.current = [];
    futureRef.current = [];
    documentRef.current = next;
    setPast([]);
    setFuture([]);
    setDocumentState(next);
  }, []);

  const updateSilent = useCallback((next: CanvasDocument) => {
    if (next === documentRef.current) return;
    documentRef.current = next;
    setDocumentState(next);
  }, []);

  /** Push a pre-edit snapshot into undo without changing the current document. */
  const commitFromBaseline = useCallback((baseline: CanvasDocument) => {
    const current = documentRef.current;
    const step: HistoryStepDiff = {
      type: 'diff',
      undoDiff: computeDocumentDiff(current, baseline),
      redoDiff: computeDocumentDiff(baseline, current),
    };
    const nextPast = [...pastRef.current.slice(-(MAX_HISTORY - 1)), step];
    pastRef.current = nextPast;
    futureRef.current = [];
    setPast(nextPast);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    const p = pastRef.current;
    if (p.length === 0) return;
    const step = p[p.length - 1];
    const current = documentRef.current;
    const prev = isHistoryStepDiff(step) ? applyDocumentDiff(current, step.undoDiff) : step;

    const futureStep: HistoryStepDiff = {
      type: 'diff',
      undoDiff: computeDocumentDiff(current, prev),
      redoDiff: computeDocumentDiff(prev, current),
    };

    const nextPast = p.slice(0, -1);
    const nextFuture = [...futureRef.current, futureStep];
    pastRef.current = nextPast;
    futureRef.current = nextFuture;
    documentRef.current = prev;
    setPast(nextPast);
    setFuture(nextFuture);
    setDocumentState(prev);
  }, []);

  const redo = useCallback(() => {
    const f = futureRef.current;
    if (f.length === 0) return;
    const step = f[f.length - 1];
    const current = documentRef.current;
    const next = isHistoryStepDiff(step) ? applyDocumentDiff(current, step.redoDiff) : step;

    const pastStep: HistoryStepDiff = {
      type: 'diff',
      undoDiff: computeDocumentDiff(next, current),
      redoDiff: computeDocumentDiff(current, next),
    };

    const nextFuture = f.slice(0, -1);
    const nextPast = [...pastRef.current, pastStep];
    futureRef.current = nextFuture;
    pastRef.current = nextPast;
    documentRef.current = next;
    setFuture(nextFuture);
    setPast(nextPast);
    setDocumentState(next);
  }, []);

  const restoreHistory = useCallback((nextPast: HistoryStep[], nextFuture: HistoryStep[]) => {
    const safePast = (nextPast || []).slice(-MAX_HISTORY);
    const safeFuture = (nextFuture || []).slice(-MAX_HISTORY);
    pastRef.current = safePast;
    futureRef.current = safeFuture;
    setPast(safePast);
    setFuture(safeFuture);
  }, []);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  return useMemo(
    () => ({
      document,
      past,
      future,
      setDocument,
      replaceDocument,
      restoreHistory,
      updateSilent,
      commitFromBaseline,
      undo,
      redo,
      canUndo,
      canRedo,
    }),
    [
      document,
      past,
      future,
      setDocument,
      replaceDocument,
      restoreHistory,
      updateSilent,
      commitFromBaseline,
      undo,
      redo,
      canUndo,
      canRedo,
    ],
  );
}
