import { useCallback, type Dispatch, type SetStateAction } from 'react';

import {
  addPage,
  duplicatePage,
  filterSelectionToPage,
  getPageCount,
  removePage,
  renamePage,
  reorderPage,
  syncImagesPerPage,
} from '../ops/pages';
import type { CanvasDocument } from '../types';

interface CanvasPageActionsParams {
  document: CanvasDocument;
  setDocument: (next: CanvasDocument) => void;
  sealPanelAndAbortGesture: () => void;
  editingLayerId: string | null;
  commitInlineEdit: () => void;
  pathEditingLayerId: string | null;
  setPathEditingLayerId: (id: string | null) => void;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setPageIndex: Dispatch<SetStateAction<number>>;
}

export function useCanvasPageActions({
  document,
  setDocument,
  sealPanelAndAbortGesture,
  editingLayerId,
  commitInlineEdit,
  pathEditingLayerId,
  setPathEditingLayerId,
  setSelectedIds,
  setPageIndex,
}: CanvasPageActionsParams) {
  const onAddPage = useCallback(() => {
    sealPanelAndAbortGesture();
    if (editingLayerId) commitInlineEdit();
    if (pathEditingLayerId) setPathEditingLayerId(null);
    const next = syncImagesPerPage(addPage(document));
    setDocument(next);
    setSelectedIds([]);
    setPageIndex(getPageCount(next) - 1);
  }, [commitInlineEdit, document, editingLayerId, pathEditingLayerId, sealPanelAndAbortGesture, setDocument, setPageIndex, setPathEditingLayerId, setSelectedIds]);

  const onRemovePage = useCallback(
    (index: number) => {
      sealPanelAndAbortGesture();
      if (editingLayerId) commitInlineEdit();
      if (pathEditingLayerId) setPathEditingLayerId(null);
      const next = syncImagesPerPage(removePage(document, index));
      setDocument(next);
      setPageIndex((prev) => {
        const nextPageIndex =
          index < prev
            ? prev - 1
            : index === prev
              ? Math.min(prev, Math.max(0, getPageCount(next) - 1))
              : prev;
        setSelectedIds((ids) => filterSelectionToPage(next.layers, ids, nextPageIndex));
        return nextPageIndex;
      });
    },
    [commitInlineEdit, document, editingLayerId, pathEditingLayerId, sealPanelAndAbortGesture, setDocument, setPageIndex, setPathEditingLayerId, setSelectedIds],
  );

  const onDuplicatePage = useCallback(
    (index: number) => {
      sealPanelAndAbortGesture();
      if (editingLayerId) commitInlineEdit();
      if (pathEditingLayerId) setPathEditingLayerId(null);
      const next = syncImagesPerPage(duplicatePage(document, index));
      setDocument(next);
      setSelectedIds([]);
      setPageIndex(index + 1);
    },
    [commitInlineEdit, document, editingLayerId, pathEditingLayerId, sealPanelAndAbortGesture, setDocument, setPageIndex, setPathEditingLayerId, setSelectedIds],
  );

  const onRenamePage = useCallback(
    (index: number, name: string) => {
      setDocument(renamePage(document, index, name));
    },
    [document, setDocument],
  );

  const onReorderPage = useCallback(
    (fromIndex: number, toIndex: number) => {
      sealPanelAndAbortGesture();
      if (editingLayerId) commitInlineEdit();
      if (pathEditingLayerId) setPathEditingLayerId(null);
      const next = reorderPage(document, fromIndex, toIndex);
      if (next === document) return;
      setDocument(next);
      setPageIndex((prev) => {
        if (prev === fromIndex) return toIndex;
        if (fromIndex < toIndex) {
          if (prev > fromIndex && prev <= toIndex) return prev - 1;
        } else if (prev >= toIndex && prev < fromIndex) {
          return prev + 1;
        }
        return prev;
      });
    },
    [commitInlineEdit, document, editingLayerId, pathEditingLayerId, sealPanelAndAbortGesture, setDocument, setPageIndex, setPathEditingLayerId],
  );

  return { onAddPage, onRemovePage, onDuplicatePage, onRenamePage, onReorderPage };
}
