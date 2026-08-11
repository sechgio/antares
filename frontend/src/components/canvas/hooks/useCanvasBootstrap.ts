import { useEffect, type MutableRefObject } from 'react';
import { api } from '../../../api';
import { queueCanvasCloudPush } from '../sync/cloudQueue';
import {
  normalizeDocument,
  type CanvasDocument,
  type CanvasDocumentSummary,
} from '../types';
import { hydrateDocumentImages, hydrateHistorySteps } from '../utils/imageBlobStore';
import type { useCanvasHistory } from './useCanvasHistory';

/** Dev-only startup timing helper; no-ops in production. */
function perfMark(label: string) {
  if (import.meta.env.MODE !== 'development') return;
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    performance.mark(label);
  }
  // eslint-disable-next-line no-console
  console.debug(`[canvas-boot] ${label}`, `${performance.now().toFixed(1)}ms`);
}

interface UseCanvasBootstrapOptions {
  /** Replace the open document after list/create/get resolves. */
  replaceDocument: ReturnType<typeof useCanvasHistory>['replaceDocument'];
  /** Restore history stack (past and future) for the loaded document. */
  restoreHistory?: ReturnType<typeof useCanvasHistory>['restoreHistory'];
  /** False while the replaced document awaits its persisted undo/redo history. */
  historyReadyRef: MutableRefObject<boolean>;
  /** Monotonic owner token for overlapping document-history restoration. */
  restoreGenerationRef: MutableRefObject<number>;
  /** Current document identity, updated synchronously by the history hook. */
  currentDocumentRef: ReturnType<typeof useCanvasHistory>['documentRef'];
  /** Current history revision, updated synchronously by the history hook. */
  currentRevisionRef: ReturnType<typeof useCanvasHistory>['revisionRef'];
  /** Set the docs sidebar list. */
  setDocs: React.Dispatch<React.SetStateAction<CanvasDocumentSummary[]>>;
  /** Set the loading veil visibility. */
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  /** One-shot cloud sync after the initial load (guarded never clobbers disk). */
  runCloudSync: (guardedOverride?: boolean) => Promise<void>;
}

/** Mount bootstrap: list docs → open first (or create one) → unblock loading.
 *
 * Runs once on mount; the cancelled flag guards against state updates after
 * unmount. Triggers the initial cloud sync once the open document is ready. */
export function useCanvasBootstrap({
  replaceDocument,
  restoreHistory,
  historyReadyRef,
  restoreGenerationRef,
  currentDocumentRef,
  currentRevisionRef,
  setDocs,
  setLoading,
  runCloudSync,
}: UseCanvasBootstrapOptions) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // Reemplazo del documento bajo una generación monotónica: un reemplazo
      // posterior (open/new concurrente) invalida la restauración de historial
      // de este, que recién marca historyReady cuando su generación sigue viva.
      const replaceGuarded = async (doc: CanvasDocument): Promise<number> => {
        const restoreGeneration = ++restoreGenerationRef.current;
        historyReadyRef.current = false;
        replaceDocument(await hydrateDocumentImages(doc));
        return restoreGeneration;
      };
      try {
        const list = await api.canvasList();
        if (cancelled) return;
        perfMark('list');
        setDocs(list.documents);
        if (list.documents.length > 0) {
          const got = await api.canvasGet(list.documents[0].id);
          if (!cancelled) {
            perfMark('get');
            const doc = normalizeDocument(got.document as CanvasDocument);
            const restoreGeneration = await replaceGuarded(doc);
            const replacementId = currentDocumentRef.current.id;
            const replacementRevision = currentRevisionRef.current;
            perfMark('replace');
            if (restoreHistory) {
              void (async () => {
                try {
                  const hist = await api.canvasGetHistory(doc.id);
                  const isCurrentReplacement =
                    currentDocumentRef.current.id === replacementId &&
                    currentRevisionRef.current === replacementRevision;
                  if (!cancelled && isCurrentReplacement && (hist.past?.length || hist.future?.length)) {
                    const [past, future] = await Promise.all([
                      hydrateHistorySteps(hist.past),
                      hydrateHistorySteps(hist.future),
                    ]);
                    if (
                      !cancelled &&
                      currentDocumentRef.current.id === replacementId &&
                      currentRevisionRef.current === replacementRevision
                    ) {
                      restoreHistory(past, future);
                    }
                  }
                  perfMark('history');
                } catch {
                  // history restore is best-effort
                } finally {
                  if (restoreGenerationRef.current === restoreGeneration) {
                    historyReadyRef.current = true;
                  }
                }
              })();
            } else if (restoreGenerationRef.current === restoreGeneration) {
              historyReadyRef.current = true;
            }
          }
        } else {
          const created = await api.canvasCreate('Sin título');
          if (!cancelled) {
            perfMark('get');
            const doc = normalizeDocument(created.document as CanvasDocument);
            const restoreGeneration = await replaceGuarded(doc);
            if (restoreGenerationRef.current === restoreGeneration) {
              historyReadyRef.current = true;
            }
            setDocs([{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt }]);
            queueCanvasCloudPush(doc);
            perfMark('replace');
          }
        }
      } catch {
        // List/get failed — try creating a real persisted doc; never invent a
        // memory-only phantom that would look syncable but vanish on reload.
        if (!cancelled) {
          try {
            const created = await api.canvasCreate('Sin título');
            if (!cancelled) {
              const doc = normalizeDocument(created.document as CanvasDocument);
              const restoreGeneration = await replaceGuarded(doc);
              if (restoreGenerationRef.current === restoreGeneration) {
                historyReadyRef.current = true;
              }
              setDocs([{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt }]);
              queueCanvasCloudPush(doc);
              perfMark('replace');
            }
          } catch {
            if (!cancelled) {
              setDocs([]);
              perfMark('replace');
            }
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
        perfMark('ready');
      }
      if (!cancelled) {
        // Guarded: this first sync after mount must never clobber documents
        // that already exist on disk (see SyncOptions.guarded).
        void runCloudSync(true).finally(() => perfMark('sync'));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount bootstrap only
  }, []);
}
