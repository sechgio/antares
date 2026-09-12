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

function bootLog(level: 'debug' | 'warn', ...args: unknown[]) {
  console[level](...args);
}

function perfMark(label: string) {
  if (import.meta.env.MODE !== 'development') return;
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
    performance.mark(label);
  }
  bootLog('debug', `[canvas-boot] ${label}`, `${performance.now().toFixed(1)}ms`);
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
    let syncIdleId: number | undefined;
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      setLoading(true);

      const replaceGuarded = async (doc: CanvasDocument): Promise<number> => {
        const restoreGeneration = ++restoreGenerationRef.current;
        historyReadyRef.current = false;
        replaceDocument(await hydrateDocumentImages(doc));
        return restoreGeneration;
      };
      try {
        const boot = await api.canvasBootstrap();
        if (cancelled) return;
        perfMark('list');
        setDocs(boot.documents);
        if (boot.document) {
          perfMark('get');
          const doc = normalizeDocument(boot.document as CanvasDocument);
          const histPromise = restoreHistory
            ? api.canvasGetHistory(doc.id).catch((err) => {
                bootLog('warn', '[canvas-boot] no se pudo leer el historial', err);
                return null;
              })
            : null;
          if (!cancelled) {
            const restoreGeneration = await replaceGuarded(doc);
            const replacementId = currentDocumentRef.current.id;
            const replacementRevision = currentRevisionRef.current;
            perfMark('replace');
            if (restoreHistory && histPromise) {
              void (async () => {
                try {
                  const hist = await histPromise;
                  const isCurrentReplacement =
                    currentDocumentRef.current.id === replacementId &&
                    currentRevisionRef.current === replacementRevision;
                  if (!cancelled && isCurrentReplacement && hist && (hist.past?.length || hist.future?.length)) {
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
                } catch (err) {
                  bootLog('warn', '[canvas-boot] no se pudo restaurar el historial', err);
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
            void Promise.resolve(queueCanvasCloudPush(doc)).catch((err) => {
              bootLog('warn', '[canvas-boot] no se pudo sincronizar el documento nuevo', err);
            });
            perfMark('replace');
          }
        }
      } catch (err) {
        bootLog('warn', '[canvas-boot] bootstrap falló; se crea un documento vacío', err);
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
              void Promise.resolve(queueCanvasCloudPush(doc)).catch((err) => {
                bootLog('warn', '[canvas-boot] no se pudo sincronizar el documento de respaldo', err);
              });
              perfMark('replace');
            }
          } catch (createErr) {
            bootLog('warn', '[canvas-boot] no se pudo crear el documento de respaldo', createErr);
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
        const kickoffSync = () => {
          if (cancelled) return;
          void runCloudSync(true).finally(() => perfMark('sync'));
        };
        const ric = window.requestIdleCallback?.bind(window);
        if (ric) {
          syncIdleId = ric(kickoffSync, { timeout: 2000 });
        } else {
          syncTimer = setTimeout(kickoffSync, 0);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (syncIdleId !== undefined) window.cancelIdleCallback?.(syncIdleId);
      if (syncTimer !== undefined) clearTimeout(syncTimer);
    };

  }, []);
}
