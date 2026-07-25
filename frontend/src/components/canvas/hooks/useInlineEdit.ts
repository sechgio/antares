import { useCallback, useRef, useState } from 'react';
import { cloneDocument } from '../ops/document';
import {
  canFocusFieldBinding,
  canInlineEditLayer,
  growTextLayerToContent,
} from '../ops/inlineEdit';
import type { CanvasContextMenuState } from '../editor/ContextMenu';
import type { CanvasDocument, CanvasTool } from '../types';
import type { useCanvasHistory } from './useCanvasHistory';

interface UseInlineEditOptions {
  history: ReturnType<typeof useCanvasHistory>;
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  setTool: React.Dispatch<React.SetStateAction<CanvasTool>>;
  setContextMenu: (state: CanvasContextMenuState | null) => void;
}

/** Inline text editing: owns `editingLayerId`, the edit baseline, and the
 * "select-all on first focus" flag. `beginEditWithBaseline` lets `addLayerAt`
 * start editing a freshly created text layer without re-cloning or re-seeding.
 *
 * Commit policy mirrors the gesture pattern: capture the document snapshot on
 * start, `updateSilent` while typing, `commitFromBaseline` on blur/Enter so the
 * whole edit is one undo entry. */
export function useInlineEdit({
  history,
  setSelectedIds,
  setTool,
  setContextMenu,
}: UseInlineEditOptions) {
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingSelectAll, setEditingSelectAll] = useState(true);
  const editBaselineRef = useRef<CanvasDocument | null>(null);

  const commitInlineEdit = useCallback(() => {
    if (!editingLayerId) return;
    const baseline = editBaselineRef.current;
    const layer = history.document.layers.find((l) => l.id === editingLayerId);
    if (baseline && layer && layer.value !== baseline.layers.find((l) => l.id === editingLayerId)?.value) {
      history.commitFromBaseline(baseline);
    }
    editBaselineRef.current = null;
    setEditingLayerId(null);
  }, [editingLayerId, history]);

  const startInlineEdit = useCallback(
    (id: string, opts?: { seed?: string }) => {
      const layer = history.document.layers.find((l) => l.id === id);
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
      editBaselineRef.current = cloneDocument(history.document);
      setSelectedIds([id]);
      setTool('select');
      setEditingSelectAll(opts?.seed == null);
      if (opts?.seed != null) {
        history.updateSilent({
          ...history.document,
          layers: history.document.layers.map((l) => (l.id === id ? { ...l, value: opts.seed! } : l)),
        });
      }
      setEditingLayerId(id);
      setContextMenu(null);
    },
    [history, editingLayerId, commitInlineEdit, setSelectedIds, setTool, setContextMenu],
  );

  const onInlineEditValue = useCallback(
    (id: string, value: string, contentHeightPx?: number, zoom?: number) => {
      history.updateSilent({
        ...history.document,
        layers: history.document.layers.map((l) => {
          if (l.id !== id) return l;
          const next = { ...l, value };
          // Live auto-grow while typing (single update so value + height land together).
          return contentHeightPx != null && zoom != null
            ? growTextLayerToContent(next, contentHeightPx, zoom)
            : next;
        }),
      });
    },
    [history],
  );

  const onFitTextHeight = useCallback(
    (id: string, contentHeightPx: number, zoom: number) => {
      const layer = history.document.layers.find((l) => l.id === id);
      if (!layer) return;
      const next = growTextLayerToContent(layer, contentHeightPx, zoom);
      if (next === layer) return;
      history.updateSilent({
        ...history.document,
        layers: history.document.layers.map((l) => (l.id === id ? next : l)),
      });
    },
    [history],
  );

  /** Used by `addLayerAt` to enter edit mode on a freshly created text layer.
   *  The caller already has the post-add document snapshot, so we accept it
   *  verbatim instead of re-cloning. */
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
