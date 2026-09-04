import { useEffect, useRef, type MutableRefObject } from 'react';
import { api, onNotify } from '../../../api';
import { acknowledgeCanvasFlush } from '../../../utils/ackCanvasFlush';
import { reportFrontendEvent } from '../../../utils/observability';
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
      const startedAt = Date.now();
      let flushFailed: 'onSave_failed' | 'canvas_save_failed' | undefined;
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

      if (history.hasUnsavedEditsRef.current || openDirtyRef.current) {
        try {
          await onSave({ silent: true });
        } catch {
          flushFailed = 'onSave_failed';
        }

        if (history.hasUnsavedEditsRef.current) {
          try {
            const serialized = await serializeDocumentImages(history.documentRef.current);
            await api.canvasSave(serialized);
            history.markSaved();
          } catch {
            flushFailed = 'canvas_save_failed';
          }
        }
      }
      // El flush fallido antes era silencioso: el doc podía perderse sin rastro
      // al cerrar. El ack se mantiene igual (no cuelga el cierre); esto solo
      // deja evidencia en el JSONL vía renderer-event.
      reportFrontendEvent({
        event: 'canvas.quit_flush',
        level: flushFailed ? 'ERROR' : 'INFO',
        outcome: flushFailed ? 'failed' : 'success',
        durationMs: Date.now() - startedAt,
        reason: flushFailed,
      });
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
