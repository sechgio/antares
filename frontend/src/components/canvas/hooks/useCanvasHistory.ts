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
/** Aggregate byte budget for past + future stacks (UTF-16 string estimate). */
export const MAX_HISTORY_BYTES = 64 * 1024 * 1024;

/**
 * Per-step byte estimates, keyed by step reference. Steps are immutable once
 * pushed, so a step's JSON size never changes; caching avoids re-serializing
 * the whole stack (up to 64 MB of data-URL payloads) on every edit just to
 * decide whether to trim one step. WeakMap lets dropped steps be GC'd.
 */
const stepBytesCache = new WeakMap<object, number>();

export function estimateStepBytes(step: HistoryStep): number {
  const cacheable = typeof step === 'object' && step !== null;
  const cached = cacheable ? stepBytesCache.get(step) : undefined;
  if (cached !== undefined) return cached;
  let bytes: number;
  try {
    bytes = JSON.stringify(step).length * 2;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  if (cacheable) stepBytesCache.set(step, bytes);
  return bytes;
}

export function estimateHistoryBytes(steps: HistoryStep[]): number {
  let total = 0;
  for (const step of steps) {
    const n = estimateStepBytes(step);
    if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
    total += n;
  }
  return total;
}

/**
 * Enforce both step-count and aggregate byte budgets.
 * Drops oldest past entries first, then oldest future entries.
 */
export function trimHistoryByBudget(
  past: HistoryStep[],
  future: HistoryStep[],
  maxSteps: number = MAX_HISTORY,
  maxBytes: number = MAX_HISTORY_BYTES,
): { past: HistoryStep[]; future: HistoryStep[] } {
  let nextPast = past.slice(-maxSteps);
  let nextFuture = future.slice(-maxSteps);

  // Incremental budget: weigh each step once, then subtract as we drop —
  // avoids re-JSON.stringify of whole stacks on every while iteration.
  let bytes = estimateHistoryBytes(nextPast) + estimateHistoryBytes(nextFuture);
  while (bytes > maxBytes && (nextPast.length > 0 || nextFuture.length > 0)) {
    if (nextPast.length > 0) {
      bytes -= estimateStepBytes(nextPast[0]!);
      nextPast = nextPast.slice(1);
    } else {
      bytes -= estimateStepBytes(nextFuture[0]!);
      nextFuture = nextFuture.slice(1);
    }
  }

  return { past: nextPast, future: nextFuture };
}

export function useCanvasHistory(initial: CanvasDocument) {
  const [document, setDocumentState] = useState<CanvasDocument>(initial);
  const [past, setPast] = useState<HistoryStep[]>([]);
  const [future, setFuture] = useState<HistoryStep[]>([]);
  const [revision, setRevision] = useState(0);

  // Refs stay in sync so rapid undo/redo / setDocument see the latest stacks.
  const documentRef = useRef(document);
  const pastRef = useRef(past);
  const futureRef = useRef(future);
  const revisionRef = useRef(revision);
  /** True after discrete edits until replaceDocument (load / save / cloud apply). */
  const hasUnsavedEditsRef = useRef(false);
  documentRef.current = document;
  pastRef.current = past;
  futureRef.current = future;
  revisionRef.current = revision;

  const bumpRevision = useCallback(() => {
    const next = revisionRef.current + 1;
    revisionRef.current = next;
    setRevision(next);
  }, []);

  const setDocument = useCallback((next: CanvasDocument) => {
    // Skip no-op commits: identical reference would push a useless undo entry.
    if (next === documentRef.current) return;
    const prev = documentRef.current;
    const step: HistoryStepDiff = {
      type: 'diff',
      undoDiff: computeDocumentDiff(next, prev),
      redoDiff: computeDocumentDiff(prev, next),
    };
    const trimmed = trimHistoryByBudget(
      [...pastRef.current, step],
      [],
    );
    pastRef.current = trimmed.past;
    futureRef.current = trimmed.future;
    documentRef.current = next;
    hasUnsavedEditsRef.current = true;
    setPast(trimmed.past);
    setFuture(trimmed.future);
    setDocumentState(next);
    bumpRevision();
  }, [bumpRevision]);

  const replaceDocument = useCallback((next: CanvasDocument) => {
    pastRef.current = [];
    futureRef.current = [];
    documentRef.current = next;
    hasUnsavedEditsRef.current = false;
    setPast([]);
    setFuture([]);
    setDocumentState(next);
    bumpRevision();
  }, [bumpRevision]);

  const updateSilent = useCallback((next: CanvasDocument) => {
    if (next === documentRef.current) return;
    documentRef.current = next;
    setDocumentState(next);
    bumpRevision();
  }, [bumpRevision]);

  /** Push a pre-edit snapshot into undo without changing the current document. */
  const commitFromBaseline = useCallback((baseline: CanvasDocument) => {
    const current = documentRef.current;
    const step: HistoryStepDiff = {
      type: 'diff',
      undoDiff: computeDocumentDiff(current, baseline),
      redoDiff: computeDocumentDiff(baseline, current),
    };
    const trimmed = trimHistoryByBudget(
      [...pastRef.current, step],
      [],
    );
    pastRef.current = trimmed.past;
    futureRef.current = trimmed.future;
    hasUnsavedEditsRef.current = true;
    setPast(trimmed.past);
    setFuture(trimmed.future);
    bumpRevision();
  }, [bumpRevision]);

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

    const trimmed = trimHistoryByBudget(p.slice(0, -1), [...futureRef.current, futureStep]);
    pastRef.current = trimmed.past;
    futureRef.current = trimmed.future;
    documentRef.current = prev;
    // Undo leaves memory ≠ last save; cloud sync must treat the open doc as dirty.
    hasUnsavedEditsRef.current = true;
    setPast(trimmed.past);
    setFuture(trimmed.future);
    setDocumentState(prev);
    bumpRevision();
  }, [bumpRevision]);

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

    const trimmed = trimHistoryByBudget([...pastRef.current, pastStep], f.slice(0, -1));
    futureRef.current = trimmed.future;
    pastRef.current = trimmed.past;
    documentRef.current = next;
    // Same as undo: redo mutates the open document relative to the last save.
    hasUnsavedEditsRef.current = true;
    setFuture(trimmed.future);
    setPast(trimmed.past);
    setDocumentState(next);
    bumpRevision();
  }, [bumpRevision]);

  const restoreHistory = useCallback((nextPast: HistoryStep[], nextFuture: HistoryStep[]) => {
    const trimmed = trimHistoryByBudget(nextPast || [], nextFuture || []);
    pastRef.current = trimmed.past;
    futureRef.current = trimmed.future;
    setPast(trimmed.past);
    setFuture(trimmed.future);
    bumpRevision();
  }, [bumpRevision]);

  /** Clear dirty after a successful save without wiping undo/redo stacks. */
  const markSaved = useCallback(() => {
    hasUnsavedEditsRef.current = false;
  }, []);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  return useMemo(
    () => ({
      document,
      past,
      future,
      revision,
      setDocument,
      replaceDocument,
      restoreHistory,
      updateSilent,
      commitFromBaseline,
      undo,
      redo,
      markSaved,
      canUndo,
      canRedo,
      documentRef,
      revisionRef,
      hasUnsavedEditsRef,
    }),
    [
      document,
      past,
      future,
      revision,
      setDocument,
      replaceDocument,
      restoreHistory,
      updateSilent,
      commitFromBaseline,
      undo,
      redo,
      markSaved,
      canUndo,
      canRedo,
    ],
  );
}
