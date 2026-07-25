import { useCallback, useMemo, useRef, useState } from 'react';
import type { CanvasDocument } from '../types';

/** Cap undo depth to limit RAM when documents embed large data-URL images. */
export const MAX_HISTORY = 30;

export function useCanvasHistory(initial: CanvasDocument) {
  const [document, setDocumentState] = useState<CanvasDocument>(initial);
  const [past, setPast] = useState<CanvasDocument[]>([]);
  const [future, setFuture] = useState<CanvasDocument[]>([]);

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
    const nextPast = [...pastRef.current.slice(-(MAX_HISTORY - 1)), documentRef.current];
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
    documentRef.current = next;
    setDocumentState(next);
  }, []);

  /** Push a pre-edit snapshot into undo without changing the current document. */
  const commitFromBaseline = useCallback((baseline: CanvasDocument) => {
    const nextPast = [...pastRef.current.slice(-(MAX_HISTORY - 1)), baseline];
    pastRef.current = nextPast;
    futureRef.current = [];
    setPast(nextPast);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    const p = pastRef.current;
    if (p.length === 0) return;
    const prev = p[p.length - 1];
    const current = documentRef.current;
    const nextPast = p.slice(0, -1);
    const nextFuture = [...futureRef.current, current];
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
    const next = f[f.length - 1];
    const current = documentRef.current;
    const nextFuture = f.slice(0, -1);
    const nextPast = [...pastRef.current, current];
    futureRef.current = nextFuture;
    pastRef.current = nextPast;
    documentRef.current = next;
    setFuture(nextFuture);
    setPast(nextPast);
    setDocumentState(next);
  }, []);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  return useMemo(
    () => ({
      document,
      setDocument,
      replaceDocument,
      updateSilent,
      commitFromBaseline,
      undo,
      redo,
      canUndo,
      canRedo,
    }),
    [
      document,
      setDocument,
      replaceDocument,
      updateSilent,
      commitFromBaseline,
      undo,
      redo,
      canUndo,
      canRedo,
    ],
  );
}
