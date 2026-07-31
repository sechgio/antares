import { useCallback, useEffect, useRef } from 'react';
import { api } from '../../../api';
import { loadCanvasPresets } from '../presets/loadPresets';
import {
  queueCanvasCloudDelete,
  queueCanvasCloudPush,
} from '../sync/cloudQueue';
import { syncImagesPerPage } from '../ops/pages';
import {
  normalizeDocument,
  type CanvasDocument,
  type CanvasDocumentSummary,
} from '../types';
import type { useCanvasHistory } from './useCanvasHistory';
import {
  hydrateDocumentImages,
  serializeDocumentImages,
} from '../utils/imageBlobStore';

interface UseCanvasDocsOptions {
  history: ReturnType<typeof useCanvasHistory>;
  setDocs: React.Dispatch<React.SetStateAction<CanvasDocumentSummary[]>>;
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  setPageIndex: React.Dispatch<React.SetStateAction<number>>;
  resetViewportPan: () => void;
  flashStatus: (message: string, ms?: number) => void;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  refreshList: () => Promise<void>;
}

/** Document lifecycle: save, duplicate, delete, open, new, rename, apply preset. */
export function useCanvasDocs({
  history,
  setDocs,
  setSelectedIds,
  setPageIndex,
  resetViewportPan,
  flashStatus,
  setStatus,
  refreshList,
}: UseCanvasDocsOptions) {
  const renameBaselineRef = useRef<CanvasDocument | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
  }, []);

  const triggerDebouncedSave = useCallback(
    (doc: CanvasDocument, delayMs = 2000) => {
      cancelPendingSave();
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          const serialDoc = await serializeDocumentImages(doc);
          const res = await api.canvasSave(serialDoc);
          const saved = normalizeDocument(res.document as CanvasDocument);
          queueCanvasCloudPush(saved);
        } catch {
          // silent failure for background autosave
        }
      }, delayMs);
    },
    [cancelPendingSave]
  );

  const onSave = useCallback(async () => {
    cancelPendingSave();
    try {
      const serialDoc = await serializeDocumentImages(history.document);
      const res = await api.canvasSave(serialDoc);
      const saved = normalizeDocument(res.document as CanvasDocument);
      const hydrated = await hydrateDocumentImages(saved);
      history.replaceDocument(hydrated);
      await refreshList();
      flashStatus('Guardado');
      queueCanvasCloudPush(saved);
    } catch (err) {
      flashStatus(err instanceof Error ? err.message : 'Error al guardar');
    }
  }, [cancelPendingSave, history, refreshList, flashStatus]);

  const onDuplicate = useCallback(async () => {
    cancelPendingSave();
    try {
      const serialDoc = await serializeDocumentImages(history.document);
      const savedRes = await api.canvasSave(serialDoc);
      queueCanvasCloudPush(normalizeDocument(savedRes.document as CanvasDocument));
      const res = await api.canvasDuplicate(history.document.id);
      const dup = normalizeDocument(res.document as CanvasDocument);
      const hydrated = await hydrateDocumentImages(dup);
      history.replaceDocument(hydrated);
      setSelectedIds([]);
      setPageIndex(0);
      await refreshList();
      flashStatus('Duplicado');
      queueCanvasCloudPush(dup);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Error al duplicar');
    }
  }, [cancelPendingSave, history, refreshList, flashStatus, setSelectedIds, setPageIndex, setStatus]);

  const onDeleteDoc = useCallback(async () => {
    cancelPendingSave();
    try {
      const deletedId = history.document.id;
      await api.canvasDelete(deletedId);
      queueCanvasCloudDelete(deletedId);
      const list = await api.canvasList();
      if (list.documents.length) {
        const got = await api.canvasGet(list.documents[0].id);
        const doc = normalizeDocument(got.document as CanvasDocument);
        const hydrated = await hydrateDocumentImages(doc);
        history.replaceDocument(hydrated);
        setDocs(list.documents);
      } else {
        const created = await api.canvasCreate('Sin título');
        const doc = normalizeDocument(created.document as CanvasDocument);
        const hydrated = await hydrateDocumentImages(doc);
        history.replaceDocument(hydrated);
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
  }, [cancelPendingSave, history, setDocs, setSelectedIds, setPageIndex, resetViewportPan, flashStatus, setStatus]);

  const onOpenDoc = useCallback(
    async (id: string) => {
      if (!id || id === history.document.id) return;
      cancelPendingSave();
      try {
        const serialDoc = await serializeDocumentImages(history.document);
        const savedRes = await api.canvasSave(serialDoc);
        queueCanvasCloudPush(normalizeDocument(savedRes.document as CanvasDocument));
        const res = await api.canvasGet(id);
        const doc = normalizeDocument(res.document as CanvasDocument);
        const hydrated = await hydrateDocumentImages(doc);
        history.replaceDocument(hydrated);
        setSelectedIds([]);
        setPageIndex(0);
        resetViewportPan();
        await refreshList();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : 'Error al abrir');
      }
    },
    [cancelPendingSave, history, setSelectedIds, setPageIndex, resetViewportPan, refreshList, setStatus],
  );

  const onNew = useCallback(async () => {
    cancelPendingSave();
    try {
      const serialDoc = await serializeDocumentImages(history.document);
      const savedRes = await api.canvasSave(serialDoc);
      queueCanvasCloudPush(normalizeDocument(savedRes.document as CanvasDocument));
      const res = await api.canvasCreate('Sin título');
      const doc = normalizeDocument(res.document as CanvasDocument);
      const hydrated = await hydrateDocumentImages(doc);
      history.replaceDocument(hydrated);
      setSelectedIds([]);
      setPageIndex(0);
      resetViewportPan();
      await refreshList();
      queueCanvasCloudPush(doc);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Error al crear');
    }
  }, [cancelPendingSave, history, setSelectedIds, setPageIndex, resetViewportPan, refreshList, setStatus]);

  const onRename = useCallback(
    (name: string) => {
      const nextDoc = { ...history.document, name };
      history.updateSilent(nextDoc);
      triggerDebouncedSave(nextDoc);
      setDocs((prev) => {
        const next = prev.map((d) => (d.id === history.document.id ? { ...d, name } : d));
        if (next.some((d) => d.id === history.document.id)) return next;
        return [...next, { id: history.document.id, name }];
      });
    },
    [history, setDocs, triggerDebouncedSave],
  );

  const onRenameStart = useCallback(() => {
    renameBaselineRef.current = history.document;
  }, [history.document]);

  const onRenameCommit = useCallback(() => {
    const baseline = renameBaselineRef.current;
    renameBaselineRef.current = null;
    if (!baseline || baseline.name === history.document.name) return;
    history.commitFromBaseline(baseline);
    triggerDebouncedSave(history.document);
  }, [history, triggerDebouncedSave]);

  const onApplyPreset = useCallback(
    (presetId: string) => {
      void loadCanvasPresets().then((presets) => {
        const preset = presets.find((p) => p.id === presetId);
        if (!preset) return;
        const doc = preset.create();
        doc.id = history.document.id;
        doc.name = history.document.name;
        history.setDocument(syncImagesPerPage(doc));
        setSelectedIds([]);
        setPageIndex(0);
        triggerDebouncedSave(doc);
      });
    },
    [history, setSelectedIds, setPageIndex, triggerDebouncedSave],
  );

  useEffect(() => {
    return () => {
      cancelPendingSave();
    };
  }, [cancelPendingSave]);

  return {
    onSave,
    onDuplicate,
    onDeleteDoc,
    onOpenDoc,
    onNew,
    onRename,
    onRenameStart,
    onRenameCommit,
    onApplyPreset,
    triggerDebouncedSave,
  };
}
