import { useCallback, useEffect, useRef, useState } from 'react';
import { cloneDocument } from '../ops/document';
import {
  canFocusFieldBinding,
  canInlineEditLayer,
  growTextLayerToContent,
} from '../ops/inlineEdit';
import type { CanvasContextMenuState } from '../editor/ContextMenu';
import type { CanvasDocument, CanvasTool } from '../types';
import type { CanvasHistoryHandle } from './useCanvasHistory';

interface UseInlineEditOptions {
  history: CanvasHistoryHandle;
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  setTool: React.Dispatch<React.SetStateAction<CanvasTool>>;
  setContextMenu: (state: CanvasContextMenuState | null) => void;
}

export function useInlineEdit({
  history,
  setSelectedIds,
  setTool,
  setContextMenu,
}: UseInlineEditOptions) {
  const { commitFromBaseline, documentRef, updateSilent } = history;
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingSelectAll, setEditingSelectAll] = useState(true);
  const editBaselineRef = useRef<CanvasDocument | null>(null);
  const previousDocumentIdRef = useRef(history.document.id);

  useEffect(() => {
    const documentId = history.document.id;
    if (previousDocumentIdRef.current === documentId) return;

    previousDocumentIdRef.current = documentId;
    editBaselineRef.current = null;
    setEditingLayerId(null);
    setEditingSelectAll(true);
  }, [history.document.id]);

  const commitInlineEdit = useCallback(() => {
    if (!editingLayerId) return;
    const baseline = editBaselineRef.current;
    const layer = documentRef.current.layers.find((l) => l.id === editingLayerId);
    if (baseline && layer && layer.value !== baseline.layers.find((l) => l.id === editingLayerId)?.value) {
      commitFromBaseline(baseline);
    }
    editBaselineRef.current = null;
    setEditingLayerId(null);
  }, [commitFromBaseline, documentRef, editingLayerId]);

  const startInlineEdit = useCallback(
    (id: string, opts?: { seed?: string }) => {
      const doc = documentRef.current;
      const layer = doc.layers.find((l) => l.id === id);
      if (canFocusFieldBinding(layer)) {
        if (editingLayerId) commitInlineEdit();
        setSelectedIds([id]);
        setTool('select');
        setContextMenu(null);
        requestAnimationFrame(() => {
          const input = document.querySelector<HTMLInputElement>('[data-testid="canvas-field-key-input"]');
          input?.focus();
          input?.select();
        });
        return;
      }
      if (!canInlineEditLayer(layer)) return;
      const seed = opts?.seed;
      editBaselineRef.current = cloneDocument(doc);
      setSelectedIds([id]);
      setTool('select');
      setEditingSelectAll(seed == null);
      if (seed != null) {
        updateSilent({
          ...doc,
          layers: doc.layers.map((l) => (l.id === id ? { ...l, value: seed } : l)),
        });
      }
      setEditingLayerId(id);
      setContextMenu(null);
    },
    [commitInlineEdit, documentRef, editingLayerId, setContextMenu, setSelectedIds, setTool, updateSilent],
  );

  const onInlineEditValue = useCallback(
    (id: string, value: string, contentHeightPx?: number, zoom?: number) => {
      const doc = documentRef.current;
      updateSilent({
        ...doc,
        layers: doc.layers.map((l) => {
          if (l.id !== id) return l;
          const next = { ...l, value };

          return contentHeightPx != null && zoom != null
            ? growTextLayerToContent(next, contentHeightPx, zoom)
            : next;
        }),
      });
    },
    [documentRef, updateSilent],
  );

  const onFitTextHeight = useCallback(
    (id: string, contentHeightPx: number, zoom: number) => {
      const doc = documentRef.current;
      const layer = doc.layers.find((l) => l.id === id);
      if (!layer) return;
      const next = growTextLayerToContent(layer, contentHeightPx, zoom);
      if (next === layer) return;
      updateSilent({
        ...doc,
        layers: doc.layers.map((l) => (l.id === id ? next : l)),
      });
    },
    [documentRef, updateSilent],
  );

  const beginEditWithBaseline = useCallback(
    (baseline: CanvasDocument, id: string) => {
      editBaselineRef.current = baseline;
      setEditingSelectAll(true);
      setEditingLayerId(id);
    },
    [],
  );

  return {
    editingLayerId,
    editingSelectAll,
    commitInlineEdit,
    startInlineEdit,
    onInlineEditValue,
    onFitTextHeight,
    beginEditWithBaseline,
  };
}
