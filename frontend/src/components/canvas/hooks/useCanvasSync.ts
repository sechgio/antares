import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../api';
import type { SyncConflict, SyncResult } from '../sync/syncCompare';
import type {
  CanvasCollaborator,
  CanvasDocumentSavedEvent,
  CanvasPresence,
  CanvasRealtimeStatus,
  CanvasRealtimeSubscription,
} from '../sync/canvasRealtime';
import { normalizeDocument, type CanvasDocument } from '../types';
import { hydrateDocumentImages } from '../utils/imageBlobStore';
import type { CanvasHistoryHandle } from './useCanvasHistory';

export type SyncConflictChoice = 'use-remote' | 'keep-local';

const REALTIME_PULL_DEBOUNCE_MS = 350;

export interface UseCanvasSyncOptions {
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
  /** Current document id used to scope the Realtime channel. */
  documentId?: string;
  /** Do not subscribe until the initial local document has been selected. */
  documentReady?: boolean;
  /** Current dirty state used to advertise viewing/editing Presence. */
  openDirty?: boolean;
  /** Keep Realtime invalidations muted until the first guarded sync completes. */
  initialGuarded?: boolean;
  /** Called after a remote snapshot was hydrated and applied to the editor. */
  onRemoteDocumentApplied?: (document: CanvasDocument) => void;
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

function isLaterTimestamp(next: string, previous?: string | null): boolean {
  const nextMs = Date.parse(next);
  if (Number.isNaN(nextMs)) return false;
  if (!previous) return true;
  const previousMs = Date.parse(previous);
  return Number.isNaN(previousMs) || nextMs > previousMs;
}

/** Cloud sync: focus-triggered reconciliation plus targeted Realtime pulls. */
export function useCanvasSync({
  historyDocRef,
  openDirtyRef,
  refreshList,
  replaceDocument,
  onConflict,
  active = true,
  guarded = false,
  documentId,
  documentReady = true,
  openDirty,
  initialGuarded = false,
  onRemoteDocumentApplied,
}: UseCanvasSyncOptions) {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [realtimeStatus, setRealtimeStatus] = useState<CanvasRealtimeStatus>('idle');
  const [collaborators, setCollaborators] = useState<CanvasCollaborator[]>([]);

  const currentDocumentId = documentId ?? historyDocRef.current.id;
  const currentOpenDirty = openDirty ?? openDirtyRef.current;
  const currentDocumentIdRef = useRef(currentDocumentId);
  currentDocumentIdRef.current = currentDocumentId;
  const initialGuardedRef = useRef(initialGuarded);
  const onConflictRef = useRef(onConflict);
  onConflictRef.current = onConflict;
  const replaceDocumentRef = useRef(replaceDocument);
  replaceDocumentRef.current = replaceDocument;
  const onRemoteDocumentAppliedRef = useRef(onRemoteDocumentApplied);
  onRemoteDocumentAppliedRef.current = onRemoteDocumentApplied;
  const realtimeSubscriptionRef = useRef<CanvasRealtimeSubscription | null>(null);
  const presenceIdentityRef = useRef<CanvasPresence | null>(null);
  const realtimePullTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRealtimeTimestampRef = useRef<string | null>(null);
  const realtimePullInFlightRef = useRef(false);
  const realtimeEnabledRef = useRef(false);

  const runCloudSync = useCallback(async (guardedOverride?: boolean) => {
    setSyncing(true);
    setSyncStatus('syncing');
    const effectiveGuarded = guardedOverride ?? guarded;
    if (effectiveGuarded) initialGuardedRef.current = true;
    let waitingForGuardedFollowUp = false;

    try {
      const openId = historyDocRef.current.id;
      const openDirtyAtStart = openDirtyRef.current;

      const applySyncResult = async (result: SyncResult) => {
        if (result.skipped) {
          setSyncStatus(result.reason === 'error' ? 'error' : 'idle');
          setSyncing(false);
          return;
        }

        try {
          await refreshList();
          if (result.conflict && onConflictRef.current) {
            onConflictRef.current(result.conflict);
            setSyncStatus('synced');
            return;
          }
          if (result.reloadOpenId && result.reloadOpenId === openId) {
            if (!openDirtyRef.current) {
              const got = await api.canvasGet(result.reloadOpenId);
              const doc = normalizeDocument(got.document as CanvasDocument);
              const hydrated = await hydrateDocumentImages(doc);
              replaceDocumentRef.current(hydrated);
              onRemoteDocumentAppliedRef.current?.(hydrated);
            } else if (onConflictRef.current) {
              const got = await api.canvasGet(result.reloadOpenId);
              const remoteDoc = normalizeDocument(got.document as CanvasDocument);
              const localDoc = historyDocRef.current;
              onConflictRef.current({
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
        openDirty: openDirtyAtStart,
        guarded: effectiveGuarded,
        followUp: (retryResult) => {
          if (effectiveGuarded) initialGuardedRef.current = true;
          void applySyncResult(retryResult).finally(() => {
            if (effectiveGuarded) initialGuardedRef.current = false;
          });
        },
      });
      if (!result.skipped) {
        await applySyncResult(result);
      } else if (result.reason === 'sync-in-flight') {
        waitingForGuardedFollowUp = effectiveGuarded;
      } else {
        setSyncStatus('idle');
        setSyncing(false);
      }
    } catch {
      setSyncStatus('error');
      setSyncing(false);
    } finally {
      if (effectiveGuarded && !waitingForGuardedFollowUp) initialGuardedRef.current = false;
    }
  }, [guarded, historyDocRef, openDirtyRef, refreshList]);

  const drainRealtimePull = useCallback(async () => {
    if (realtimePullInFlightRef.current) return;
    const pendingTimestamp = pendingRealtimeTimestampRef.current;
    if (!pendingTimestamp) return;
    pendingRealtimeTimestampRef.current = null;
    realtimePullInFlightRef.current = true;

    try {
      const { pullCanvasDocument } = await import('../sync/canvasCloudSync');
      const targetDocumentId = currentDocumentIdRef.current;
      const result = await pullCanvasDocument(targetDocumentId, {
        localDocument: historyDocRef.current,
        openDirty: openDirtyRef.current,
      });

      if (result.kind === 'applied') {
        const hydrated = await hydrateDocumentImages(result.document);
        if (!realtimeEnabledRef.current || currentDocumentIdRef.current !== targetDocumentId) return;
        if (openDirtyRef.current) {
          const localDoc = historyDocRef.current;
          onConflictRef.current?.({
            localDoc,
            remoteDoc: hydrated,
            remoteUpdatedAt: result.remoteUpdatedAt,
            localUpdatedAt: localDoc.updatedAt || '',
          });
        } else {
          replaceDocumentRef.current(hydrated);
          onRemoteDocumentAppliedRef.current?.(hydrated);
        }
      } else if (result.kind === 'conflict' || result.kind === 'deleted') {
        onConflictRef.current?.(result.conflict);
      }
    } catch {
      if (realtimeEnabledRef.current) setRealtimeStatus('error');
    } finally {
      realtimePullInFlightRef.current = false;
      if (pendingRealtimeTimestampRef.current && realtimePullTimerRef.current === null) {
        realtimePullTimerRef.current = setTimeout(() => {
          realtimePullTimerRef.current = null;
          void drainRealtimePull();
        }, REALTIME_PULL_DEBOUNCE_MS);
      }
    }
  }, [historyDocRef, openDirtyRef]);

  function scheduleRealtimePull(): void {
    if (realtimePullTimerRef.current !== null) return;
    realtimePullTimerRef.current = setTimeout(() => {
      realtimePullTimerRef.current = null;
      void drainRealtimePull();
    }, REALTIME_PULL_DEBOUNCE_MS);
  }

  const handleRealtimeSaved = useCallback((event: CanvasDocumentSavedEvent) => {
    if (initialGuardedRef.current) return;
    if (event.documentId !== currentDocumentIdRef.current) return;
    const pending = pendingRealtimeTimestampRef.current;
    if (!pending || isLaterTimestamp(event.updatedAt, pending)) {
      pendingRealtimeTimestampRef.current = event.updatedAt;
    }
    scheduleRealtimePull();
  }, []);

  useEffect(() => {
    if (!active || !documentReady || !currentDocumentId) {
      realtimeEnabledRef.current = false;
      setCollaborators([]);
      setRealtimeStatus(active ? 'idle' : 'offline');
      return;
    }

    let disposed = false;
    realtimeEnabledRef.current = true;
    setRealtimeStatus('connecting');

    void import('../sync/canvasRealtime')
      .then(async ({ getCanvasPresenceIdentity, subscribeCanvasDocument }) => {
        if (disposed) return;
        const identity = await getCanvasPresenceIdentity();
        if (disposed) return;
        if (!identity) {
          setRealtimeStatus('offline');
          return;
        }

        const initialPresence: CanvasPresence = {
          ...identity,
          mode: openDirtyRef.current ? 'editing' : 'viewing',
        };
        presenceIdentityRef.current = initialPresence;
        const subscription = subscribeCanvasDocument(currentDocumentId, initialPresence, {
          onSaved: handleRealtimeSaved,
          onPresence: (nextCollaborators) => {
            setCollaborators(nextCollaborators.filter((item) => item.userId !== identity.userId));
          },
          onStatus: setRealtimeStatus,
        });
        if (disposed) {
          void subscription?.close();
          return;
        }
        realtimeSubscriptionRef.current = subscription;
      })
      .catch(() => {
        if (!disposed) setRealtimeStatus('error');
      });

    return () => {
      disposed = true;
      realtimeEnabledRef.current = false;
      if (realtimePullTimerRef.current !== null) {
        clearTimeout(realtimePullTimerRef.current);
        realtimePullTimerRef.current = null;
      }
      pendingRealtimeTimestampRef.current = null;
      const subscription = realtimeSubscriptionRef.current;
      realtimeSubscriptionRef.current = null;
      presenceIdentityRef.current = null;
      setCollaborators([]);
      void subscription?.close();
    };
  }, [active, currentDocumentId, documentReady, handleRealtimeSaved, openDirtyRef]);

  useEffect(() => {
    const subscription = realtimeSubscriptionRef.current;
    const identity = presenceIdentityRef.current;
    if (!subscription || !identity) return;

    const mode: CanvasPresence['mode'] = currentOpenDirty ? 'editing' : 'viewing';
    if (identity.mode === mode) return;
    const nextPresence = { ...identity, mode };
    presenceIdentityRef.current = nextPresence;
    void subscription.updatePresence(nextPresence).then((updated) => {
      if (!updated) setRealtimeStatus('error');
    });
  }, [currentOpenDirty]);

  useEffect(() => {
    if (!active) return;
    const onFocus = () => {
      void runCloudSync();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [runCloudSync, active]);

  return {
    runCloudSync,
    syncing,
    syncStatus,
    realtimeStatus,
    collaborators,
  };
}
