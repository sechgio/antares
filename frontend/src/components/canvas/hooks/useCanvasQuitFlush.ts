import { useEffect, useRef, type MutableRefObject } from 'react';
import { api, onNotify } from '../../../api';
import { acknowledgeCanvasFlush } from '../../../utils/ackCanvasFlush';
import { reportFrontendEvent } from '../../../utils/observability';
import type { CanvasHistoryHandle } from './useCanvasHistory';
import type { CanvasDocument } from '../types';
import {
  collectImageRefsFromHistory,
  collectImageRefsFromLayers,
  pinImageRefs,
  serializeDocumentImages,
  serializeHistorySteps,
} from '../utils/imageBlobStore';

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
  // Evalúa hasUnsavedEdits y los baselines al leer.
  isOpenDirty: () => boolean;
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
  isOpenDirty,
}: UseCanvasQuitFlushOptions): void {
  const flushRef = useRef<() => Promise<void>>(async () => {});
  // El ref evita rearmar el flush si cambia la identidad del getter.
  const isOpenDirtyRef = useRef(isOpenDirty);
  isOpenDirtyRef.current = isOpenDirty;

  useEffect(() => {
    flushRef.current = async () => {
      const startedAt = Date.now();
      type FlushFailure =
        | 'onSave_failed'
        | 'canvas_save_failed'
        | 'panel_commit_failed'
        | 'gesture_commit_failed'
        | 'inline_edit_failed'
        | 'rename_commit_failed';
      let flushFailed: FlushFailure | undefined;
      // Los cuatro commits previos se intentan aunque fallen, pero cada fallo
      // deja un reason distinto: sin él, un flush incompleto se reportaba como
      // éxito y no había forma de saber qué paso se quedó atrás.
      let commitFailed: FlushFailure | undefined;
      try {
        if (panelBaselineRef.current) onPanelCommitLive();
      } catch {
        commitFailed = 'panel_commit_failed';
      }
      try {
        if (gestureBaselineRef.current) commitPageLayersGesture();
      } catch {
        commitFailed ??= 'gesture_commit_failed';
      }
      try {
        if (editingLayerId) commitInlineEdit();
      } catch {
        commitFailed ??= 'inline_edit_failed';
      }
      try {
        const baseline = renameBaselineRef.current;
        if (baseline) {
          renameBaselineRef.current = null;
          if (baseline.name !== history.document.name) {
            history.commitFromBaseline(baseline);
          }
        }
      } catch {
        commitFailed ??= 'rename_commit_failed';
      }
      flushFailed = commitFailed;

      if (isOpenDirtyRef.current()) {
        try {
          await onSave({ silent: true });
        } catch {
          flushFailed = 'onSave_failed';
        }

        if (history.hasUnsavedEditsRef.current) {
          let unpin: (() => void) | undefined;
          try {
            unpin = pinImageRefs([
              ...collectImageRefsFromLayers(history.documentRef.current.layers),
              ...collectImageRefsFromHistory(history.past),
              ...collectImageRefsFromHistory(history.future),
            ]);
            const serialized = await serializeDocumentImages(history.documentRef.current);
            const [serializedPast, serializedFuture] = await Promise.all([
              serializeHistorySteps(history.past),
              serializeHistorySteps(history.future),
            ]);
            await Promise.all([
              api.canvasSave(serialized, { slim: true }),
              api.canvasSaveHistory(serialized.id, serializedPast, serializedFuture),
            ]);
            history.markSaved();
          } catch {
            flushFailed = 'canvas_save_failed';
          } finally {
            unpin?.();
          }
        }
      }
      // El flush se espera antes del ack; si falla queda evidencia en el JSONL.
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
