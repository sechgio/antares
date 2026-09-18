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
import { reportFrontendEvent } from '../../../utils/observability';
import { TimerScheduler } from '../sync/timerScheduler';

export type SyncConflictChoice = 'use-remote' | 'keep-local';

const REALTIME_PULL_DEBOUNCE_MS = 350;
const REALTIME_PULL_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

export interface UseCanvasSyncOptions {
  historyDocRef: React.MutableRefObject<CanvasDocument>;
  // Fuente única de "doc abierto dirty": deriva de hasUnsavedEdits + baselines
  // en el momento de la lectura (no un espejo manual).
  isOpenDirty: () => boolean;
  refreshList: () => Promise<void>;
  replaceDocument: CanvasHistoryHandle['replaceDocument'];
  onConflict?: (conflict: SyncConflict) => void;
  active?: boolean;
  guarded?: boolean;
  documentId?: string;
  documentReady?: boolean;
  initialGuarded?: boolean;
  onRemoteDocumentApplied?: (document: CanvasDocument) => void;
}

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

export function useCanvasSync({
  historyDocRef,
  isOpenDirty,
  refreshList,
  replaceDocument,
  onConflict,
  active = true,
  guarded = false,
  documentId,
  documentReady = true,
  initialGuarded = false,
  onRemoteDocumentApplied,
}: UseCanvasSyncOptions) {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [realtimeStatus, setRealtimeStatus] = useState<CanvasRealtimeStatus>('idle');
  const [collaborators, setCollaborators] = useState<CanvasCollaborator[]>([]);

  const currentDocumentId = documentId ?? historyDocRef.current.id;
  // Ref-wrapper: el getter puede ser una lambda inline (identidad inestable);
  // leerlo desde el ref mantiene estables las deps de effects/callbacks.
  const isOpenDirtyRef = useRef(isOpenDirty);
  isOpenDirtyRef.current = isOpenDirty;
  const currentOpenDirty = isOpenDirtyRef.current();
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
  const pendingRealtimeTimestampRef = useRef<string | null>(null);
  const pendingRealtimePullRef = useRef(false);
  const realtimePullInFlightRef = useRef(false);
  const realtimePullInFlightGenerationRef = useRef<number | null>(null);
  const [pullScheduler] = useState(
    () => new TimerScheduler(() => { void drainRealtimePull(); }),
  );
  const realtimeEnabledRef = useRef(false);
  const realtimeGenerationRef = useRef(0);
  const realtimeLiveRef = useRef(false);
  const realtimeEverLiveRef = useRef(false);

  const runCloudSync = useCallback(async (guardedOverride?: boolean) => {
    setSyncing(true);
    setSyncStatus('syncing');
    const effectiveGuarded = guardedOverride ?? guarded;
    if (effectiveGuarded) initialGuardedRef.current = true;
    let waitingForGuardedFollowUp = false;

    try {
      const openId = historyDocRef.current.id;
      const openDirtyAtStart = isOpenDirtyRef.current();

      const applySyncResult = async (result: SyncResult) => {
        if (result.skipped) {
          setSyncStatus(result.reason === 'error' ? 'error' : 'idle');
          setSyncing(false);
          return;
        }

        try {
          await refreshList();
          if (result.conflict && onConflictRef.current) {
            // El sync general solo genera conflictos del documento abierto al
            // inicio; si el usuario cambió de documento en vuelo, el conflicto
            // pertenece al doc anterior y no debe alcanzar la UI ni el resolver.
            if (result.conflict.localDoc.id === historyDocRef.current.id) {
              onConflictRef.current(result.conflict);
            }
            setSyncStatus('synced');
            return;
          }
          if (result.reloadOpenId && result.reloadOpenId === historyDocRef.current.id) {
            const got = await api.canvasGet(result.reloadOpenId);
            const doc = normalizeDocument(got.document as CanvasDocument);
            const hydrated = await hydrateDocumentImages(doc, { strict: true });
            // El documento abierto puede cambiar mientras se carga el snapshot remoto.
            if (result.reloadOpenId === historyDocRef.current.id) {
              if (!isOpenDirtyRef.current()) {
                replaceDocumentRef.current(hydrated);
                onRemoteDocumentAppliedRef.current?.(hydrated);
              } else if (onConflictRef.current) {
                const localDoc = historyDocRef.current;
                onConflictRef.current({
                  localDoc,
                  remoteDoc: hydrated,
                  remoteUpdatedAt: hydrated.updatedAt || '',
                  localUpdatedAt: localDoc.updatedAt || '',
                });
              }
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
            if (effectiveGuarded) {
              initialGuardedRef.current = false;
              if (realtimeLiveRef.current) scheduleRealtimePull();
            }
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
      if (effectiveGuarded && !waitingForGuardedFollowUp) {
        initialGuardedRef.current = false;
        if (realtimeLiveRef.current) scheduleRealtimePull();
      }
    }
  }, [guarded, historyDocRef, refreshList]);

  const drainRealtimePull = useCallback(async () => {
    if (realtimePullInFlightRef.current) return;
    const targetDocumentId = currentDocumentIdRef.current;
    const pullGeneration = realtimeGenerationRef.current;
    const pendingTimestamp = pendingRealtimeTimestampRef.current;
    if (!realtimeEnabledRef.current || !targetDocumentId || (
      !pendingTimestamp && !pendingRealtimePullRef.current
    )) return;
    pendingRealtimeTimestampRef.current = null;
    pendingRealtimePullRef.current = false;
    realtimePullInFlightRef.current = true;
    realtimePullInFlightGenerationRef.current = pullGeneration;
    const startedAt = Date.now();
    let retryScheduled = false;

    const isCurrentPull = () => (
      realtimeEnabledRef.current
      && currentDocumentIdRef.current === targetDocumentId
      && realtimeGenerationRef.current === pullGeneration
    );

    try {
      const { pullCanvasDocument } = await import('../sync/canvasCloudSync');
      if (!isCurrentPull()) return;
      const result = await pullCanvasDocument(targetDocumentId, {
        localDocument: historyDocRef.current,
        openDirty: isOpenDirtyRef.current(),
      });
      if (!isCurrentPull()) return;

      if (result.kind === 'applied') {
        const hydrated = await hydrateDocumentImages(result.document, { strict: true });
        if (!isCurrentPull()) return;
        if (isOpenDirtyRef.current()) {
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
      pullScheduler.reset();
      if (realtimeLiveRef.current) setRealtimeStatus('live');
      reportFrontendEvent({
        event: 'canvas.realtime',
        level: result.kind === 'unchanged' || result.kind === 'applied' ? 'INFO' : 'WARN',
        outcome: result.kind === 'unchanged' || result.kind === 'applied' ? 'success' : 'partial',
        durationMs: Date.now() - startedAt,
        reason: result.kind,
      });
    } catch {
      if (isCurrentPull()) {
        setRealtimeStatus('error');
        reportFrontendEvent({
          event: 'canvas.realtime',
          level: 'ERROR',
          outcome: 'failed',
          durationMs: Date.now() - startedAt,
          reason: 'pull_failed',
        });
        const retryIndex = pullScheduler.attempts;
        const retryDelay = REALTIME_PULL_RETRY_DELAYS_MS[retryIndex];
        if (retryDelay !== undefined) {
          pullScheduler.attempts = retryIndex + 1;
          pendingRealtimePullRef.current = true;
          if (pendingTimestamp && !pendingRealtimeTimestampRef.current) {
            pendingRealtimeTimestampRef.current = pendingTimestamp;
          }
          scheduleRealtimePull(retryDelay);
          retryScheduled = true;
        } else {
          pullScheduler.reset();
          pendingRealtimePullRef.current = false;
          pendingRealtimeTimestampRef.current = null;
        }
      }
    } finally {
      if (realtimePullInFlightGenerationRef.current === pullGeneration) {
        realtimePullInFlightRef.current = false;
        realtimePullInFlightGenerationRef.current = null;
        if (
          isCurrentPull()
          && (pendingRealtimeTimestampRef.current || pendingRealtimePullRef.current)
          && !retryScheduled
          && !pullScheduler.pending
        ) {
          scheduleRealtimePull();
        }
      }
    }
  }, [historyDocRef]);

  function scheduleRealtimePull(delay = REALTIME_PULL_DEBOUNCE_MS): void {
    pullScheduler.schedule(delay);
  }

  function requestRealtimePull(updatedAt?: string): void {
    const pending = pendingRealtimeTimestampRef.current;
    const isNewInvalidation = !pendingRealtimePullRef.current || (
      !!updatedAt && isLaterTimestamp(updatedAt, pending)
    );
    if (updatedAt && (!pending || isLaterTimestamp(updatedAt, pending))) {
      pendingRealtimeTimestampRef.current = updatedAt;
    }
    pendingRealtimePullRef.current = true;
    if (isNewInvalidation) pullScheduler.reset();
    if (!initialGuardedRef.current) scheduleRealtimePull();
  }

  const handleRealtimeSaved = useCallback((event: CanvasDocumentSavedEvent) => {
    if (initialGuardedRef.current) return;
    if (event.documentId !== currentDocumentIdRef.current) return;
    const pending = pendingRealtimeTimestampRef.current;
    if (pending && !isLaterTimestamp(event.updatedAt, pending)) {
      reportFrontendEvent({
        event: 'canvas.realtime',
        level: 'DEBUG',
        outcome: 'partial',
        reason: 'stale_event',
      });
    }
    requestRealtimePull(event.updatedAt);
  }, []);

  const handleRealtimeStatus = useCallback((status: CanvasRealtimeStatus) => {
    const wasLive = realtimeLiveRef.current;
    const reconnecting = status === 'live' && realtimeEverLiveRef.current && !wasLive;
    if (status === 'live') {
      realtimeLiveRef.current = true;
      realtimeEverLiveRef.current = true;
      requestRealtimePull();
    } else if (status === 'error' || status === 'offline') {
      realtimeLiveRef.current = false;
    }
    setRealtimeStatus(status);
    reportFrontendEvent({
      event: 'canvas.realtime',
      level: status === 'error' ? 'ERROR' : 'INFO',
      status,
      reason: reconnecting ? 'reconnect' : undefined,
    });
  }, []);

  useEffect(() => {
    const generation = ++realtimeGenerationRef.current;
    const cleanupRealtime = () => {
      realtimeGenerationRef.current += 1;
      realtimeEnabledRef.current = false;
      realtimeLiveRef.current = false;
      realtimeEverLiveRef.current = false;
      pullScheduler.cancel();
      pendingRealtimeTimestampRef.current = null;
      pendingRealtimePullRef.current = false;
      realtimePullInFlightRef.current = false;
      realtimePullInFlightGenerationRef.current = null;
      const subscription = realtimeSubscriptionRef.current;
      realtimeSubscriptionRef.current = null;
      presenceIdentityRef.current = null;
      setCollaborators([]);
      void subscription?.close();
    };

    if (!active || !documentReady || !currentDocumentId) {
      realtimeEnabledRef.current = false;
      setCollaborators([]);
      setRealtimeStatus(active ? 'idle' : 'offline');
      return cleanupRealtime;
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
          mode: isOpenDirtyRef.current() ? 'editing' : 'viewing',
        };
        presenceIdentityRef.current = initialPresence;
        const subscription = await subscribeCanvasDocument(currentDocumentId, initialPresence, {
          onSaved: (event) => {
            if (!disposed) handleRealtimeSaved(event);
          },
          onPresence: (nextCollaborators) => {
            if (disposed) return;
            const visibleCollaborators = nextCollaborators.filter((item) => item.userId !== identity.userId);
            setCollaborators(visibleCollaborators);
            reportFrontendEvent({
              event: 'canvas.realtime',
              level: 'INFO',
              count: visibleCollaborators.length,
              reason: 'presence_sync',
            });
          },
          onStatus: (status) => {
            if (!disposed && realtimeGenerationRef.current === generation) handleRealtimeStatus(status);
          },
        });
        if (disposed) {
          void subscription?.close();
          return;
        }
        realtimeSubscriptionRef.current = subscription;
      })
      .catch(() => {
        if (!disposed && realtimeGenerationRef.current === generation) handleRealtimeStatus('error');
      });

    return () => {
      disposed = true;
      cleanupRealtime();
    };
  }, [active, currentDocumentId, documentReady, handleRealtimeSaved, handleRealtimeStatus]);

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
