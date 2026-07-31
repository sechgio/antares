import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import type { SyncConflict } from '../sync/canvasCloudSync';
import { normalizeDocument, type CanvasDocument } from '../types';
import type { useCanvasHistory } from './useCanvasHistory';

export type SyncConflictChoice = 'use-remote' | 'keep-local';

interface UseCanvasSyncOptions {
  /** Ref to the current open document id (read inside sync without re-subscribing). */
  historyDocRef: React.MutableRefObject<CanvasDocument>;
  /** Ref to combined dirty signal (unsaved edits / panel / gesture baselines). */
  openDirtyRef: React.MutableRefObject<boolean>;
  /** Refresh the doc list (also used by docs hook). */
  refreshList: () => Promise<void>;
  /** Replace the open document after a remote-side reload. */
  replaceDocument: ReturnType<typeof useCanvasHistory>['replaceDocument'];
  /**
   * Notify UI of a conflict. Must not block — sync finishes immediately.
   * Caller owns resolution (keep-local / use-remote) outside the sync cycle.
   */
  onConflict?: (conflict: SyncConflict) => void;
  /**
   * When false (Canvas keep-alive hidden), skip focus-triggered sync so a
   * background tab cannot silently replaceDocument / pulse docsSyncing.
   */
  active?: boolean;
}

/** Dirty for cloud reload skip: unsaved edits, live panel edit, or in-flight gesture. */
export function isOpenDocumentDirty(
  hasUnsavedEdits: boolean,
  hasPanelBaseline: boolean,
  hasGestureBaseline: boolean,
): boolean {
  return hasUnsavedEdits || hasPanelBaseline || hasGestureBaseline;
}

/** Cloud sync: pull remote changes when the window regains focus.
 *
 * Returns `runCloudSync` so the bootstrap effect can call it once after mount.
 * The refs avoid re-subscribing the focus listener on every keystroke/drag. */
export function useCanvasSync({
  historyDocRef,
  openDirtyRef,
  refreshList,
  replaceDocument,
  onConflict,
  active = true,
}: UseCanvasSyncOptions) {
  const [syncing, setSyncing] = useState(false);

  const runCloudSync = useCallback(async () => {
    setSyncing(true);
    try {
      const openId = historyDocRef.current.id;
      const openDirty = openDirtyRef.current;
      const { syncCanvasDocuments } = await import('../sync/canvasCloudSync');
      const result = await syncCanvasDocuments({
        openDocumentId: openId,
        openDirty,
      });
      if (result.skipped) return;
      await refreshList();

      // Notify UI without awaiting — keep syncing=false so the sidebar stays usable.
      if (result.conflict && onConflict) {
        onConflict(result.conflict);
        return;
      }

      if (result.reloadOpenId && result.reloadOpenId === openId && !openDirtyRef.current) {
        const got = await api.canvasGet(result.reloadOpenId);
        replaceDocument(normalizeDocument(got.document as CanvasDocument));
      }
    } catch {
      /* offline / auth — local cache remains usable */
    } finally {
      setSyncing(false);
    }
  }, [historyDocRef, openDirtyRef, refreshList, replaceDocument, onConflict]);

  useEffect(() => {
    if (!active) return;
    const onFocus = () => {
      void runCloudSync();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [runCloudSync, active]);

  return { runCloudSync, syncing };
}
