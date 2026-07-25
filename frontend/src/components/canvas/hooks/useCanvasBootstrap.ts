import { useEffect } from 'react';
import { api } from '../../../api';
import { queueCanvasCloudPush } from '../sync/canvasCloudSync';
import {
  createEmptyDocument,
  normalizeDocument,
  type CanvasDocument,
  type CanvasDocumentSummary,
} from '../types';
import type { useCanvasHistory } from './useCanvasHistory';

interface UseCanvasBootstrapOptions {
  /** Replace the open document after list/create/get resolves. */
  replaceDocument: ReturnType<typeof useCanvasHistory>['replaceDocument'];
  /** Set the docs sidebar list. */
  setDocs: React.Dispatch<React.SetStateAction<CanvasDocumentSummary[]>>;
  /** Set the loading veil visibility. */
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  /** One-shot cloud sync after the initial load. */
  runCloudSync: () => Promise<void>;
}

/** Mount bootstrap: list docs → open first (or create one) → unblock loading.
 *
 * Runs once on mount; the cancelled flag guards against state updates after
 * unmount. Triggers the initial cloud sync once the open document is ready. */
export function useCanvasBootstrap({
  replaceDocument,
  setDocs,
  setLoading,
  runCloudSync,
}: UseCanvasBootstrapOptions) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await api.canvasList();
        if (cancelled) return;
        setDocs(list.documents);
        if (list.documents.length > 0) {
          const got = await api.canvasGet(list.documents[0].id);
          if (!cancelled) replaceDocument(normalizeDocument(got.document as CanvasDocument));
        } else {
          const created = await api.canvasCreate('Sin título');
          if (!cancelled) {
            const doc = normalizeDocument(created.document as CanvasDocument);
            replaceDocument(doc);
            setDocs([{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt }]);
            queueCanvasCloudPush(doc);
          }
        }
      } catch {
        if (!cancelled) replaceDocument(createEmptyDocument());
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!cancelled) void runCloudSync();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount bootstrap only
  }, []);
}
