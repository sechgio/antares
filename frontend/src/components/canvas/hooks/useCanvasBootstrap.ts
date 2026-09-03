import { useEffect, type MutableRefObject } from 'react';
import { api } from '../../../api';
import { queueCanvasCloudPush } from '../sync/cloudQueue';
import {
  normalizeDocument,
  type CanvasDocument,
  type CanvasDocumentSummary,
} from '../types';
import { hydrateDocumentImages, hydrateHistorySteps } from '../utils/imageBlobStore';
import type { CanvasHistoryHandle } from './useCanvasHistory';

function perfMark(label: string) {
  if (import.meta.env.MODE !== 'development') return;
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    performance.mark(label);
  }
  // eslint-disable-next-line no-console
  console.debug(`[canvas-boot] ${label}`, `${performance.now().toFixed(1)}ms`);
}

interface UseCanvasBootstrapOptions {
  replaceDocument: CanvasHistoryHandle['replaceDocument'];
  restoreHistory?: CanvasHistoryHandle['restoreHistory'];
  historyReadyRef: MutableRefObject<boolean>;
  restoreGenerationRef: MutableRefObject<number>;
  currentDocumentRef: CanvasHistoryHandle['documentRef'];
  currentRevisionRef: CanvasHistoryHandle['revisionRef'];
  setDocs: React.Dispatch<React.SetStateAction<CanvasDocumentSummary[]>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  runCloudSync: (guardedOverride?: boolean) => Promise<void>;
}

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

        void runCloudSync(true).finally(() => perfMark('sync'));
      }
    })();
    return () => {
      cancelled = true;
    };

  }, []);
}
