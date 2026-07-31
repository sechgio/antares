import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import type { SyncConflict } from '../sync/canvasCloudSync';
import { normalizeDocument, type CanvasDocument } from '../types';
import type { useCanvasHistory } from './useCanvasHistory';

export type SyncConflictChoice = 'use-remote' | 'keep-local';

interface UseCanvasSyncOptions {
  /** Ref to the current open document id (read inside sync without re-subscribing). */
  historyDocRef: React.MutableRefObject<CanvasDocument>;
  /** Ref to combined dirty signal (undo / panel / gesture baselines). */
  historyCanUndoRef: React.MutableRefObject<boolean>;
  /** Refresh the doc list (also used by docs hook). */
  refreshList: () => Promise<void>;
  /** Replace the open document after a remote-side reload. */
  replaceDocument: ReturnType<typeof useCanvasHistory>['replaceDocument'];
  /** Called when the open doc has local edits and a newer version exists in cloud. */
  onConflict?: (conflict: SyncConflict) => Promise<SyncConflictChoice | null>;
}

/** Dirty for cloud reload skip: undo stack, live panel edit, or in-flight gesture. */
export function isOpenDocumentDirty(
  canUndo: boolean,
  hasPanelBaseline: boolean,
  hasGestureBaseline: boolean,
): boolean {
  return canUndo || hasPanelBaseline || hasGestureBaseline;
}

/** Cloud sync: pull remote changes when the window regains focus.
 *
 * Returns `runCloudSync` so the bootstrap effect can call it once after mount.
 * The refs avoid re-subscribing the focus listener on every keystroke/drag. */
export function useCanvasSync({
  historyDocRef,
  historyCanUndoRef,
  refreshList,
  replaceDocument,
  onConflict,
}: UseCanvasSyncOptions) {
  const [syncing, setSyncing] = useState(false);

  const runCloudSync = useCallback(async () => {
    setSyncing(true);
    try {
      const openId = historyDocRef.current.id;
      const openDirty = historyCanUndoRef.current;
      const { syncCanvasDocuments } = await import('../sync/canvasCloudSync');
      const result = await syncCanvasDocuments({
        openDocumentId: openId,
        openDirty,
      });
      if (result.skipped) return;
      await refreshList();

      // Handle conflict on the open document.
      if (result.conflict && onConflict) {
        const choice = await onConflict(result.conflict);
        if (choice === 'use-remote') {
          const remote = result.conflict.remoteDoc;
          await api.canvasSave(remote, { touch: false });
          replaceDocument(remote);
          await refreshList();
        }
        // 'keep-local' / null: do nothing — user keeps editing; next save pushes.
        return;
      }

      if (result.reloadOpenId && result.reloadOpenId === openId && !historyCanUndoRef.current) {
        const got = await api.canvasGet(result.reloadOpenId);
        replaceDocument(normalizeDocument(got.document as CanvasDocument));
      }
    } catch {
      /* offline / auth — local cache remains usable */
    } finally {
      setSyncing(false);
    }
  }, [historyDocRef, historyCanUndoRef, refreshList, replaceDocument, onConflict]);

  useEffect(() => {
    const onFocus = () => {
      void runCloudSync();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [runCloudSync]);

  return { runCloudSync, syncing };
}
