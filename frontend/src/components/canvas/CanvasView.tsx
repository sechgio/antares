import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import './canvas.css';
import { createLayer } from './constants';
import { CANVAS_PRESETS } from './presets';
import {
  queueCanvasCloudDelete,
  queueCanvasCloudPush,
} from './sync/canvasCloudSync';
import BottomToolbar from './editor/BottomToolbar';
import ContextMenu, {
  type CanvasContextAction,
  type CanvasContextMenuState,
} from './editor/ContextMenu';
import DesignStage, { type ViewportNavApi } from './editor/DesignStage';
import LeftSidebar from './editor/LeftSidebar';
import PreviewViewport from './editor/PreviewViewport';
import PageLayerPreview from './editor/PageLayerPreview';
import PathEditToolbar from './editor/PathEditToolbar';
import RightPanel from './editor/RightPanel';
import TopBar from './editor/TopBar';
import { useCanvasHistory } from './hooks/useCanvasHistory';
import { useCanvasBootstrap } from './hooks/useCanvasBootstrap';
import { useCanvasSync } from './hooks/useCanvasSync';
import { useGestureBaselines } from './hooks/useGestureBaselines';
import { useInlineEdit } from './hooks/useInlineEdit';
import { CANVAS_SHORTCUTS } from './shortcuts';
import {
  alignLayers,
  bringForward,
  bringToFront,
  deleteLayers,
  distributeLayers,
  duplicateLayers,
  groupLayers,
  moveLayerInTree,
  nudgeLayers,
  sendBackward,
  sendToBack,
  setLayerVisible,
  setLayerLocked,
  setLayersLocked,
  setLayersOpacity,
  setLayersVisible,
  ungroupLayers,
} from './ops/layerOps';
import { childIdsOf, expandWithDescendants, isLayerContainer } from './ops/layerTree';
import {
  collectDocumentColors,
  DEFAULT_LINE_STROKE_PX,
  clampOpacity,
  lineHeightMmFromStrokePx,
  strokeWeightForNewLine,
} from './ops/layerStyle';
import { applyPathToLayer, ensureLinePath, pathFromDrag } from './ops/pathGeometry';
import { toggleLineClosed } from './ops/pathEditGestures';
import {
  addPage,
  duplicatePage,
  getPageCount,
  removePage,
  renamePage,
  setActivePageLayers,
  syncImagesPerPage,
} from './ops/pages';
import { applyGridToImageSlots, matchGridSlotsToSourceSize, rebuildGridSlots } from './ops/gridLayout';
import { assignUniqueLogoSides, logoSideHasConflict, withAssignedLogoSide } from './ops/logoSide';
import { isClickPlace, type DrawRect } from './ops/drawHelpers';
import { moveGuide, removeGuide, upsertGuide } from './ops/guides';
import { selectionBounds } from './ops/selectionTransform';
import { syncLinkedStylesFromLayer } from './ops/syncLinkedStyles';
import {
  applyStyleToLayers,
  colorStyleSwatches,
  createAndLinkStyle,
  detachStyleOnLayers,
  removeStyle,
  updateStyle,
} from './ops/sharedStyles';
import {
  nextBothPanelsOpen,
  PANEL_CHROME_KEYS,
  readBoolLS,
  writeBoolLS,
} from './ops/panelChrome';
import { canFocusFieldBinding, canInlineEditLayer, isEditableKeyboardTarget, isTypeToEditKey } from './ops/inlineEdit';
import { matchHistoryShortcut } from './ops/historyShortcuts';
import { cloneDocument } from './ops/document';
import {
  A4_HEIGHT_PX,
  A4_WIDTH_PX,
  createEmptyDocument,
  mm,
  normalizeDocument,
  type CanvasDocument,
  type CanvasDocumentSummary,
  type CanvasLayer,
  type CanvasLayerType,
  type CanvasMode,
  type CanvasStyleKind,
  type CanvasTool,
  newId,
} from './types';

const GeneratePanel = lazy(() => import('./editor/GeneratePanel'));

type PlaceableTool = Exclude<CanvasTool, 'select' | 'hand'>;

const DEFAULT_SIZES: Partial<Record<PlaceableTool, { w: number; h: number }>> = {
  rect: { w: 50, h: 40 },
  ellipse: { w: 40, h: 40 },
  line: { w: 60, h: lineHeightMmFromStrokePx(DEFAULT_LINE_STROKE_PX) },
  arrow: { w: 50, h: 24 },
  polygon: { w: 40, h: 40 },
  star: { w: 40, h: 40 },
  diamond: { w: 40, h: 40 },
  hexagon: { w: 40, h: 40 },
  pentagon: { w: 40, h: 40 },
  text: { w: 60, h: 8 },
  field: { w: 70, h: 8 },
  logo: { w: 45, h: 16 },
  image: { w: 50, h: 40 },
  imageSlot: { w: 80, h: 60 },
  grid: { w: 170, h: 120 },
  table: { w: 170, h: 40 },
  checkbox: { w: 6, h: 6 },
  signature: { w: 60, h: 20 },
};

export default function CanvasView() {
  const history = useCanvasHistory(createEmptyDocument('Sin título'));
  // Refs mirror history state so runCloudSync can read the latest values
  // without depending on `history` (which changes on every mutation and would
  // re-subscribe the focus listener on every keystroke/drag).
  const historyDocRef = useRef(history.document);
  const historyCanUndoRef = useRef(history.canUndo);
  historyDocRef.current = history.document;
  historyCanUndoRef.current = history.canUndo;
  const [mode, setMode] = useState<CanvasMode>('design');
  const [docs, setDocs] = useState<CanvasDocumentSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const viewportNavRef = useRef<ViewportNavApi | null>(null);
  const [rightZoomSlot, setRightZoomSlot] = useState<HTMLDivElement | null>(null);
  const [stageZoomSlot, setStageZoomSlot] = useState<HTMLDivElement | null>(null);
  const [leftPanelOpen, setLeftPanelOpen] = useState(() => readBoolLS(PANEL_CHROME_KEYS.left, true));
  const [rightPanelOpen, setRightPanelOpen] = useState(() => readBoolLS(PANEL_CHROME_KEYS.right, true));
  const [uiLocked, setUiLocked] = useState(() => readBoolLS(PANEL_CHROME_KEYS.lock, false));
  const [tool, setTool] = useState<CanvasTool>('select');
  const toolBeforeSpaceRef = useRef<CanvasTool | null>(null);
  const [clipboard, setClipboard] = useState<CanvasLayer[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pathEditingLayerId, setPathEditingLayerId] = useState<string | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedId = selectedIds[0] ?? null;
  const pageLayers = useMemo(
    () => history.document.layers.filter((l) => (l.pageIndex ?? 0) === pageIndex),
    [history.document.layers, pageIndex],
  );
  const pageColors = useMemo(() => {
    const fromLayers = collectDocumentColors(history.document.layers);
    const fromStyles = colorStyleSwatches(history.document).map((s) => s.color);
    return [...new Set([...fromLayers, ...fromStyles])];
  }, [history.document]);

  const flashStatus = useCallback((message: string, ms = 2000) => {
    setStatus(message);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => {
      statusTimerRef.current = null;
      setStatus(null);
    }, ms);
  }, []);

  useEffect(() => {
    writeBoolLS(PANEL_CHROME_KEYS.left, leftPanelOpen);
  }, [leftPanelOpen]);
  useEffect(() => {
    writeBoolLS(PANEL_CHROME_KEYS.right, rightPanelOpen);
  }, [rightPanelOpen]);
  useEffect(() => {
    writeBoolLS(PANEL_CHROME_KEYS.lock, uiLocked);
  }, [uiLocked]);

  useEffect(
    () => () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    },
    [],
  );

  const resetViewportPan = useCallback(() => {
    viewportNavRef.current?.setPan({ x: 0, y: 0 });
  }, []);

  const {
    editingLayerId,
    editingSelectAll,
    commitInlineEdit,
    startInlineEdit,
    onInlineEditValue,
    onFitTextHeight,
    beginEditWithBaseline,
  } = useInlineEdit({ history, setSelectedIds, setTool, setContextMenu });

  const togglePreview = useCallback(() => {
    setPreviewOpen((open) => {
      if (open) return false;
      setShowShortcuts(false);
      setContextMenu(null);
      return true;
    });
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const res = await api.canvasList();
      setDocs(res.documents);
    } catch {
      setDocs([]);
    }
  }, []);

  const { runCloudSync } = useCanvasSync({
    historyDocRef,
    historyCanUndoRef,
    refreshList,
    replaceDocument: history.replaceDocument,
  });

  useCanvasBootstrap({
    replaceDocument: history.replaceDocument,
    setDocs,
    setLoading,
    runCloudSync,
  });

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

  const setPageLayers = (layers: CanvasLayer[]) => {
    history.setDocument(syncImagesPerPage(setActivePageLayers(history.document, pageIndex, layers)));
  };

  const setAllLayers = (layers: CanvasLayer[]) => {
    history.setDocument(syncImagesPerPage({ ...history.document, layers }));
  };

  const {
    panelBaselineRef,
    setPageLayersLive,
    commitPageLayersGesture,
    onPanelChangeLive,
    onPanelCommitLive,
  } = useGestureBaselines({ history, pageIndex });

  const leftPanelOpenRef = useRef(leftPanelOpen);
  const rightPanelOpenRef = useRef(rightPanelOpen);
  const uiLockedRef = useRef(uiLocked);
  leftPanelOpenRef.current = leftPanelOpen;
  rightPanelOpenRef.current = rightPanelOpen;
  uiLockedRef.current = uiLocked;

  const toggleLeftPanel = useCallback(() => {
    if (uiLockedRef.current) return;
    setLeftPanelOpen((open) => !open);
  }, []);

  const toggleRightPanel = useCallback(() => {
    if (uiLockedRef.current) return;
    setRightPanelOpen((open) => {
      if (open && panelBaselineRef.current) onPanelCommitLive();
      return !open;
    });
  }, [onPanelCommitLive, panelBaselineRef]);

  const toggleUiLock = useCallback(() => {
    setUiLocked((locked) => !locked);
  }, []);

  const toggleBothPanels = useCallback(() => {
    if (uiLockedRef.current) return;
    const next = nextBothPanelsOpen(leftPanelOpenRef.current, rightPanelOpenRef.current);
    if (!next && rightPanelOpenRef.current && panelBaselineRef.current) onPanelCommitLive();
    setLeftPanelOpen(next);
    setRightPanelOpen(next);
  }, [onPanelCommitLive, panelBaselineRef]);

  const zoomPortalTarget = rightPanelOpen ? rightZoomSlot : stageZoomSlot;

  const onSelect = (id: string | null, additive = false) => {
    if (editingLayerId && id !== editingLayerId) {
      commitInlineEdit();
    }
    if (pathEditingLayerId && id !== pathEditingLayerId) {
      setPathEditingLayerId(null);
    }
    if (panelBaselineRef.current) {
      onPanelCommitLive();
    }
    if (!id) {
      setSelectedIds([]);
      setPathEditingLayerId(null);
      return;
    }
    if (additive) {
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    } else {
      setSelectedIds([id]);
    }
  };

  const zoomToFit = useCallback(() => {
    viewportNavRef.current?.zoomToFit();
  }, []);

  const zoomToSelection = useCallback(() => {
    viewportNavRef.current?.zoomToSelection(selectedIds);
  }, [selectedIds]);

  const startContainerOrInlineEdit = useCallback(
    (id: string, opts?: { seed?: string }) => {
      const layer = history.document.layers.find((l) => l.id === id);
      if (layer && isLayerContainer(layer)) {
        // Grid: slots are independently selectable — selecting all kids locks
        // multi-resize and blocks free per-cell sizing. Groups still drill in.
        if (layer.type === 'grid') {
          setTool('select');
          setContextMenu(null);
          return;
        }
        const kids = childIdsOf(history.document.layers, id);
        if (kids.length) {
          setSelectedIds(kids);
          setTool('select');
          setContextMenu(null);
        }
        return;
      }
      startInlineEdit(id, opts);
    },
    [history.document.layers, startInlineEdit],
  );

  const pasteClipboard = useCallback(
    (offsetMm?: number) => {
      if (!clipboard.length) return;
      const withIds = clipboard.map((l) => ({ ...l, pageIndex }));
      const clipIds = new Set(withIds.map((l) => l.id));
      const roots = withIds.filter((l) => !l.parentId || !clipIds.has(l.parentId));
      const temp = [...history.document.layers, ...withIds];
      const { layers, newIds } = duplicateLayers(
        temp,
        roots.map((l) => l.id),
        offsetMm === undefined ? undefined : { offsetMm },
      );
      const originalClipIds = new Set(withIds.map((l) => l.id));
      setAllLayers(assignUniqueLogoSides(layers.filter((l) => !originalClipIds.has(l.id)), newIds));
      setSelectedIds(newIds);
    },
    [clipboard, history.document.layers, pageIndex, setAllLayers],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== 'design') return;

      const isDuplicateShortcut = (e.ctrlKey || e.metaKey) && e.code === 'KeyD';
      const isGroupShortcut = (e.ctrlKey || e.metaKey) && e.code === 'KeyG';
      const getEditableIds = () =>
        selectedIds.filter((id) => {
          const layer = history.document.layers.find((l) => l.id === id);
          return layer && !layer.locked && layer.type !== 'frame';
        });
      const runDuplicate = () => {
        const ids = getEditableIds();
        if (!ids.length) return;
        const { layers, newIds } = duplicateLayers(history.document.layers, ids);
        setAllLayers(assignUniqueLogoSides(layers, newIds));
        setSelectedIds(newIds);
      };
      const runGroup = () => {
        const editableIds = getEditableIds();
        if (e.shiftKey && editableIds.length === 1) {
          const layer = history.document.layers.find((l) => l.id === editableIds[0]);
          if (layer?.type === 'group') {
            setAllLayers(ungroupLayers(history.document.layers, layer.id));
          }
          return;
        }
        if (editableIds.length < 2) return;
        const { layers, groupId } = groupLayers(history.document.layers, editableIds);
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

      // While inline-editing: let the textarea handle keys once focused;
      // route printable keys if focus hasn't landed yet (type-to-edit race).
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
        // Textarea / contentEditable: keep native undo while typing.
        if (isEditableKeyboardTarget(e.target)) return;
        if (historyChord) {
          e.preventDefault();
          commitInlineEdit();
          if (historyChord === 'redo') history.redo();
          else history.undo();
          return;
        }
        if (isTypeToEditKey(e.key, e) && !e.repeat) {
          e.preventDefault();
          const layer = history.document.layers.find((l) => l.id === editingLayerId);
          if (layer) onInlineEditValue(editingLayerId, `${layer.value}${e.key}`);
          return;
        }
        // Block tool / delete / nudge shortcuts while editing.
        return;
      }
      // Allow undo/redo + Ctrl/Cmd+D/G even when focus is in panel inputs.
      if (historyChord) {
        e.preventDefault();
        if (historyChord === 'redo') history.redo();
        else history.undo();
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
      if (isEditableKeyboardTarget(e.target) && !isDuplicateShortcut) return;

      // Type-to-edit before tool letter shortcuts (Figma: typing replaces text, not tools).
      if (selectedIds.length === 1 && isTypeToEditKey(e.key, e)) {
        const layer = history.document.layers.find((l) => l.id === selectedIds[0]);
        if (canInlineEditLayer(layer)) {
          e.preventDefault();
          startInlineEdit(selectedIds[0], { seed: e.key });
          return;
        }
      }

      // Single-letter tool shortcuts must never swallow modifier chords
      // (Ctrl+V paste, Ctrl+G group, Ctrl+B, Alt combos…).
      const plainKey = !e.ctrlKey && !e.metaKey && !e.altKey;
      if (plainKey) {
        if (e.key === 'v' || e.key === 'V') setTool('select');
        if (e.key === 'h' || e.key === 'H') setTool('hand');
        if (e.key === 't' || e.key === 'T') setTool('text');
        if ((e.key === 'r' || e.key === 'R') && !e.shiftKey) setTool('rect');
        if (e.key === 'o' || e.key === 'O') setTool('ellipse');
        if (e.key === 'f' || e.key === 'F') setTool('field');
        if (e.key === 'l' || e.key === 'L') {
          setTool(e.shiftKey ? 'arrow' : 'line');
        }
        if (e.key === 'c' || e.key === 'C') {
          const lineId =
            pathEditingLayerId ||
            selectedIds.find((id) => history.document.layers.find((l) => l.id === id)?.type === 'line');
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
        if (e.key === 'p' || e.key === 'P') {
          const lineId =
            pathEditingLayerId ||
            selectedIds.find((id) => history.document.layers.find((l) => l.id === id)?.type === 'line');
          if (lineId) {
            setPathEditingLayerId(lineId);
            setSelectedIds([lineId]);
            setTool('bend');
          }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setTool('image');
      }
      // Space = temporary hand (OpenPencil)
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        if (toolBeforeSpaceRef.current == null) toolBeforeSpaceRef.current = tool;
        setTool('hand');
      }
      // Zoom shortcuts (OpenPencil: Ctrl/⌘ + / - / 0; Shift+1 = fit)
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        viewportNavRef.current?.setZoom((z) => Math.min(4, Math.round((z + 0.1) * 100) / 100));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        viewportNavRef.current?.setZoom((z) => Math.max(0.2, Math.round((z - 0.1) * 100) / 100));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        viewportNavRef.current?.setZoom(1);
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
        const layer = history.document.layers.find((l) => l.id === editableIds[0]);
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
          setAllLayers(deleteLayers(history.document.layers, editableIds));
          setSelectedIds([]);
        }
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!editableIds.length) return;
        e.preventDefault();
        const step = e.altKey ? 0.1 : e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        setAllLayers(nudgeLayers(history.document.layers, editableIds, dx, dy));
      }

      // Align / distribute shortcuts (Alt+letter, no Ctrl)
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const alignKey = e.key.toLowerCase();
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
          setAllLayers(
            alignLayers(history.document.layers, editableIds, alignMap[alignKey]!, { pageIndex }),
          );
          return;
        }
        if ((alignKey === 'x' || alignKey === 'y') && editableIds.length >= 3) {
          e.preventDefault();
          setAllLayers(
            distributeLayers(history.document.layers, editableIds, alignKey === 'x' ? 'horizontal' : 'vertical', {
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
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        const deepIds = expandWithDescendants(history.document.layers, editableIds);
        const copies = history.document.layers.filter((l) => deepIds.includes(l.id));
        setClipboard(copies.map((l) => ({ ...l, cssVars: { ...l.cssVars } })));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        pasteClipboard(e.shiftKey ? 0 : undefined);
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'R' || e.key === 'r')) {
        e.preventDefault();
        const doc = history.document;
        history.setDocument({
          ...doc,
          settings: {
            ...doc.settings,
            showRulers: doc.settings?.showRulers === false,
          },
        });
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "'" || e.code === 'Quote')) {
        e.preventDefault();
        const doc = history.document;
        history.setDocument({
          ...doc,
          settings: {
            ...doc.settings,
            snapToGrid: !doc.settings?.snapToGrid,
          },
        });
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === ']' || e.key === '}')) {
        e.preventDefault();
        setAllLayers(bringForward(history.document.layers, editableIds));
      } else if (e.key === ']' || e.key === '}') {
        setAllLayers(bringToFront(history.document.layers, editableIds));
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '[' || e.key === '{')) {
        e.preventDefault();
        setAllLayers(sendBackward(history.document.layers, editableIds));
      } else if (e.key === '[' || e.key === '{') {
        setAllLayers(sendToBack(history.document.layers, editableIds));
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
        setContextMenu(null);
        setShowShortcuts(false);
        if (previewOpen) {
          setPreviewOpen(false);
          return;
        }
        if (pathEditingLayerId) {
          setPathEditingLayerId(null);
          return;
        }
        // Esc → select parent when all selected share one parent (Figma-like).
        if (selectedIds.length) {
          const parents = new Set(
            selectedIds.map((id) => {
              const layer = history.document.layers.find((l) => l.id === id);
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
    const onKeyUp = (e: KeyboardEvent) => {
      if (mode !== 'design') return;
      if (e.code === 'Space') {
        const prev = toolBeforeSpaceRef.current;
        toolBeforeSpaceRef.current = null;
        if (prev) setTool(prev);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    mode,
    selectedIds,
    history.document,
    history.undo,
    history.redo,
    history.setDocument,
    onSave,
    clipboard,
    pageIndex,
    pageLayers,
    tool,
    zoomToFit,
    zoomToSelection,
    editingLayerId,
    pathEditingLayerId,
    commitInlineEdit,
    startInlineEdit,
    startContainerOrInlineEdit,
    onInlineEditValue,
    previewOpen,
    pasteClipboard,
    toggleBothPanels,
  ]);

  const selected = history.document.layers.find((l) => l.id === selectedId) || null;
  const selectedLine =
    selectedIds.length === 1
      ? history.document.layers.find((l) => l.id === selectedIds[0] && l.type === 'line')
      : pathEditingLayerId
        ? history.document.layers.find((l) => l.id === pathEditingLayerId && l.type === 'line')
        : null;
  const showPathToolbar = Boolean(selectedLine || pathEditingLayerId || tool === 'bend' || tool === 'cut' || tool === 'lasso');
  const pathToolbarLine = selectedLine
    ? ensureLinePath(selectedLine)
    : pathEditingLayerId
      ? ensureLinePath(
          history.document.layers.find((l) => l.id === pathEditingLayerId) || createLayer('line'),
        )
      : null;

  const addLayerAt = (type: PlaceableTool, rect: DrawRect) => {
    const layerType = type as Exclude<CanvasLayerType, 'frame' | 'group'>;
    let layer = createLayer(layerType);
    if (layerType === 'logo') {
      layer = withAssignedLogoSide(layer, history.document.layers);
    }
    layer.pageIndex = pageIndex;
    const defaults = DEFAULT_SIZES[type] ?? { w: 40, h: 30 };
    const useDefault = isClickPlace(rect) || (rect.w === 0 && rect.h === 0);
    const w = useDefault ? defaults.w : Math.max(type === 'line' ? 1 : 4, rect.w);
    const h = useDefault ? defaults.h : Math.max(4, rect.h);
    const x = useDefault ? rect.x : rect.x;
    const y = useDefault ? rect.y : rect.y;
    layer.cssVars = {
      ...layer.cssVars,
      '--translate-x': mm(Math.max(0, x)),
      '--translate-y': mm(Math.max(0, y)),
      '--width': mm(w),
      '--height': mm(h),
    };
    if (type === 'ellipse') {
      layer.cssVars['--border-radius'] = '50%';
    }
    if (type === 'line') {
      const strokePx = strokeWeightForNewLine();
      layer.cssVars['--background-color'] = 'transparent';
      layer.cssVars['--fill-visible'] = '0';
      layer.cssVars['--border-width'] = `${strokePx}px`;
      layer.cssVars['--border-color'] = layer.cssVars['--border-color'] || '#000000';
      layer.cssVars['--stroke-align'] = 'center';
      layer.cssVars['--stroke-visible'] = '1';
      layer.cssVars['--stroke-opacity'] = layer.cssVars['--stroke-opacity'] || '100';
      layer.cssVars['--stroke-start'] = layer.cssVars['--stroke-start'] || 'none';
      layer.cssVars['--stroke-end'] = layer.cssVars['--stroke-end'] || 'none';
      if (!useDefault && rect.x0 != null && rect.y0 != null && rect.x1 != null && rect.y1 != null) {
        const drag = pathFromDrag(rect.x0, rect.y0, rect.x1, rect.y1);
        layer = applyPathToLayer(layer, drag.path, drag.originX, drag.originY);
      } else {
        const endX = useDefault ? defaults.w : Math.max(1, w);
        const midY = Math.max(1, lineHeightMmFromStrokePx(strokePx));
        layer = applyPathToLayer(
          layer,
          { points: [{ x: 0, y: midY }, { x: endX, y: midY }], closed: false },
          x,
          y,
        );
      }
    }
    let layers = [...history.document.layers, layer];
    if (type === 'grid') {
      const slots: CanvasLayer[] = [];
      const cols = layer.meta?.cols ?? 2;
      const rows = layer.meta?.rows ?? 2;
      for (let i = 0; i < cols * rows; i += 1) {
        const slot = createLayer('imageSlot', {
          name: `Foto ${i + 1}`,
          pageIndex,
          parentId: layer.id,
          meta: { index: i },
        });
        slots.push(slot);
      }
      layers = applyGridToImageSlots([...layers, ...slots], layer.id);
    }
    history.setDocument(
      syncImagesPerPage({
        ...history.document,
        layers,
        fields:
          type === 'field' && layer.meta?.key
            ? [
                ...history.document.fields.filter((f) => f.key !== layer.meta!.key),
                { id: newId(), key: layer.meta.key, label: layer.meta.key },
              ]
            : history.document.fields,
      }),
    );
    setSelectedIds([layer.id]);
    setTool('select');
    if (type === 'text') {
      beginEditWithBaseline(cloneDocument({ ...history.document, layers }), layer.id);
    }
    flashStatus(`Capa «${layer.name}» creada`, 1500);
  };

  const onDuplicate = async () => {
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
  };

  const onDeleteDoc = async () => {
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
  };

  const onOpenDoc = async (id: string) => {
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
  };

  const onNew = async () => {
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
  };

  const onRename = (name: string) => {
    history.updateSilent({ ...history.document, name });
    setDocs((prev) => {
      const next = prev.map((d) => (d.id === history.document.id ? { ...d, name } : d));
      if (next.some((d) => d.id === history.document.id)) return next;
      return [...next, { id: history.document.id, name }];
    });
  };

  // Capture the document snapshot at focus time so the rename can be committed
  // to history as a single undoable entry on blur/Enter (instead of one entry
  // per keystroke). Mirrors the gesture pattern used elsewhere in the canvas.
  const renameBaselineRef = useRef<typeof history.document | null>(null);
  const onRenameStart = () => {
    renameBaselineRef.current = history.document;
  };
  const onRenameCommit = () => {
    const baseline = renameBaselineRef.current;
    renameBaselineRef.current = null;
    if (!baseline || baseline.name === history.document.name) return;
    history.commitFromBaseline(baseline);
  };

  const onApplyPreset = (presetId: string) => {
    const preset = CANVAS_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const doc = preset.create();
    doc.id = history.document.id;
    doc.name = history.document.name;
    history.setDocument(syncImagesPerPage(doc));
    setSelectedIds([]);
    setPageIndex(0);
  };

  const onDeleteLayer = (id: string) => {
    setAllLayers(deleteLayers(history.document.layers, [id]));
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  };

  const onContextAction = (action: CanvasContextAction) => {
    const id = contextMenu?.layerId;

    if (action === 'paste') {
      pasteClipboard();
      return;
    }
    if (action === 'pasteInPlace') {
      pasteClipboard(0);
      return;
    }

    if (!id) return;
    const layer = history.document.layers.find((l) => l.id === id);
    if (!layer || layer.type === 'frame') return;

    if (action === 'edit') {
      startContainerOrInlineEdit(id);
      return;
    }
    if (action === 'copy') {
      const roots = selectedIds.includes(id) ? selectedIds : [id];
      const editable = roots.filter((lid) => {
        const l = history.document.layers.find((x) => x.id === lid);
        return l && !l.locked && l.type !== 'frame';
      });
      const deepIds = expandWithDescendants(history.document.layers, editable);
      const copies = history.document.layers.filter((l) => deepIds.includes(l.id));
      setClipboard(copies.map((l) => ({ ...l, cssVars: { ...l.cssVars } })));
      return;
    }
    if (action === 'toggleLock') {
      setAllLayers(setLayerLocked(history.document.layers, id, !layer.locked));
      return;
    }
    if (action === 'toggleVisible') {
      setAllLayers(setLayerVisible(history.document.layers, id, layer.visible === false));
      return;
    }
    if (action === 'selectChildren') {
      const kids = childIdsOf(history.document.layers, id);
      if (kids.length) setSelectedIds(kids);
      return;
    }
    if (action === 'group') {
      const ids = selectedIds.includes(id) ? selectedIds : [id];
      const editable = ids.filter((lid) => {
        const l = history.document.layers.find((x) => x.id === lid);
        return l && !l.locked && l.type !== 'frame';
      });
      if (editable.length < 2) return;
      const { layers, groupId } = groupLayers(history.document.layers, editable);
      setAllLayers(layers);
      setSelectedIds([groupId]);
      return;
    }
    if (action === 'ungroup') {
      if (layer.type !== 'group') return;
      setAllLayers(ungroupLayers(history.document.layers, id));
      return;
    }
    if (layer.locked) return;

    if (action === 'matchGridSlotSize') {
      setAllLayers(matchGridSlotsToSourceSize(history.document.layers, id));
      return;
    }
    if (action === 'duplicate') {
      const { layers, newIds } = duplicateLayers(history.document.layers, [id]);
      setAllLayers(assignUniqueLogoSides(layers, newIds));
      setSelectedIds(newIds);
      return;
    }
    if (action === 'bringFront') {
      setAllLayers(bringToFront(history.document.layers, [id]));
      return;
    }
    if (action === 'bringForward') {
      setAllLayers(bringForward(history.document.layers, [id]));
      return;
    }
    if (action === 'sendBack') {
      setAllLayers(sendToBack(history.document.layers, [id]));
      return;
    }
    if (action === 'sendBackward') {
      setAllLayers(sendBackward(history.document.layers, [id]));
      return;
    }
    if (action === 'delete') {
      onDeleteLayer(id);
    }
  };

  const onAlign = (align: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (!selectedIds.length) return;
    if (panelBaselineRef.current) onPanelCommitLive();
    setAllLayers(
      alignLayers(history.document.layers, selectedIds, align, { pageIndex }),
    );
  };

  const onDistribute = (axis: 'horizontal' | 'vertical') => {
    if (selectedIds.length < 3) return;
    if (panelBaselineRef.current) onPanelCommitLive();
    setAllLayers(
      distributeLayers(history.document.layers, selectedIds, axis, { mode: 'gaps' }),
    );
  };

  const editableSelectedIds = selectedIds.filter((id) => {
    const layer = history.document.layers.find((l) => l.id === id);
    return layer && layer.type !== 'frame';
  });

  const onMoveLayer = (
    draggedId: string,
    targetId: string,
    position: 'before' | 'after' | 'inside',
  ) => {
    setAllLayers(moveLayerInTree(history.document.layers, draggedId, targetId, position));
  };

  if (loading) {
    return (
      <div className="canvas-app canvas-loading">
        <span className="canvas-loading-dot" aria-hidden />
        Cargando Canvas…
      </div>
    );
  }

  return (
    <div className="canvas-app flex h-full min-h-0 flex-col">
      <TopBar
        name={history.document.name}
        mode={mode}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        status={status}
        showShortcuts={showShortcuts}
        previewOpen={previewOpen}
        onToggleShortcuts={() => setShowShortcuts((v) => !v)}
        onTogglePreview={togglePreview}
        onNameChange={onRename}
        onNameStart={onRenameStart}
        onNameCommit={onRenameCommit}
        onMode={(next) => {
          setMode(next);
          setContextMenu(null);
          setShowShortcuts(false);
          setPreviewOpen(false);
        }}
        onUndo={history.undo}
        onRedo={history.redo}
        onSave={() => void onSave()}
        onDuplicate={() => void onDuplicate()}
        leftPanelOpen={leftPanelOpen}
        uiLocked={uiLocked}
        onToggleUiLock={toggleUiLock}
      />

      {mode === 'design' ? (
        previewOpen ? (
          <div className="canvas-demo-preview" data-testid="canvas-demo-preview">
            <PreviewViewport ready widthPx={A4_WIDTH_PX} heightPx={A4_HEIGHT_PX}>
              {(scale) => (
                <PageLayerPreview document={history.document} pageIndex={pageIndex} scale={scale} />
              )}
            </PreviewViewport>
          </div>
        ) : (
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <LeftSidebar
            open={leftPanelOpen}
            onHidePanel={toggleLeftPanel}
            hidePanelDisabled={uiLocked}
            documentName={history.document.name}
            docs={docs}
            documentId={history.document.id}
            layers={pageLayers}
            selectedIds={selectedIds}
            pageIndex={pageIndex}
            pageCount={getPageCount(history.document)}
            pages={history.document.pages}
            onSelect={(id, additive) => onSelect(id, additive)}
            onOpenDoc={(id) => void onOpenDoc(id)}
            onNew={() => void onNew()}
            onDeleteDoc={() => void onDeleteDoc()}
            onPageChange={setPageIndex}
            onAddPage={() => {
              const next = addPage(history.document);
              history.setDocument(next);
              setPageIndex(getPageCount(next) - 1);
            }}
            onRemovePage={(index) => {
              const next = removePage(history.document, index);
              history.setDocument(next);
              setPageIndex((prev) => {
                if (index < prev) return prev - 1;
                if (index === prev) return Math.min(prev, Math.max(0, getPageCount(next) - 1));
                return prev;
              });
            }}
            onDuplicatePage={(index) => {
              const next = duplicatePage(history.document, index);
              history.setDocument(next);
              setPageIndex(index + 1);
            }}
            onRenamePage={(index, name) => {
              history.setDocument(renamePage(history.document, index, name));
            }}
            onMoveLayer={onMoveLayer}
            onGroupSelected={() => {
              const editable = selectedIds.filter((id) => {
                const l = history.document.layers.find((x) => x.id === id);
                return l && !l.locked && l.type !== 'frame';
              });
              if (editable.length < 2) return;
              const { layers, groupId } = groupLayers(history.document.layers, editable);
              if (!groupId) return;
              setAllLayers(layers);
              setSelectedIds([groupId]);
            }}
            onUngroupSelected={() => {
              if (selectedIds.length !== 1) return;
              const layer = history.document.layers.find((l) => l.id === selectedIds[0]);
              if (!layer || layer.type !== 'group' || layer.locked) return;
              setAllLayers(ungroupLayers(history.document.layers, layer.id));
            }}
            onToggleVisible={(id, visible) => setAllLayers(setLayerVisible(history.document.layers, id, visible))}
            onToggleLocked={(id, locked) => setAllLayers(setLayerLocked(history.document.layers, id, locked))}
            onRenameLayer={(id, name) => {
              const layer = history.document.layers.find((l) => l.id === id);
              if (!layer || layer.locked || layer.type === 'frame') return;
              setAllLayers(history.document.layers.map((l) => (l.id === id ? { ...l, name } : l)));
            }}
          />
          <DesignStage
            navRef={viewportNavRef}
            document={history.document}
            pageLayers={pageLayers}
            pageIndex={pageIndex}
            selectedIds={selectedIds}
            tool={tool}
            editingLayerId={editingLayerId}
            editingSelectAll={editingSelectAll}
            pathEditingLayerId={pathEditingLayerId}
            onSelect={onSelect}
            onSelectIds={(ids) => {
              if (editingLayerId && (ids.length !== 1 || ids[0] !== editingLayerId)) {
                commitInlineEdit();
              }
              if (pathEditingLayerId && (ids.length !== 1 || ids[0] !== pathEditingLayerId)) {
                setPathEditingLayerId(null);
              }
              setSelectedIds(ids);
            }}
            onChangeLayers={setPageLayers}
            onPreviewLayers={setPageLayersLive}
            onCommitGesture={commitPageLayersGesture}
            onDrawLayer={(drawTool, rect) => {
              if (drawTool === 'select' || drawTool === 'hand' || drawTool === 'lasso' || drawTool === 'bend' || drawTool === 'cut') {
                return;
              }
              addLayerAt(drawTool, rect);
            }}
            onStartEdit={startContainerOrInlineEdit}
            onStartPathEdit={(id) => {
              setPathEditingLayerId(id);
              setSelectedIds([id]);
              setTool('select');
            }}
            onEditValue={onInlineEditValue}
            onFitTextHeight={onFitTextHeight}
            onCommitEdit={commitInlineEdit}
            onUpsertGuide={(guide) => {
              const exists = history.document.guides?.some((g) => g.id === guide.id);
              if (exists) history.updateSilent(upsertGuide(history.document, guide));
              else history.setDocument(upsertGuide(history.document, guide));
            }}
            onMoveGuide={(id, posMm) => {
              // Called once on pointerup (Artboard keeps live preview local during drag).
              history.setDocument(moveGuide(history.document, id, posMm));
            }}
            onRemoveGuide={(id) => {
              history.setDocument(removeGuide(history.document, id));
            }}
            onCancelGuideCreate={(id) => {
              // Silent: creation already pushed its history entry; aborting leaves no trace.
              history.updateSilent(removeGuide(history.document, id));
            }}
            showRulers={history.document.settings?.showRulers !== false}
            onToggleRulers={() => {
              const doc = history.document;
              history.setDocument({
                ...doc,
                settings: {
                  ...doc.settings,
                  showRulers: doc.settings?.showRulers === false,
                },
              });
            }}
            snapToGrid={Boolean(history.document.settings?.snapToGrid)}
            onToggleSnapToGrid={() => {
              const doc = history.document;
              history.setDocument({
                ...doc,
                settings: {
                  ...doc.settings,
                  snapToGrid: !doc.settings?.snapToGrid,
                },
              });
            }}
            zoomPortalTarget={zoomPortalTarget}
            zoomFallbackSlotRef={setStageZoomSlot}
            showZoomFallback={!rightPanelOpen}
            showLeftReopen={!leftPanelOpen}
            showRightReopen={!rightPanelOpen}
            onShowLeftPanel={toggleLeftPanel}
            onShowRightPanel={toggleRightPanel}
            reopenDisabled={uiLocked}
            onContextMenu={(layerId, x, y) => {
              const layer = layerId
                ? history.document.layers.find((l) => l.id === layerId)
                : null;
              setContextMenu({
                x,
                y,
                layerId,
                locked: Boolean(layer?.locked),
                visible: layer?.visible !== false,
                isContainer: Boolean(layer && isLayerContainer(layer)),
                canGroup: selectedIds.length >= 2 && (layerId ? selectedIds.includes(layerId) : false),
                canUngroup: layer?.type === 'group',
                canPaste: clipboard.length > 0,
                canMatchGridSlotSize:
                  layer?.type === 'imageSlot' &&
                  Boolean(layer.parentId) &&
                  history.document.layers.some((l) => l.id === layer.parentId && l.type === 'grid'),
                editKind: canInlineEditLayer(layer)
                  ? 'text'
                  : canFocusFieldBinding(layer)
                    ? 'field'
                    : null,
              });
            }}
          >
            {showPathToolbar && (
              <PathEditToolbar
                tool={tool}
                onTool={(t) => {
                  setTool(t);
                  if (t !== 'select' && selectedLine) {
                    setPathEditingLayerId(selectedLine.id);
                  }
                }}
                canClosePath={Boolean(pathToolbarLine && (pathToolbarLine.meta?.path?.points.length ?? 0) >= 3)}
                pathClosed={Boolean(pathToolbarLine?.meta?.path?.closed)}
                onToggleClosed={() => {
                  if (!pathToolbarLine) return;
                  setPageLayers(
                    pageLayers.map((l) => (l.id === pathToolbarLine.id ? toggleLineClosed(l) : l)),
                  );
                }}
              />
            )}
            <BottomToolbar tool={tool} onTool={setTool} />
            {showShortcuts && (
              <div className="canvas-shortcuts-panel" data-testid="canvas-shortcuts-panel">
                <div className="canvas-section-title mb-2 flex items-center justify-between">
                  <span>Atajos</span>
                  <WithHoverTooltip label="Cerrar" placement="left" variant="dark">
                    <button
                      type="button"
                      className="canvas-icon-btn !h-6 !w-6"
                      onClick={() => setShowShortcuts(false)}
                      aria-label="Cerrar"
                    >
                      ×
                    </button>
                  </WithHoverTooltip>
                </div>
                <ul className="space-y-1">
                  {CANVAS_SHORTCUTS.map((row) => (
                    <li key={row.keys} className="flex items-baseline justify-between gap-3 text-[11px]">
                      <kbd className="canvas-kbd shrink-0">{row.keys}</kbd>
                      <span className="min-w-0 flex-1 text-right" style={{ color: 'var(--cv-text-secondary)' }}>
                        {row.action}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {contextMenu && (
              <ContextMenu
                menu={contextMenu}
                onAction={onContextAction}
                onClose={() => setContextMenu(null)}
              />
            )}
          </DesignStage>
          <RightPanel
            open={rightPanelOpen}
            onHidePanel={toggleRightPanel}
            hidePanelDisabled={uiLocked}
            layer={selected}
            selectedCount={selectedIds.length}
            selectedIds={selectedIds}
            pageColors={pageColors}
            onChange={(layer) => {
              if (panelBaselineRef.current) onPanelCommitLive();
              const prev = history.document.layers.find((l) => l.id === layer.id);
              let layers = history.document.layers.map((l) => (l.id === layer.id ? layer : l));
              // Only cols/rows/gap rebuild touches siblings. Slot W/H edits stay per-cell.
              if (layer.type === 'grid') {
                layers = rebuildGridSlots(layers, layer.id);
              }
              const synced = syncLinkedStylesFromLayer(
                { ...history.document, layers },
                prev,
                layer,
              );
              history.setDocument(syncImagesPerPage(synced));
            }}
            onChangeLive={onPanelChangeLive}
            onCommitLive={onPanelCommitLive}
            onDelete={onDeleteLayer}
            onAlign={onAlign}
            onDistribute={onDistribute}
            documentStyles={history.document.styles ?? []}
            onCreateStyle={(kind: CanvasStyleKind) => {
              if (selectedIds.length !== 1) return;
              if (panelBaselineRef.current) onPanelCommitLive();
              history.setDocument(createAndLinkStyle(history.document, selectedIds[0]!, kind));
            }}
            onApplyStyle={(styleId) => {
              if (!selectedIds.length) return;
              if (panelBaselineRef.current) onPanelCommitLive();
              const style = (history.document.styles ?? []).find((s) => s.id === styleId);
              if (!style) return;
              history.setDocument({
                ...history.document,
                layers: applyStyleToLayers(history.document.layers, style, selectedIds),
              });
            }}
            onDetachStyle={(kind) => {
              if (!selectedIds.length) return;
              if (panelBaselineRef.current) onPanelCommitLive();
              history.setDocument({
                ...history.document,
                layers: detachStyleOnLayers(history.document.layers, kind, selectedIds),
              });
            }}
            onRemoveStyle={(styleId) => {
              if (panelBaselineRef.current) onPanelCommitLive();
              history.setDocument(removeStyle(history.document, styleId));
            }}
            onRenameStyle={(styleId, name) => {
              if (panelBaselineRef.current) onPanelCommitLive();
              history.setDocument(updateStyle(history.document, styleId, { name }));
            }}
            onNudgeSelection={(dx, dy) => {
              if (!dx && !dy) return;
              if (panelBaselineRef.current) onPanelCommitLive();
              setAllLayers(nudgeLayers(history.document.layers, editableSelectedIds, dx, dy));
            }}
            selectionOrigin={
              editableSelectedIds.length > 1
                ? (() => {
                    const b = selectionBounds(history.document.layers, editableSelectedIds);
                    return b ? { x: b.x, y: b.y } : null;
                  })()
                : null
            }
            onBulkVisible={(visible) =>
              setAllLayers(setLayersVisible(history.document.layers, editableSelectedIds, visible))
            }
            onBulkLocked={(locked) =>
              setAllLayers(setLayersLocked(history.document.layers, editableSelectedIds, locked))
            }
            onBulkOpacity={(opacity) =>
              setAllLayers(setLayersOpacity(history.document.layers, editableSelectedIds, opacity))
            }
            bulkOpacityValue={(() => {
              const sel = history.document.layers.filter((l) => editableSelectedIds.includes(l.id));
              if (sel.length === 0) return undefined;
              const first = sel[0].cssVars['--opacity'];
              const allSame = sel.every((l) => l.cssVars['--opacity'] === first);
              if (!allSame) return null;
              const n = Number(first ?? '100');
              return Number.isFinite(n) ? clampOpacity(n) : undefined;
            })()}
            onBringFront={() => setAllLayers(bringToFront(history.document.layers, selectedIds))}
            onBringForward={() => setAllLayers(bringForward(history.document.layers, selectedIds))}
            onSendBack={() => setAllLayers(sendToBack(history.document.layers, selectedIds))}
            onSendBackward={() => setAllLayers(sendBackward(history.document.layers, selectedIds))}
            onApplyPreset={onApplyPreset}
            logoSideConflict={
              Boolean(selected?.type === 'logo' && logoSideHasConflict(history.document.layers, selected.id))
            }
            zoomSlotRef={setRightZoomSlot}
          />
        </div>
        )
      ) : (
        <Suspense fallback={<div className="canvas-app canvas-loading">Cargando generador…</div>}>
          <GeneratePanel document={history.document} />
        </Suspense>
      )}
    </div>
  );
}
