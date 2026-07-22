import { useCallback, useState } from 'react';
import type { CanvasDocument } from '../types';

const MAX_HISTORY = 50;

export function useCanvasHistory(initial: CanvasDocument) {
  const [document, setDocumentState] = useState<CanvasDocument>(initial);
  const [past, setPast] = useState<CanvasDocument[]>([]);
  const [future, setFuture] = useState<CanvasDocument[]>([]);

  const setDocument = useCallback((next: CanvasDocument) => {
    setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), document]);
    setFuture([]);
    setDocumentState(next);
  }, [document]);

  const replaceDocument = useCallback((next: CanvasDocument) => {
    setPast([]);
    setFuture([]);
    setDocumentState(next);
  }, []);

  const updateSilent = useCallback((next: CanvasDocument) => {
    setDocumentState(next);
  }, []);

  /** Push a pre-edit snapshot into undo without changing the current document. */
  const commitFromBaseline = useCallback((baseline: CanvasDocument) => {
    setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), baseline]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [...f, document]);
      setDocumentState(prev);
      return p.slice(0, -1);
    });
  }, [document]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      setPast((p) => [...p, document]);
      setDocumentState(next);
      return f.slice(0, -1);
    });
  }, [document]);

  return {
    document,
    setDocument,
    replaceDocument,
    updateSilent,
    commitFromBaseline,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
