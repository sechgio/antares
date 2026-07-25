import { useCallback, useRef } from 'react';
import { api } from '../../../api';
import { CANVAS_PRESETS } from '../presets';
import {
  queueCanvasCloudDelete,
  queueCanvasCloudPush,
} from '../sync/canvasCloudSync';
import { syncImagesPerPage } from '../ops/pages';
import {
  normalizeDocument,
  type CanvasDocument,
  type CanvasDocumentSummary,
} from '../types';
import type { useCanvasHistory } from './useCanvasHistory';

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

/** Document lifecycle: save, duplicate, delete, open, new, rename, apply preset.
 *
 * The "switch document" family (onDuplicate/onDeleteDoc/onOpenDoc/onNew) shares
 * a common spine: save current → fetch/create/delete target → replaceDocument →
 * reset selection+page+viewport → refreshList → cloud push/delete. */
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

  const onSave = useCallback(async () => {
    try {
      const res = await api.canvasSave(history.document);
      const saved = normalizeDocument(res.document as CanvasDocument);
      history.replaceDocument(saved);
      await refreshList();
      flashStatus('Guardado');
      queueCanvasCloudPush(saved);
    } catch (err) {
      flashStatus(err instanceof Error ? err.message : 'Error al guardar');
    }
  }, [history, refreshList, flashStatus]);

  const onDuplicate = useCallback(async () => {
    try {
      const savedRes = await api.canvasSave(history.document);
      queueCanvasCloudPush(normalizeDocument(savedRes.document as CanvasDocument));
      const res = await api.canvasDuplicate(history.document.id);
      const dup = normalizeDocument(res.document as CanvasDocument);
      history.replaceDocument(dup);
      setSelectedIds([]);
      setPageIndex(0);
      await refreshList();
      flashStatus('Duplicado');
      queueCanvasCloudPush(dup);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Error al duplicar');
    }
  }, [history, refreshList, flashStatus, setSelectedIds, setPageIndex, setStatus]);

  const onDeleteDoc = useCallback(async () => {
    try {
      const deletedId = history.document.id;
      await api.canvasDelete(deletedId);
      queueCanvasCloudDelete(deletedId);
      const list = await api.canvasList();
      if (list.documents.length) {
        const got = await api.canvasGet(list.documents[0].id);
        history.replaceDocument(normalizeDocument(got.document as CanvasDocument));
        setDocs(list.documents);
      } else {
        const created = await api.canvasCreate('Sin título');
        const doc = normalizeDocument(created.document as CanvasDocument);
        history.replaceDocument(doc);
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
  }, [history, setDocs, setSelectedIds, setPageIndex, resetViewportPan, flashStatus, setStatus]);

  const onOpenDoc = useCallback(
    async (id: string) => {
      if (!id || id === history.document.id) return;
      try {
        const savedRes = await api.canvasSave(history.document);
        queueCanvasCloudPush(normalizeDocument(savedRes.document as CanvasDocument));
        const res = await api.canvasGet(id);
        history.replaceDocument(normalizeDocument(res.document as CanvasDocument));
        setSelectedIds([]);
        setPageIndex(0);
        resetViewportPan();
        await refreshList();
      } catch (err) {
        setStatus(err instanceof Error ? err.message : 'Error al abrir');
      }
    },
    [history, setSelectedIds, setPageIndex, resetViewportPan, refreshList, setStatus],
  );

  const onNew = useCallback(async () => {
    try {
      const savedRes = await api.canvasSave(history.document);
      queueCanvasCloudPush(normalizeDocument(savedRes.document as CanvasDocument));
      const res = await api.canvasCreate('Sin título');
      const doc = normalizeDocument(res.document as CanvasDocument);
      history.replaceDocument(doc);
      setSelectedIds([]);
      setPageIndex(0);
      resetViewportPan();
      await refreshList();
      queueCanvasCloudPush(doc);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Error al crear');
    }
  }, [history, setSelectedIds, setPageIndex, resetViewportPan, refreshList, setStatus]);

  const onRename = useCallback(
    (name: string) => {
      history.updateSilent({ ...history.document, name });
      setDocs((prev) => {
        const next = prev.map((d) => (d.id === history.document.id ? { ...d, name } : d));
        if (next.some((d) => d.id === history.document.id)) return next;
        return [...next, { id: history.document.id, name }];
      });
    },
    [history, setDocs],
  );

  // Capture the document snapshot at focus time so the rename can be committed
  // to history as a single undoable entry on blur/Enter (instead of one entry
  // per keystroke). Mirrors the gesture pattern used elsewhere in the canvas.
  const onRenameStart = useCallback(() => {
    renameBaselineRef.current = history.document;
  }, [history.document]);

  const onRenameCommit = useCallback(() => {
    const baseline = renameBaselineRef.current;
    renameBaselineRef.current = null;
    if (!baseline || baseline.name === history.document.name) return;
    history.commitFromBaseline(baseline);
  }, [history]);

  const onApplyPreset = useCallback(
    (presetId: string) => {
      const preset = CANVAS_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      const doc = preset.create();
      doc.id = history.document.id;
      doc.name = history.document.name;
      history.setDocument(syncImagesPerPage(doc));
      setSelectedIds([]);
      setPageIndex(0);
    },
    [history, setSelectedIds, setPageIndex],
  );

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
  };
}
