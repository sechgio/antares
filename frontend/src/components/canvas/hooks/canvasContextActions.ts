import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { CanvasContextAction, CanvasContextMenuState } from '../editor/ContextMenu';
import { childIdsOf, expandWithDescendants } from '../ops/layerTree';
import {
  bringForward,
  bringToFront,
  deleteLayers,
  duplicateLayers,
  groupLayers,
  sendBackward,
  sendToBack,
  setLayerLocked,
  setLayerVisible,
  ungroupLayers,
} from '../ops/layerOps';
import { assignUniqueLogoSides } from '../ops/logoSide';
import { applyAppearanceVars, extractAppearanceVars } from '../ops/clipboardLayers';
import { moveLayersToPage, syncImagesPerPage } from '../ops/pages';
import { matchGridSlotsToSourceSize } from '../ops/gridLayout';
import { sameLayerIds, type SelectSameCriterion } from '../ops/selectSame';
import type { CanvasDocument, CanvasLayer, LayerCssVars } from '../types';

export interface CanvasContextActionsInput {
  contextMenu: CanvasContextMenuState | null;
  selectedIds: string[];
  pageLayers: CanvasLayer[];
  document: CanvasDocument;
  setDocument: (doc: CanvasDocument) => void;
  pasteClipboard: (offsetMm?: number) => unknown;
  pasteReplaceClipboard: (targetIds?: string[]) => unknown;
  copyLayersToClipboard: (layers: CanvasLayer[]) => unknown;
  sealPanelAndAbortGesture: () => void;
  startContainerOrInlineEdit: (id: string, opts?: { seed?: string }) => void;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setEyedropperActive: Dispatch<SetStateAction<boolean>>;
  setAllLayers: (layers: CanvasLayer[]) => void;
  propsClipboardRef: MutableRefObject<Partial<LayerCssVars> | null>;
}

export function createCanvasContextActionHandler(
  input: CanvasContextActionsInput,
): (action: CanvasContextAction, arg?: number | string) => void {
  const {
    contextMenu,
    selectedIds,
    pageLayers,
    document: historyDoc,
    setDocument: setHistoryDoc,
    pasteClipboard,
    pasteReplaceClipboard,
    copyLayersToClipboard,
    sealPanelAndAbortGesture,
    startContainerOrInlineEdit,
    setSelectedIds,
    setEyedropperActive,
    setAllLayers,
    propsClipboardRef,
  } = input;

  return (action: CanvasContextAction, arg?: number | string) => {
    const id = contextMenu?.layerId;
    const contextRoots = id ? (selectedIds.includes(id) ? selectedIds : [id]) : [];

    if (action === 'paste') {
      void pasteClipboard();
      return;
    }
    if (action === 'pasteInPlace') {
      void pasteClipboard(0);
      return;
    }
    if (action === 'selectUnderCursor' && typeof arg === 'string') {
      const target = historyDoc.layers.find((l) => l.id === arg);
      if (target) setSelectedIds([target.id]);
      return;
    }
    if (action === 'moveToPage' && typeof arg === 'number') {
      if (!contextRoots.length) return;
      sealPanelAndAbortGesture();
      const next = syncImagesPerPage(moveLayersToPage(historyDoc, contextRoots, arg));
      if (next === historyDoc) return;
      setHistoryDoc(next);
      setSelectedIds((ids) => ids.filter((selectedId) => !contextRoots.includes(selectedId)));
      return;
    }
    if (action === 'eyedropper' && id) {
      if (!selectedIds.includes(id)) setSelectedIds([id]);
      setEyedropperActive(true);
      return;
    }
    if (action === 'pasteToReplace') {
      void pasteReplaceClipboard(id && !selectedIds.includes(id) ? [id] : undefined);
      return;
    }
    if (action === 'selectSame' && typeof arg === 'string' && id) {
      const ref = historyDoc.layers.find((l) => l.id === id);
      const ids = sameLayerIds(pageLayers, ref ?? null, arg as SelectSameCriterion);
      if (ids.length) setSelectedIds(ids);
      return;
    }

    if (!id) return;
    const layers = historyDoc.layers;
    const layerById = new Map(layers.map((candidate) => [candidate.id, candidate]));
    const layer = layerById.get(id);
    if (!layer || layer.type === 'frame') return;
    const editableRoots = () => contextRoots.filter((rootId) => {
      const root = layerById.get(rootId);
      return Boolean(root && !root.locked && root.type !== 'frame');
    });

    if (action === 'edit') {
      startContainerOrInlineEdit(id);
      return;
    }
    if (action === 'copy') {
      const deepIds = expandWithDescendants(layers, editableRoots());
      const deepIdSet = new Set(deepIds);
      const copies = layers.filter((candidate) => deepIdSet.has(candidate.id));
      copyLayersToClipboard(copies);
      return;
    }
    if (action === 'copyProps') {
      propsClipboardRef.current = extractAppearanceVars(layer.cssVars);
      return;
    }
    if (action === 'pasteProps') {
      const props = propsClipboardRef.current;
      if (!props) return;
      sealPanelAndAbortGesture();
      setAllLayers(applyAppearanceVars(layers, props, contextRoots));
      return;
    }
    if (action === 'selectParent') {
      if (layer.parentId) setSelectedIds([layer.parentId]);
      return;
    }
    if (action === 'toggleLock') {
      sealPanelAndAbortGesture();
      setAllLayers(setLayerLocked(layers, id, !layer.locked));
      return;
    }
    if (action === 'toggleVisible') {
      sealPanelAndAbortGesture();
      setAllLayers(setLayerVisible(layers, id, layer.visible === false));
      return;
    }
    if (action === 'selectChildren') {
      const kids = childIdsOf(layers, id);
      if (kids.length) setSelectedIds(kids);
      return;
    }
    if (action === 'group') {
      const editable = editableRoots();
      if (editable.length < 2) return;
      sealPanelAndAbortGesture();
      const { layers: groupedLayers, groupId } = groupLayers(layers, editable);
      setAllLayers(groupedLayers);
      setSelectedIds([groupId]);
      return;
    }
    if (action === 'ungroup') {
      if (layer.type !== 'group' && layer.type !== 'component') return;
      sealPanelAndAbortGesture();
      setAllLayers(ungroupLayers(layers, id));
      return;
    }
    if (layer.locked) return;

    if (action === 'matchGridSlotSize') {
      sealPanelAndAbortGesture();
      setAllLayers(matchGridSlotsToSourceSize(layers, id));
      return;
    }
    if (action === 'duplicate') {
      sealPanelAndAbortGesture();
      const editable = editableRoots();
      if (!editable.length) return;
      const { layers: duplicatedLayers, newIds } = duplicateLayers(layers, editable);
      setAllLayers(assignUniqueLogoSides(duplicatedLayers, newIds));
      setSelectedIds(newIds);
      return;
    }
    if (action === 'bringFront') {
      sealPanelAndAbortGesture();
      setAllLayers(bringToFront(layers, contextRoots));
      return;
    }
    if (action === 'bringForward') {
      sealPanelAndAbortGesture();
      setAllLayers(bringForward(layers, contextRoots));
      return;
    }
    if (action === 'sendBack') {
      sealPanelAndAbortGesture();
      setAllLayers(sendToBack(layers, contextRoots));
      return;
    }
    if (action === 'sendBackward') {
      sealPanelAndAbortGesture();
      setAllLayers(sendBackward(layers, contextRoots));
      return;
    }
    if (action === 'delete') {
      sealPanelAndAbortGesture();
      setAllLayers(deleteLayers(layers, contextRoots));
      setSelectedIds((prev) => prev.filter((selectedId) => !contextRoots.includes(selectedId)));
    }
  };
}
