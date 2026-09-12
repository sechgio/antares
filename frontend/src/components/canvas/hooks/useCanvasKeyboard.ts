import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { CanvasContextMenuState } from '../editor/ContextMenu';
import type { ViewportNavApi } from '../editor/DesignStage';
import { expandWithDescendants, isLayerContainer } from '../ops/layerTree';
import {
  alignLayers,
  bringForward,
  bringToFront,
  deleteLayers,
  distributeLayers,
  duplicateLayers,
  groupLayers,
  nudgeLayers,
  sendBackward,
  sendToBack,
  setLayersLocked,
  setLayersVisible,
  ungroupLayers,
} from '../ops/layerOps';
import { assignUniqueLogoSides } from '../ops/logoSide';
import { applyAppearanceVars, extractAppearanceVars } from '../ops/clipboardLayers';
import { nextZoomPreset } from '../ops/viewportNav';
import { matchHistoryShortcut } from '../ops/historyShortcuts';
import {
  canInlineEditLayer,
  isButtonLikeKeyboardTarget,
  isEditableKeyboardTarget,
  isLayerListKeyboardTarget,
  isTypeToEditKey,
} from '../ops/inlineEdit';
import type {
  CanvasDocument,
  CanvasLayer,
  CanvasMode,
  CanvasTool,
  LayerCssVars,
} from '../types';

export interface CanvasKeyboardInput {
  onKeyDownRef: MutableRefObject<(e: KeyboardEvent) => void>;
  mode: CanvasMode;
  isTemplatePickerOpen: boolean;
  paletteOpen: boolean;
  pathEditingLayerId: string | null;
  editingLayerId: string | null;
  eyedropperActive: boolean;
  previewOpen: boolean;
  enteredGroupId: string | null;
  tool: CanvasTool;
  pageIndex: number;
  selectedIds: string[];
  pageLayers: CanvasLayer[];
  document: CanvasDocument;
  setDocument: (doc: CanvasDocument) => void;
  setAllLayers: (layers: CanvasLayer[]) => void;
  setSelectedIds: (ids: string[]) => void;
  setTool: Dispatch<SetStateAction<CanvasTool>>;
  setRenameRequest: Dispatch<SetStateAction<{ layerId: string; nonce: number } | null>>;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  setShowShortcuts: Dispatch<SetStateAction<boolean>>;
  setEyedropperActive: Dispatch<SetStateAction<boolean>>;
  setContextMenu: Dispatch<SetStateAction<CanvasContextMenuState | null>>;
  setPathEditingLayerId: Dispatch<SetStateAction<string | null>>;
  setPreviewOpen: Dispatch<SetStateAction<boolean>>;
  setEnteredGroupId: Dispatch<SetStateAction<string | null>>;
  setGestureAbortToken: Dispatch<SetStateAction<number>>;
  commitInlineEdit: () => void;
  startInlineEdit: (id: string, opts?: { seed?: string }) => void;
  onInlineEditValue: (id: string, value: string, contentHeightPx?: number, zoom?: number) => void;
  startContainerOrInlineEdit: (id: string, opts?: { seed?: string }) => void;
  runUndo: () => void;
  runRedo: () => void;
  copyLayersToClipboard: (layers: CanvasLayer[]) => unknown;
  pasteClipboard: (offsetMm?: number) => unknown;
  pasteReplaceClipboard: () => unknown;
  sealPanelAndAbortGesture: () => void;
  cancelPageLayersGesture: () => void;
  onPanelCommitLive: () => void;
  toggleBothPanels: () => void;
  zoomToFit: () => void;
  zoomToSelection: () => void;
  onSave: () => unknown;
  propsClipboardRef: MutableRefObject<Partial<LayerCssVars> | null>;
  toolBeforeSpaceRef: MutableRefObject<CanvasTool | null>;
  viewportNavRef: RefObject<ViewportNavApi | null>;
  gestureBaselineRef: RefObject<CanvasDocument | null>;
  panelBaselineRef: RefObject<CanvasDocument | null>;
}

export function useCanvasKeyboard(input: CanvasKeyboardInput): void {
  const {
    onKeyDownRef,
    mode,
    isTemplatePickerOpen,
    paletteOpen,
    pathEditingLayerId,
    editingLayerId,
    eyedropperActive,
    previewOpen,
    enteredGroupId,
    tool,
    pageIndex,
    selectedIds,
    pageLayers,
    document: historyDoc,
    setDocument: setHistoryDoc,
    setAllLayers,
    setSelectedIds,
    setTool,
    setRenameRequest,
    setPaletteOpen,
    setShowShortcuts,
    setEyedropperActive,
    setContextMenu,
    setPathEditingLayerId,
    setPreviewOpen,
    setEnteredGroupId,
    setGestureAbortToken,
    commitInlineEdit,
    startInlineEdit,
    onInlineEditValue,
    startContainerOrInlineEdit,
    runUndo,
    runRedo,
    copyLayersToClipboard,
    pasteClipboard,
    pasteReplaceClipboard,
    sealPanelAndAbortGesture,
    cancelPageLayersGesture,
    onPanelCommitLive,
    toggleBothPanels,
    zoomToFit,
    zoomToSelection,
    onSave,
    propsClipboardRef,
    toolBeforeSpaceRef,
    viewportNavRef,
    gestureBaselineRef,
    panelBaselineRef,
  } = input;

  useEffect(() => {
    onKeyDownRef.current = (e: KeyboardEvent) => {
      if (mode !== 'design') return;
      if (isTemplatePickerOpen) return;
      if (paletteOpen) return;

      const isDuplicateShortcut = (e.ctrlKey || e.metaKey) && e.code === 'KeyD';
      const isGroupShortcut = (e.ctrlKey || e.metaKey) && e.code === 'KeyG';
      const getEditableIds = () =>
        selectedIds.filter((id) => {
          const layer = historyDoc.layers.find((l) => l.id === id);
          return layer && !layer.locked && layer.type !== 'frame';
        });
      const runDuplicate = () => {
        const ids = getEditableIds();
        if (!ids.length) return;
        const { layers, newIds } = duplicateLayers(historyDoc.layers, ids);
        setAllLayers(assignUniqueLogoSides(layers, newIds));
        setSelectedIds(newIds);
      };
      const runGroup = () => {
        const editableIds = getEditableIds();
        if (e.shiftKey && editableIds.length === 1) {
          const layer = historyDoc.layers.find((l) => l.id === editableIds[0]);
          if (layer?.type === 'group' || layer?.type === 'component') {
            setAllLayers(ungroupLayers(historyDoc.layers, layer.id));
          }
          return;
        }
        if (editableIds.length < 2) return;
        const { layers, groupId } = groupLayers(historyDoc.layers, editableIds);
        if (!groupId) return;
        setAllLayers(layers);
        setSelectedIds([groupId]);
      };

      if (pathEditingLayerId) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setPathEditingLayerId(null);
          setTool('select');
          return;
        }
      }

      const historyChord = matchHistoryShortcut(e);

      if (editingLayerId) {
        if (e.key === 'Escape') {
          e.preventDefault();
          commitInlineEdit();
          return;
        }
        if (isDuplicateShortcut) {
          e.preventDefault();
          commitInlineEdit();
          runDuplicate();
          return;
        }
        if (isGroupShortcut) {
          e.preventDefault();
          commitInlineEdit();
          runGroup();
          return;
        }

        if (isEditableKeyboardTarget(e.target)) return;
        if (historyChord) {
          e.preventDefault();
          commitInlineEdit();
          if (historyChord === 'redo') runRedo();
          else runUndo();
          return;
        }
        if (isTypeToEditKey(e.key, e) && !e.repeat) {
          e.preventDefault();
          const layer = historyDoc.layers.find((l) => l.id === editingLayerId);
          if (layer) onInlineEditValue(editingLayerId, `${layer.value}${e.key}`);
          return;
        }
        return;
      }

      if (historyChord) {
        if (isEditableKeyboardTarget(e.target)) return;
        e.preventDefault();
        if (historyChord === 'redo') runRedo();
        else runUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        toggleBothPanels();
        return;
      }
      if (isGroupShortcut) {
        e.preventDefault();
        runGroup();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.code === 'KeyK' || e.code === 'KeyP' || e.code === 'Slash')
      ) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (isEditableKeyboardTarget(e.target) && !isDuplicateShortcut) return;

      if (selectedIds.length === 1 && isTypeToEditKey(e.key, e)) {
        const layer = historyDoc.layers.find((l) => l.id === selectedIds[0]);
        if (canInlineEditLayer(layer)) {
          e.preventDefault();
          startInlineEdit(selectedIds[0], { seed: e.key });
          return;
        }
      }

      if (e.key === 'F2') {
        const only =
          selectedIds.length === 1
            ? historyDoc.layers.find((l) => l.id === selectedIds[0])
            : undefined;
        if (only && !only.locked && only.type !== 'frame') {
          e.preventDefault();
          setRenameRequest((prev) => ({ layerId: only.id, nonce: (prev?.nonce ?? 0) + 1 }));
        }
        return;
      }
      const chromeToggleIds = selectedIds.filter((id) => {
        const l = historyDoc.layers.find((x) => x.id === id);
        return l && l.type !== 'frame';
      });
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        if (chromeToggleIds.length) {
          e.preventDefault();
          sealPanelAndAbortGesture();
          const allLocked = chromeToggleIds.every(
            (id) => historyDoc.layers.find((l) => l.id === id)?.locked,
          );
          setAllLayers(setLayersLocked(historyDoc.layers, chromeToggleIds, !allLocked));
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
        if (chromeToggleIds.length) {
          e.preventDefault();
          sealPanelAndAbortGesture();
          const allHidden = chromeToggleIds.every(
            (id) => historyDoc.layers.find((l) => l.id === id)?.visible === false,
          );
          setAllLayers(setLayersVisible(historyDoc.layers, chromeToggleIds, allHidden));
        }
        return;
      }

      const plainKey = !e.ctrlKey && !e.metaKey && !e.altKey;
      if (plainKey) {
        if (e.key === 'v' || e.key === 'V') setTool('select');
        if ((e.key === 'h' || e.key === 'H') && !e.shiftKey) setTool('hand');
        if (e.key === 't' || e.key === 'T') setTool('text');
        if ((e.key === 'r' || e.key === 'R') && !e.shiftKey) setTool('rect');
        if ((e.key === 'o' || e.key === 'O') && !e.shiftKey) setTool('ellipse');
        if (e.key === 'f' || e.key === 'F') setTool('field');
        if (e.key === 'l' || e.key === 'L') {
          setTool(e.shiftKey ? 'arrow' : 'line');
        }
        if (e.key === 'c' || e.key === 'C') {
          const lineId =
            pathEditingLayerId ||
            selectedIds.find((id) => historyDoc.layers.find((l) => l.id === id)?.type === 'line');
          if (lineId) {
            setPathEditingLayerId(lineId);
            setSelectedIds([lineId]);
            setTool('cut');
          }
        }
        if (e.key === 'u' || e.key === 'U') setTool('lasso');
        if (e.key === 'i' || e.key === 'I') setTool('imageSlot');
        if (e.key === 'g' || e.key === 'G') setTool('grid');
        if (e.key === 'b' || e.key === 'B') setTool('table');
        if (e.key === 'm' || e.key === 'M') setTool('image');
        if ((e.key === 'p' || e.key === 'P') && !e.shiftKey) {
          const lineId =
            pathEditingLayerId ||
            selectedIds.find((id) => historyDoc.layers.find((l) => l.id === id)?.type === 'line');
          if (lineId) {
            setPathEditingLayerId(lineId);
            setSelectedIds([lineId]);
            setTool('bend');
          }
        }

        if (e.shiftKey) {
          if (e.key === 'p' || e.key === 'P') setTool('polygon');
          else if (e.key === 's' || e.key === 'S') setTool('star');
          else if (e.key === 'd' || e.key === 'D') setTool('diamond');
          else if (e.key === 'h' || e.key === 'H') setTool('hexagon');
          else if (e.key === 'n' || e.key === 'N') setTool('pentagon');
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setTool('image');
      }

      if (e.code === 'Space' && !e.repeat && !isButtonLikeKeyboardTarget(e.target)) {
        e.preventDefault();
        if (toolBeforeSpaceRef.current == null) toolBeforeSpaceRef.current = tool;
        setTool('hand');
      }

      const nav = viewportNavRef.current;
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        if (nav) nav.animateTo({ zoom: nextZoomPreset(nav.getZoom(), 'in'), pan: nav.getPan() });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        if (nav) nav.animateTo({ zoom: nextZoomPreset(nav.getZoom(), 'out'), pan: nav.getPan() });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        if (nav) nav.animateTo({ zoom: 1, pan: nav.getPan() });
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'Digit1') {
        e.preventDefault();
        zoomToFit();
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'Digit2') {
        e.preventDefault();
        zoomToSelection();
      }

      const editableIds = getEditableIds();

      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && editableIds.length === 1) {
        const layer = historyDoc.layers.find((l) => l.id === editableIds[0]);
        if (layer?.type === 'line') {
          e.preventDefault();
          setPathEditingLayerId(layer.id);
          setTool('select');
          return;
        }
        if (layer && (isLayerContainer(layer) || canInlineEditLayer(layer))) {
          e.preventDefault();
          startContainerOrInlineEdit(editableIds[0]);
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editableIds.length) {
          sealPanelAndAbortGesture();
          setAllLayers(deleteLayers(historyDoc.layers, editableIds));
          setSelectedIds([]);
        }
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (e.defaultPrevented || isLayerListKeyboardTarget(e.target)) return;
        if (!editableIds.length) return;
        e.preventDefault();
        sealPanelAndAbortGesture();
        const step = e.altKey ? 0.1 : e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        setAllLayers(nudgeLayers(historyDoc.layers, editableIds, dx, dy));
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        void pasteReplaceClipboard();
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const alignKey = e.key.toLowerCase();
        if (alignKey === 'c') {
          e.preventDefault();
          if (selectedIds.length) setEyedropperActive(true);
          return;
        }
        const alignMap: Record<string, 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'> = {
          a: 'left',
          d: 'right',
          w: 'top',
          s: 'bottom',
          h: 'center',
          v: 'middle',
        };
        if (alignMap[alignKey] && editableIds.length) {
          e.preventDefault();
          sealPanelAndAbortGesture();
          setAllLayers(
            alignLayers(historyDoc.layers, editableIds, alignMap[alignKey]!, { pageIndex }),
          );
          return;
        }
        if ((alignKey === 'x' || alignKey === 'y') && editableIds.length >= 3) {
          e.preventDefault();
          sealPanelAndAbortGesture();
          setAllLayers(
            distributeLayers(historyDoc.layers, editableIds, alignKey === 'x' ? 'horizontal' : 'vertical', {
              mode: 'gaps',
            }),
          );
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void onSave();
      }
      if (isDuplicateShortcut) {
        e.preventDefault();
        runDuplicate();
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        const source =
          selectedIds.length === 1
            ? historyDoc.layers.find((l) => l.id === selectedIds[0])
            : null;
        if (source) propsClipboardRef.current = extractAppearanceVars(source.cssVars);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        const props = propsClipboardRef.current;
        if (props && editableIds.length) {
          sealPanelAndAbortGesture();
          setAllLayers(applyAppearanceVars(historyDoc.layers, props, editableIds));
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === 'c') {
        e.preventDefault();
        const deepIds = expandWithDescendants(historyDoc.layers, editableIds);
        const deepIdSet = new Set(deepIds);
        const copies = historyDoc.layers.filter((l) => deepIdSet.has(l.id));
        copyLayersToClipboard(copies);
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === 'v') {
        e.preventDefault();
        void pasteClipboard(e.shiftKey ? 0 : undefined);
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'R' || e.key === 'r')) {
        e.preventDefault();
        const doc = historyDoc;
        setHistoryDoc({
          ...doc,
          settings: {
            ...doc.settings,
            showRulers: doc.settings?.showRulers === false,
          },
        });
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "'" || e.code === 'Quote')) {
        e.preventDefault();
        const doc = historyDoc;
        setHistoryDoc({
          ...doc,
          settings: {
            ...doc.settings,
            snapToGrid: !doc.settings?.snapToGrid,
          },
        });
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === ']' || e.key === '}')) {
        e.preventDefault();
        sealPanelAndAbortGesture();
        setAllLayers(bringForward(historyDoc.layers, editableIds));
      } else if (e.key === ']' || e.key === '}') {
        sealPanelAndAbortGesture();
        setAllLayers(bringToFront(historyDoc.layers, editableIds));
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '[' || e.key === '{')) {
        e.preventDefault();
        sealPanelAndAbortGesture();
        setAllLayers(sendBackward(historyDoc.layers, editableIds));
      } else if (e.key === '[' || e.key === '{') {
        sealPanelAndAbortGesture();
        setAllLayers(sendToBack(historyDoc.layers, editableIds));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedIds(
          pageLayers.filter((l) => l.type !== 'frame' && !l.locked).map((l) => l.id),
        );
      }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
      if (e.key === 'Escape') {
        if (gestureBaselineRef.current) {
          e.preventDefault();
          cancelPageLayersGesture();
          setGestureAbortToken((n) => n + 1);
          return;
        }
        if (panelBaselineRef.current) {
          e.preventDefault();
          onPanelCommitLive();
          return;
        }
        setContextMenu(null);
        setShowShortcuts(false);
        if (eyedropperActive) {
          setEyedropperActive(false);
          return;
        }
        if (previewOpen) {
          setPreviewOpen(false);
          return;
        }
        if (enteredGroupId) {
          e.preventDefault();
          setEnteredGroupId(null);
          setSelectedIds([enteredGroupId]);
          return;
        }
        if (selectedIds.length) {
          const parents = new Set(
            selectedIds.map((id) => {
              const layer = historyDoc.layers.find((l) => l.id === id);
              return layer?.parentId;
            }),
          );
          if (parents.size === 1) {
            const parentId = [...parents][0];
            if (parentId) {
              e.preventDefault();
              setSelectedIds([parentId]);
              return;
            }
          }
          setSelectedIds([]);
        }
      }
    };
  });
}
