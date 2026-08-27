import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { api } from '../../../api';
import { queueCanvasCloudDelete, queueCanvasCloudPush } from '../sync/cloudQueue';
import { isNewer } from '../sync/syncCompare';
import { normalizeDocument, type CanvasDocument, type CanvasDocumentSummary } from '../types';
import {
  applySavedDocumentKeepingImages,
  hydrateDocumentImages,
  hydrateHistorySteps,
  serializeDocumentImages,
  serializeHistorySteps,
} from '../utils/imageBlobStore';
import type { useCanvasHistory } from './useCanvasHistory';

interface DocumentSnapshot {
  documentId: string;
  revision: number;
}

export interface UseDocumentLifecycleOptions {
  history: ReturnType<typeof useCanvasHistory>;
  refreshList: () => Promise<void>;
  flashStatus: (message: string, ms?: number) => void;
  setStatus: (message: string | null) => void;
  setSelectedIds: (ids: string[]) => void;
  setPageIndex: (index: number) => void;
  setDocs: (docs: CanvasDocumentSummary[]) => void;
  resetViewportPan: () => void;
  /** Remote timestamp dismissed by a "keep local" conflict decision (shared with the conflict bar). */
  dismissedRemoteAtRef: MutableRefObject<string | null>;
  /** False while a replacement document awaits its persisted undo/redo history. */
  historyReadyRef: MutableRefObject<boolean>;
  /** Monotonic owner token for overlapping document-history restoration. */
  restoreGenerationRef: MutableRefObject<number>;
}

/**
 * Single owner of the document-switch lifecycle: save → persist history →
 * cloud push → create/get → hydrate → replace. Open/new/duplicate/delete and
 * the explicit save all funnel through here so the ordering cannot drift.
 */
export function useDocumentLifecycle({
  history,
  refreshList,
  flashStatus,
  setStatus,
  setSelectedIds,
  setPageIndex,
  setDocs,
  resetViewportPan,
  dismissedRemoteAtRef,
  historyReadyRef,
  restoreGenerationRef,
}: UseDocumentLifecycleOptions) {
  const captureCurrentSnapshot = useCallback(
    (): DocumentSnapshot => ({
      documentId: history.documentRef.current.id,
      revision: history.revisionRef.current,
    }),
    [history.documentRef, history.revisionRef],
  );
  const isCurrentSnapshot = useCallback(
    ({ documentId, revision }: DocumentSnapshot) =>
      history.documentRef.current.id === documentId && history.revisionRef.current === revision,
    [history.documentRef, history.revisionRef],
  );

  /** Serialize save-then-switch so concurrent open/new/duplicate/delete cannot interleave. */
  const docSwitchLockRef = useRef(false);
  const withDocSwitchLock = useCallback(async (fn: () => Promise<void>) => {
    if (docSwitchLockRef.current) return;
    docSwitchLockRef.current = true;
    try {
      await fn();
    } finally {
      docSwitchLockRef.current = false;
    }
  }, []);

  const lastSavedHistorySigRef = useRef('');

  const markHistoryPersisted = useCallback(
    (docId: string) => {
      // El efecto debounced (sig por revision) no debe re-persistir en disco
      // lo que saveCurrentDocument/onSave ya escribieron al guardar.
      lastSavedHistorySigRef.current = `${docId}:${history.revisionRef.current}`;
    },
    [history.revisionRef],
  );

  const persistHistoryStacks = useCallback(
    async (docId: string, past: typeof history.past, future: typeof history.future) => {
      const [serializedPast, serializedFuture] = await Promise.all([
        serializeHistorySteps(past),
        serializeHistorySteps(future),
      ]);
      await api.canvasSaveHistory(docId, serializedPast, serializedFuture);
    },
    [],
  );

  const warnHistoryPersistFailed = useCallback((err: unknown) => {
    console.warn(
      '[canvas] No se pudo persistir historial:',
      err instanceof Error ? err.message : err,
    );
  }, []);

  const hydratePersistedHistory = useCallback(
    async (past: typeof history.past, future: typeof history.future) =>
      Promise.all([hydrateHistorySteps(past), hydrateHistorySteps(future)]),
    [],
  );

  /**
   * Save the current doc (disk + history + cloud push). Shared by onSave and
   * every switch op: returns the pre-save snapshot pieces the caller needs
   * (saved doc for the editor, captured stacks to restore, current flag).
   */
  const saveCurrentDocument = useCallback(async (): Promise<{
    current: boolean;
    saved: CanvasDocument;
    histPersistOk: boolean;
    document: CanvasDocument;
    past: typeof history.past;
    future: typeof history.future;
  }> => {
    const document = history.documentRef.current;
    const past = history.past;
    const future = history.future;
    const snapshot = captureCurrentSnapshot();
    const serialized = await serializeDocumentImages(document);
    const [savedRes, histPersistOk] = await Promise.all([
      api.canvasSave(serialized),
      persistHistoryStacks(document.id, past, future)
        .then(() => true)
        .catch((err) => {
          warnHistoryPersistFailed(err);
          return false;
        }),
    ]);
    const saved = normalizeDocument(savedRes.document as CanvasDocument);
    const current = isCurrentSnapshot(snapshot);
    if (current) {
      queueCanvasCloudPush(saved);
      if (histPersistOk) markHistoryPersisted(document.id);
    }
    return { current, saved, histPersistOk, document, past, future };
  }, [captureCurrentSnapshot, history.documentRef, history.future, history.past, isCurrentSnapshot, markHistoryPersisted, persistHistoryStacks, warnHistoryPersistFailed]);

  /** Open a document and restore its persisted history (best-effort). */
  const openDocumentWithHistory = useCallback(
    async (id: string, source?: DocumentSnapshot): Promise<boolean> => {
      const [getRes, hist] = await Promise.all([api.canvasGet(id), api.canvasGetHistory(id)]);
      const doc = normalizeDocument(getRes.document as CanvasDocument);
      const hydrated = await hydrateDocumentImages(doc);
      if (source && !isCurrentSnapshot(source)) return false;
      const restoreGeneration = ++restoreGenerationRef.current;
      historyReadyRef.current = false;
      history.replaceDocument(hydrated);
      const target = captureCurrentSnapshot();
      try {
        if (hist.past?.length || hist.future?.length) {
          const [past, future] = await hydratePersistedHistory(hist.past, hist.future);
          if (
            restoreGenerationRef.current === restoreGeneration &&
            isCurrentSnapshot(target)
          ) {
            history.restoreHistory(past, future);
          }
        }
      } catch (err) {
        console.warn(
          '[canvas] No se pudo restaurar historial:',
          err instanceof Error ? err.message : err,
        );
      } finally {
        if (restoreGenerationRef.current === restoreGeneration) {
          historyReadyRef.current = true;
        }
      }
      return true;
    },
    [captureCurrentSnapshot, history, historyReadyRef, hydratePersistedHistory, isCurrentSnapshot, restoreGenerationRef],
  );

  // Debounced history persistence on disk (~500ms after stack mutations)
  useEffect(() => {
    if (!historyReadyRef.current) return;
    const docId = history.document.id;
    if (!docId) return;
    const sig = `${docId}:${history.revision}`;
    if (lastSavedHistorySigRef.current === sig) return;
    const timer = setTimeout(() => {
      lastSavedHistorySigRef.current = sig;
      persistHistoryStacks(docId, history.past, history.future).catch(warnHistoryPersistFailed);
    }, 500);
    return () => clearTimeout(timer);
  }, [
    history.document.id,
    history.past,
    history.future,
    history.revision,
    historyReadyRef,
    persistHistoryStacks,
    warnHistoryPersistFailed,
  ]);

  const onSave = useCallback(
    async (opts?: { silent?: boolean }): Promise<boolean> => {
      try {
        const { current, saved, histPersistOk, document, past, future } = await saveCurrentDocument();
        if (!current) return false;

        // Keep blob:/blobId in the editor; `saved` (data URLs) goes to cloud only.
        const forEditor = applySavedDocumentKeepingImages(document, saved);
        history.replaceDocument(forEditor);
        history.restoreHistory(past, future);
        history.markSaved();
        // Don't drop keep-local dismissal until local timestamp has beaten the remote we dismissed.
        const dismissed = dismissedRemoteAtRef.current;
        if (!dismissed || (saved.updatedAt && isNewer(saved.updatedAt, dismissed))) {
          dismissedRemoteAtRef.current = null;
        }
        await refreshList();
        if (histPersistOk) markHistoryPersisted(document.id);
        if (!opts?.silent) flashStatus('Guardado');
        return true;
      } catch (err) {
        if (!opts?.silent) flashStatus(err instanceof Error ? err.message : 'Error al guardar');
        return false;
      }
    },
    [applySavedDocumentKeepingImages, dismissedRemoteAtRef, flashStatus, history, isNewer, markHistoryPersisted, refreshList, saveCurrentDocument],
  );

  const onOpenDoc = useCallback(
    async (id: string) => {
      if (!id || id === history.document.id) return;
      await withDocSwitchLock(async () => {
        try {
          if (!(await saveCurrentDocument()).current) {
            setStatus('Se hicieron cambios mientras se guardaba. Repite la acción para cambiar de documento.');
            return;
          }
          const source = captureCurrentSnapshot();
          if (!(await openDocumentWithHistory(id, source))) {
            setStatus('Se hicieron cambios mientras se cargaba. Repite la acción para cambiar de documento.');
            return;
          }
          setSelectedIds([]);
          setPageIndex(0);
          resetViewportPan();
          await refreshList();
        } catch (err) {
          setStatus(err instanceof Error ? err.message : 'Error al abrir');
        }
      });
    },
    [
      history,
      withDocSwitchLock,
      captureCurrentSnapshot,
      saveCurrentDocument,
      openDocumentWithHistory,
      refreshList,
      setStatus,
      setSelectedIds,
      setPageIndex,
      resetViewportPan,
    ],
  );

  const onNew = useCallback(
    async () => {
      await withDocSwitchLock(async () => {
        try {
          if (!(await saveCurrentDocument()).current) {
            setStatus('Se hicieron cambios mientras se guardaba. Repite la acción para crear un documento.');
            return;
          }
          const source = captureCurrentSnapshot();
          const res = await api.canvasCreate('Sin título');
          const doc = normalizeDocument(res.document as CanvasDocument);
          const hydrated = await hydrateDocumentImages(doc);
          if (!isCurrentSnapshot(source)) {
            setStatus('Se hicieron cambios mientras se creaba. Repite la acción para crear un documento.');
            return;
          }
          history.replaceDocument(hydrated);
          setSelectedIds([]);
          setPageIndex(0);
          resetViewportPan();
          await refreshList();
          queueCanvasCloudPush(doc);
        } catch (err) {
          setStatus(err instanceof Error ? err.message : 'Error al crear');
        }
      });
    },
    [
      history,
      withDocSwitchLock,
      captureCurrentSnapshot,
      isCurrentSnapshot,
      saveCurrentDocument,
      refreshList,
      setStatus,
      setSelectedIds,
      setPageIndex,
      resetViewportPan,
    ],
  );

  const onDuplicate = useCallback(
    async () => {
      await withDocSwitchLock(async () => {
        try {
          if (!(await saveCurrentDocument()).current) {
            setStatus('Se hicieron cambios mientras se guardaba. Repite la acción para duplicar el documento.');
            return;
          }
          const source = captureCurrentSnapshot();
          const res = await api.canvasDuplicate(source.documentId);
          const dup = normalizeDocument(res.document as CanvasDocument);
          const hydrated = await hydrateDocumentImages(dup);
          if (!isCurrentSnapshot(source)) {
            setStatus('Se hicieron cambios mientras se duplicaba. Repite la acción para duplicar el documento.');
            return;
          }
          history.replaceDocument(hydrated);
          setSelectedIds([]);
          setPageIndex(0);
          await refreshList();
          flashStatus('Duplicado');
          queueCanvasCloudPush(dup);
        } catch (err) {
          setStatus(err instanceof Error ? err.message : 'Error al duplicar');
        }
      });
    },
    [
      history,
      withDocSwitchLock,
      captureCurrentSnapshot,
      isCurrentSnapshot,
      saveCurrentDocument,
      refreshList,
      flashStatus,
      setStatus,
      setSelectedIds,
      setPageIndex,
    ],
  );

  const onDeleteDoc = useCallback(
    async () => {
      await withDocSwitchLock(async () => {
        try {
          const deletedId = history.document.id;
          await api.canvasDelete(deletedId);
          queueCanvasCloudDelete(deletedId);
          const list = await api.canvasList();
          if (list.documents.length) {
            await openDocumentWithHistory(list.documents[0].id);
            setDocs(list.documents);
          } else {
            const created = await api.canvasCreate('Sin título');
            const doc = normalizeDocument(created.document as CanvasDocument);
            history.replaceDocument(await hydrateDocumentImages(doc));
            setDocs([{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt }]);
            queueCanvasCloudPush(doc);
          }
          setSelectedIds([]);
          setPageIndex(0);
          resetViewportPan();
          flashStatus('Documento eliminado');
        } catch (err) {
          setStatus(err instanceof Error ? err.message : 'Error al eliminar');
        }
      });
    },
    [
      history,
      withDocSwitchLock,
      openDocumentWithHistory,
      refreshList,
      flashStatus,
      setStatus,
      setSelectedIds,
      setPageIndex,
      setDocs,
      resetViewportPan,
    ],
  );

  return { onSave, onOpenDoc, onNew, onDuplicate, onDeleteDoc };
}
