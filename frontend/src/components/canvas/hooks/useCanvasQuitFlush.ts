import { useEffect, useRef, type MutableRefObject } from 'react';
import { api, onNotify } from '../../../api';
import { acknowledgeCanvasFlush } from '../../../utils/ackCanvasFlush';
import { isOpenDocumentDirty } from './useCanvasSync';
import type { CanvasHistoryHandle } from './useCanvasHistory';
import type { CanvasDocument } from '../types';
import { serializeDocumentImages } from '../utils/imageBlobStore';

interface UseCanvasQuitFlushOptions {
  history: CanvasHistoryHandle;
  editingLayerId: string | null;
  commitInlineEdit: () => void;
  commitPageLayersGesture: () => void;
  onPanelCommitLive: () => void;
  onSave: (options?: { silent?: boolean }) => Promise<boolean>;
  panelBaselineRef: MutableRefObject<CanvasDocument | null>;
  gestureBaselineRef: MutableRefObject<CanvasDocument | null>;
  renameBaselineRef: MutableRefObject<CanvasDocument | null>;
  openDirtyRef: MutableRefObject<boolean>;
}

/** Flush the hidden Canvas document before Electron destroys its renderer. */
export function useCanvasQuitFlush({
  history,
  editingLayerId,
  commitInlineEdit,
  commitPageLayersGesture,
  onPanelCommitLive,
  onSave,
  panelBaselineRef,
  gestureBaselineRef,
  renameBaselineRef,
  openDirtyRef,
}: UseCanvasQuitFlushOptions): void {
  const flushRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    flushRef.current = async () => {
      try {
        if (panelBaselineRef.current) onPanelCommitLive();
      } catch {}
      try {
        if (gestureBaselineRef.current) commitPageLayersGesture();
      } catch {}
      try {
        if (editingLayerId) commitInlineEdit();
      } catch {}
      try {
        const baseline = renameBaselineRef.current;
        if (baseline) {
          renameBaselineRef.current = null;
          if (baseline.name !== history.document.name) {
            history.commitFromBaseline(baseline);
          } else {
            openDirtyRef.current = isOpenDocumentDirty(
              history.hasUnsavedEditsRef.current,
              panelBaselineRef.current != null,
              gestureBaselineRef.current != null,
              false,
            );
          }
        }
      } catch {}

      if (!history.hasUnsavedEditsRef.current && !openDirtyRef.current) return;
      try {
        await onSave({ silent: true });
      } catch {}

      // onSave reports failures without throwing. Keep a direct final attempt
      // for the quit path while the main process is still waiting.
      if (history.hasUnsavedEditsRef.current) {
        try {
          const serialized = await serializeDocumentImages(history.documentRef.current);
          await api.canvasSave(serialized);
          history.markSaved();
        } catch {}
      }
    };
  }, [
    commitInlineEdit,
    commitPageLayersGesture,
    editingLayerId,
    history,
    onPanelCommitLive,
    onSave,
    openDirtyRef,
    panelBaselineRef,
    gestureBaselineRef,
    renameBaselineRef,
  ]);

  useEffect(() => onNotify(async (method) => {
    if (method !== 'app.flush-canvas-before-quit') return;
    try {
      await flushRef.current();
    } finally {
      try {
        await acknowledgeCanvasFlush();
      } catch {}
    }
  }), []);
}
