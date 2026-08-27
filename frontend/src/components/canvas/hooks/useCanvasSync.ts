import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import type { SyncConflict, SyncResult } from '../sync/syncCompare';
import { normalizeDocument, type CanvasDocument } from '../types';
import { hydrateDocumentImages } from '../utils/imageBlobStore';
import type { CanvasHistoryHandle } from './useCanvasHistory';

export type SyncConflictChoice = 'use-remote' | 'keep-local';

interface UseCanvasSyncOptions {
  /** Ref to the current open document id (read inside sync without re-subscribing). */
  historyDocRef: React.MutableRefObject<CanvasDocument>;
  /** Ref to combined dirty signal (unsaved edits / panel / gesture baselines). */
  openDirtyRef: React.MutableRefObject<boolean>;
  /** Refresh the doc list (also used by docs hook). */
  refreshList: () => Promise<void>;
  /** Replace the open document after a remote-side reload. */
  replaceDocument: CanvasHistoryHandle['replaceDocument'];
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
  /**
   * First-boot guarded sync: never delete or overwrite an existing local doc.
   * Set on the initial run after mount so opening the app cannot clobber the
   * documents you saved on disk. Later focus/refresh syncs use normal LWW.
   */
  guarded?: boolean;
}

/** Dirty for cloud reload skip: unsaved edits, live panel/gesture, or in-flight rename. */
export function isOpenDocumentDirty(
  hasUnsavedEdits: boolean,
  hasPanelBaseline: boolean,
  hasGestureBaseline: boolean,
  hasRenameBaseline = false,
): boolean {
  return hasUnsavedEdits || hasPanelBaseline || hasGestureBaseline || hasRenameBaseline;
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
  guarded = false,
}: UseCanvasSyncOptions) {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');

  const runCloudSync = useCallback(async (guardedOverride?: boolean) => {
    setSyncing(true);
    setSyncStatus('syncing');
    try {
      const openId = historyDocRef.current.id;
      const openDirty = openDirtyRef.current;
      const effectiveGuarded = guardedOverride ?? guarded;

      const applySyncResult = async (result: SyncResult) => {
        if (result.skipped) {

          setSyncStatus(result.reason === 'error' ? 'error' : 'idle');
          setSyncing(false);
          return;
        }
        try {
          await refreshList();
          if (result.conflict && onConflict) {
            onConflict(result.conflict);
            setSyncStatus('synced');
            return;
          }
          if (result.reloadOpenId && result.reloadOpenId === openId) {
            if (!openDirtyRef.current) {
              const got = await api.canvasGet(result.reloadOpenId);
              const doc = normalizeDocument(got.document as CanvasDocument);
              replaceDocument(await hydrateDocumentImages(doc));
            } else if (onConflict) {

              const got = await api.canvasGet(result.reloadOpenId);
              const remoteDoc = normalizeDocument(got.document as CanvasDocument);
              const localDoc = historyDocRef.current;
              onConflict({
                localDoc,
                remoteDoc,
                remoteUpdatedAt: remoteDoc.updatedAt || '',
                localUpdatedAt: localDoc.updatedAt || '',
              });
            }
          }
          setSyncStatus(result.pushErrors > 0 ? 'error' : 'synced');
        } finally {
          setSyncing(false);
        }
      };

      const { syncCanvasDocuments } = await import('../sync/canvasCloudSync');
      const result = await syncCanvasDocuments({
        openDocumentId: openId,
        openDocument: historyDocRef.current,
        openDirty,
        guarded: effectiveGuarded,
        followUp: (retryResult) => {
          void applySyncResult(retryResult);
        },
      });
      if (!result.skipped) {
        await applySyncResult(result);
      } else if (result.reason === 'sync-in-flight') {

      } else {

        setSyncStatus('idle');
        setSyncing(false);
      }
    } catch {

      setSyncStatus('error');
      setSyncing(false);
    }
  }, [historyDocRef, openDirtyRef, refreshList, replaceDocument, onConflict, guarded]);

  useEffect(() => {
    if (!active) return;
    const onFocus = () => {
      void runCloudSync();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [runCloudSync, active]);

  return { runCloudSync, syncing, syncStatus };
}
