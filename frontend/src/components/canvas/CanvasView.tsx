import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import './canvas.css';
import { createLayer } from './constants';
import type { CanvasPreset } from './presets/loadPresets';
import { queueCanvasCloudPush } from './sync/cloudQueue';
import { isNewer, type SyncConflict } from './sync/syncCompare';
import type { SyncConflictChoice } from './hooks/useCanvasSync';
import SyncConflictBar from './editor/SyncConflictBar';
import SyncStatusBadge from './editor/SyncStatusBadge';
import CanvasPresenceBadge from './editor/CanvasPresenceBadge';
import BottomToolbar from './editor/BottomToolbar';
import ContextMenu, { type CanvasContextMenuState } from './editor/ContextMenu';
import CommandPalette from './editor/CommandPalette';
import DesignStage, { type ViewportNavApi } from './editor/DesignStage';
import LeftSidebar from './editor/LeftSidebar';
import PreviewViewport from './editor/PreviewViewport';
import PageLayerPreview from './editor/PageLayerPreview';
import PathEditToolbar from './editor/PathEditToolbar';
import RightPanel from './editor/RightPanel';
import TopBar from './editor/TopBar';
import PdfImportOptionsDialog from './editor/PdfImportOptionsDialog';
import TemplatePickerModal from './editor/TemplatePickerModal';
import PdfImportStatus from './editor/PdfImportStatus';
import { useCanvasHistory } from './hooks/useCanvasHistory';
import { useCanvasBootstrap } from './hooks/useCanvasBootstrap';
import { useDocumentLifecycle } from './hooks/useDocumentLifecycle';
import { isOpenDocumentDirty, useCanvasSync } from './hooks/useCanvasSync';
import { useGestureBaselines } from './hooks/useGestureBaselines';
import { useInlineEdit } from './hooks/useInlineEdit';
import { useCanvasQuitFlush } from './hooks/useCanvasQuitFlush';
import { useCanvasCommandPalette } from './hooks/useCanvasCommandPalette';
import { useCanvasKeyboard } from './hooks/useCanvasKeyboard';
import { createCanvasContextActionHandler } from './hooks/canvasContextActions';
import { CANVAS_SHORTCUTS } from './shortcuts';
import {
  hydrateDocumentImages,
  serializeDocumentImages,
  clearBlobStore,
  collectImageRefsFromHistory,
  collectImageRefsFromLayers,
  registerImageBlob,
  releaseImageBlob,
  sweepOrphanBlobs,
  trackImageRef,
} from './utils/imageBlobStore';
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
  applyContainerLayoutPanelEffects,
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
  filterSelectionToPage,
  getPageCount,
  indexLayersByPage,
  removePage,
  renamePage,
  reorderPage,
  setActivePageLayers,
  syncImagesPerPage,
} from './ops/pages';
import { applyGridToImageSlots, applyLivePanelLayerChange } from './ops/gridLayout';
import { assignUniqueLogoSides, logoSideHasConflict, withAssignedLogoSide } from './ops/logoSide';
import { isClickPlace, placeRectCssVars, type DrawRect } from './ops/drawHelpers';
import { moveGuide, removeGuide, upsertGuide } from './ops/guides';
import { selectionBounds } from './ops/selectionTransform';
import { instantiateComponent, bakeInstanceOverrides, findComponentMaster, syncComponentFromLayer } from './ops/components';
import { buildSpatialIndex } from './ops/spatialIndex';
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
  readToolbarPosition,
  readBoolLS,
  readLeftPanelWidth,
  type CanvasToolbarPosition,
  writeToolbarPosition,
  writeBoolLS,
  writeLeftPanelWidth,
} from './ops/panelChrome';
import { canFocusFieldBinding, canInlineEditLayer } from './ops/inlineEdit';
import {
  createClipboardCopyCoordinator,
  parseClipboardLayers,
  pasteToReplaceLayers,
  writeClipboardLayersText,
  type ClipboardCopyCoordinator,
} from './ops/clipboardLayers';
import { cloneDocument } from './ops/document';
import { autosaveDelayForDoc } from './utils/autosave';
import { usePdfImport } from './hooks/usePdfImport';
import {
  A4_HEIGHT_PX,
  A4_WIDTH_PX,
  createEmptyDocument,
  normalizeDocument,
  type CanvasDocument,
  type CanvasDocumentSummary,
  type CanvasGuide,
  type CanvasLayer,
  type CanvasLayerType,
  type CanvasMode,
  type CanvasStyleKind,
  type CanvasTool,
  type LayerCssVars,
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

export default function CanvasView({ active = true }: { active?: boolean }) {
  const history = useCanvasHistory(createEmptyDocument('Sin título'));
  const {
    documentRef: historyDocRef,
    setDocument: setHistoryDocument,
    updateSilent: updateHistorySilent,
    commitFromBaseline: commitHistoryFromBaseline,
  } = history;
  const historyReadyRef = useRef(false);
  const restoreGenerationRef = useRef(0);

  const openDirtyRef = useRef(false);
  const [mode, setMode] = useState<CanvasMode>('design');
  const [docs, setDocs] = useState<CanvasDocumentSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const selectedIdsRef = useRef(selectedIds);
  const pageIndexRef = useRef(pageIndex);
  selectedIdsRef.current = selectedIds;
  pageIndexRef.current = pageIndex;
  const viewportNavRef = useRef<ViewportNavApi | null>(null);
  const [rightZoomSlot, setRightZoomSlot] = useState<HTMLDivElement | null>(null);
  const [stageZoomSlot, setStageZoomSlot] = useState<HTMLDivElement | null>(null);
  const [leftPanelOpen, setLeftPanelOpen] = useState(() => readBoolLS(PANEL_CHROME_KEYS.left, true));
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => readLeftPanelWidth(PANEL_CHROME_KEYS.leftWidth));
  const [rightPanelOpen, setRightPanelOpen] = useState(() => readBoolLS(PANEL_CHROME_KEYS.right, true));
  const [uiLocked, setUiLocked] = useState(() => readBoolLS(PANEL_CHROME_KEYS.lock, false));
  const [toolbarPosition, setToolbarPosition] = useState<CanvasToolbarPosition>(() =>
    readToolbarPosition(PANEL_CHROME_KEYS.toolbar, 'top'),
  );
  const [tool, setTool] = useState<CanvasTool>('select');
  const toolBeforeSpaceRef = useRef<CanvasTool | null>(null);
  const [clipboard, setClipboard] = useState<CanvasLayer[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const propsClipboardRef = useRef<Partial<LayerCssVars> | null>(null);
  const [enteredGroupId, setEnteredGroupId] = useState<string | null>(null);
  const [eyedropperActive, setEyedropperActive] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [renameRequest, setRenameRequest] = useState<{ layerId: string; nonce: number } | null>(null);
  const [pathEditingLayerId, setPathEditingLayerId] = useState<string | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedId = selectedIds[0] ?? null;
  const layersByPage = useMemo(
    () => indexLayersByPage(history.document.layers),
    [history.document.layers],
  );
  const pageLayers = useMemo(
    () => layersByPage.get(pageIndex) ?? [],
    [layersByPage, pageIndex],
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

  const pdfImport = usePdfImport({
    history,
    flashStatus,
    setSelectedIds,
    setPageIndex,
  });

  useEffect(() => {
    writeBoolLS(PANEL_CHROME_KEYS.left, leftPanelOpen);
  }, [leftPanelOpen]);
  useEffect(() => {
    writeBoolLS(PANEL_CHROME_KEYS.right, rightPanelOpen);
  }, [rightPanelOpen]);
  useEffect(() => {
    writeBoolLS(PANEL_CHROME_KEYS.lock, uiLocked);
  }, [uiLocked]);
  useEffect(() => {
    writeToolbarPosition(PANEL_CHROME_KEYS.toolbar, toolbarPosition);
  }, [toolbarPosition]);
  useEffect(() => {
    writeLeftPanelWidth(PANEL_CHROME_KEYS.leftWidth, leftPanelWidth);
  }, [leftPanelWidth]);

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
    }
  }, []);

  const guideCreateBaselineRef = useRef<CanvasDocument | null>(null);

  const onDeleteDocRef = useRef<() => Promise<void>>(async () => {});

  const [syncConflict, setSyncConflict] = useState<SyncConflict | null>(null);
  const syncConflictRef = useRef<SyncConflict | null>(null);
  const dismissedRemoteAtRef = useRef<string | null>(null);

  const handleConflict = useCallback((conflict: SyncConflict) => {
    if (syncConflictRef.current) return;
    if (
      dismissedRemoteAtRef.current &&
      !isNewer(conflict.remoteUpdatedAt, dismissedRemoteAtRef.current)
    ) {
      return;
    }

    syncConflictRef.current = conflict;
    setSyncConflict({
      ...conflict,
      localDoc: { ...conflict.localDoc, layers: [] },
      remoteDoc: conflict.remoteDoc
        ? { ...conflict.remoteDoc, layers: [] }
        : null,
    });
  }, []);

  const handleRemoteDocumentApplied = useCallback((document: CanvasDocument) => {
    const validLayerIds = new Set(document.layers.map((layer) => layer.id));
    setSelectedIds((ids) => ids.filter((id) => validLayerIds.has(id)));
    setPageIndex((index) => Math.min(Math.max(0, index), Math.max(0, getPageCount(document) - 1)));
  }, []);

  const {
    panelBaselineRef,
    gestureBaselineRef,
    setPageLayersLive,
    commitPageLayersGesture,
    cancelPageLayersGesture,
    onPanelChangeLive,
    onPanelChangeLayersLive,
    onPanelCommitLive,
  } = useGestureBaselines({ history, pageIndex });

  const renameBaselineRef = useRef<typeof history.document | null>(null);

  openDirtyRef.current = isOpenDocumentDirty(
    history.hasUnsavedEditsRef.current,
    panelBaselineRef.current != null,
    gestureBaselineRef.current != null,
    renameBaselineRef.current != null,
  );

  const onConflictResolve = useCallback(
    (choice: SyncConflictChoice) => {
      const conflict = syncConflictRef.current;
      syncConflictRef.current = null;
      setSyncConflict(null);
      if (!conflict) return;

      if (choice === 'keep-local') {
        dismissedRemoteAtRef.current = conflict.remoteUpdatedAt;
        void (async () => {
          try {

            const mem =
              historyDocRef.current.id === conflict.localDoc.id
                ? historyDocRef.current
                : conflict.localDoc;
            const serialized = await serializeDocumentImages(mem);
            const res = await api.canvasSave(serialized, { touch: true });
            const saved = normalizeDocument(res.document as CanvasDocument);
            await queueCanvasCloudPush(saved, { forceResurrect: true });
            await refreshList();
          } catch {
            dismissedRemoteAtRef.current = null;
            syncConflictRef.current = null;
            handleConflict(conflict);
            flashStatus('No se pudo conservar la versión local', 4000);
          }
        })();
        return;
      }

      if (conflict.remoteDeleted) {
        dismissedRemoteAtRef.current = null;
        void onDeleteDocRef.current();
        return;
      }

      dismissedRemoteAtRef.current = null;
      void (async () => {
        try {
          const hydrated = await hydrateDocumentImages(conflict.remoteDoc!, { strict: true });
          await api.canvasSave(conflict.remoteDoc!, { touch: false });
          history.replaceDocument(hydrated);
          handleRemoteDocumentApplied(hydrated);
          await refreshList();
        } catch {
          syncConflictRef.current = null;
          handleConflict(conflict);
          flashStatus('No se pudo aplicar la versión de la nube', 4000);
        }
      })();
    },
    [handleConflict, handleRemoteDocumentApplied, history, refreshList, flashStatus],
  );

  const { runCloudSync, syncing: docsSyncing, syncStatus, realtimeStatus, collaborators } = useCanvasSync({
    historyDocRef,
    openDirtyRef,
    refreshList,
    replaceDocument: history.replaceDocument,
    onConflict: handleConflict,
    active,
    documentId: history.document.id,
    documentReady: !loading,
    openDirty: openDirtyRef.current,
    initialGuarded: true,
    onRemoteDocumentApplied: handleRemoteDocumentApplied,
  });

  useEffect(() => {
    if (!syncConflictRef.current) return;
    if (syncConflictRef.current.localDoc.id === history.document.id) return;
    syncConflictRef.current = null;
    setSyncConflict(null);
    dismissedRemoteAtRef.current = null;
  }, [history.document.id]);

  useCanvasBootstrap({
    replaceDocument: history.replaceDocument,
    restoreHistory: history.restoreHistory,
    historyReadyRef,
    restoreGenerationRef,
    currentDocumentRef: history.documentRef,
    currentRevisionRef: history.revisionRef,
    setDocs,
    setLoading,
    runCloudSync,
  });

  const {
    onSave,
    onOpenDoc,
    onNew,
    onDuplicate,
    onDeleteDoc,
    lastSaveRetryAfterMsRef,
  } = useDocumentLifecycle({
    history,
    refreshList,
    flashStatus,
    setStatus,
    setSelectedIds,
    setPageIndex,
    setDocs,
    resetViewportPan,
    dismissedRemoteAtRef,
    historyReadyRef,
    restoreGenerationRef,
  });

  const setPageLayers = useCallback(
    (layers: CanvasLayer[]) => {
      setHistoryDocument(
        syncImagesPerPage(setActivePageLayers(historyDocRef.current, pageIndexRef.current, layers)),
      );
    },
    [historyDocRef, setHistoryDocument],
  );

  const setAllLayers = useCallback(
    (layers: CanvasLayer[]) => {
      setHistoryDocument(syncImagesPerPage({ ...historyDocRef.current, layers }));
    },
    [historyDocRef, setHistoryDocument],
  );

  const [gestureAbortToken, setGestureAbortToken] = useState(0);

  const autosavePendingRef = useRef(false);
  const autosaveRetryTimerRef = useRef<number | null>(null);
  const autosaveUnmountedRef = useRef(false);
  const flushAutosaveRef = useRef<() => void>(() => {});
  const flushAutosave = useCallback(() => {
    if (!history.hasUnsavedEditsRef.current) return;
    if (autosavePendingRef.current) return;
    autosavePendingRef.current = true;
    const revisionAtStart = history.revisionRef.current;
    onSave({ silent: true }).finally(() => {
      autosavePendingRef.current = false;
      if (!history.hasUnsavedEditsRef.current || autosaveUnmountedRef.current) return;
      const retryAfterMs = lastSaveRetryAfterMsRef.current;
      const changedDuringSave = history.revisionRef.current !== revisionAtStart;
      if (retryAfterMs == null && !changedDuringSave) return;
      if (autosaveRetryTimerRef.current != null) return;
      const delay = Math.max(autosaveDelayForDoc(history.documentRef.current), retryAfterMs ?? 0);
      autosaveRetryTimerRef.current = window.setTimeout(() => {
        autosaveRetryTimerRef.current = null;
        flushAutosaveRef.current();
      }, delay);
    });
  }, [history.hasUnsavedEditsRef, history.revisionRef, history.documentRef, lastSaveRetryAfterMsRef, onSave]);
  flushAutosaveRef.current = flushAutosave;

  useEffect(() => {
    if (!active) return;
    if (!history.hasUnsavedEditsRef.current) return;
    if (autosavePendingRef.current) return;
    const delay = autosaveDelayForDoc(history.document);
    const timer = window.setTimeout(() => flushAutosaveRef.current(), delay);
    return () => window.clearTimeout(timer);
  }, [active, history.document, history.hasUnsavedEdits, history.hasUnsavedEditsRef]);

  useEffect(() => {
    if (active) return;
    flushAutosaveRef.current();
  }, [active]);

  useEffect(() => {
    autosaveUnmountedRef.current = false;
    return () => {
      autosaveUnmountedRef.current = true;
      if (autosaveRetryTimerRef.current != null) {
        window.clearTimeout(autosaveRetryTimerRef.current);
        autosaveRetryTimerRef.current = null;
      }
      flushAutosaveRef.current();
    };
  }, []);
  const clipboardCoordinatorRef = useRef<ClipboardCopyCoordinator | null>(null);
  if (!clipboardCoordinatorRef.current) {
    clipboardCoordinatorRef.current = createClipboardCopyCoordinator(
      (layers) => setClipboard(layers),
      (layers) => {
        setClipboard(layers);
        writeClipboardLayersText(layers);
      },
      releaseImageBlob,
    );
  }

  useEffect(() => () => {
    clipboardCoordinatorRef.current?.invalidate();
    clearBlobStore();
  }, []);

  useEffect(() => {
    const live = collectImageRefsFromLayers(history.document.layers);
    for (const ref of collectImageRefsFromHistory(history.past)) live.add(ref);
    for (const ref of collectImageRefsFromHistory(history.future)) live.add(ref);
    for (const layer of clipboard) {
      if (layer.type === 'image' || layer.type === 'logo') trackImageRef(live, layer.value);
    }
    const conflict = syncConflictRef.current;
    if (conflict) {
      for (const ref of collectImageRefsFromLayers(conflict.localDoc.layers)) live.add(ref);
      if (conflict.remoteDoc) {
        for (const ref of collectImageRefsFromLayers(conflict.remoteDoc.layers)) live.add(ref);
      }
    }
    sweepOrphanBlobs(live);
  }, [history.document, history.past, history.future, clipboard]);

  const onBeforeUnload = useCallback(
    (e: BeforeUnloadEvent) => {
      if (!history.hasUnsavedEditsRef.current) return;
      if (!autosavePendingRef.current) {
        autosavePendingRef.current = true;
        onSave({ silent: true }).finally(() => {
          autosavePendingRef.current = false;
        });
      }

      e.preventDefault();
      e.returnValue = '';
    },
    [onSave],
  );
  useEffect(() => {
    if (!active) return;
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active, onBeforeUnload]);

  useCanvasQuitFlush({
    history,
    editingLayerId,
    commitInlineEdit,
    commitPageLayersGesture,
    onPanelCommitLive,
    onSave,
    panelBaselineRef,
    gestureBaselineRef,
    renameBaselineRef,
    openDirtyRef,
  });

  const sealPanelAndAbortGesture = useCallback(() => {
    if (panelBaselineRef.current) onPanelCommitLive();
    const cancelled = cancelPageLayersGesture();
    setGestureAbortToken((n) => n + 1);
    return cancelled;
  }, [cancelPageLayersGesture, onPanelCommitLive, panelBaselineRef]);

  const runHistoryOp = useCallback(
    (op: 'undo' | 'redo') => {
      if (gestureBaselineRef.current) {
        cancelPageLayersGesture();
        setGestureAbortToken((n) => n + 1);
        return;
      }
      if (panelBaselineRef.current) onPanelCommitLive();
      setGestureAbortToken((n) => n + 1);
      if (op === 'undo') history.undo();
      else history.redo();
    },
    [cancelPageLayersGesture, gestureBaselineRef, history, onPanelCommitLive, panelBaselineRef],
  );

  const runUndo = useCallback(() => runHistoryOp('undo'), [runHistoryOp]);
  const runRedo = useCallback(() => runHistoryOp('redo'), [runHistoryOp]);

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

  const onSelect = useCallback((id: string | null, additive = false) => {
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
  }, [editingLayerId, pathEditingLayerId, commitInlineEdit, onPanelCommitLive, panelBaselineRef]);

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

        if (layer.type === 'grid') {
          setTool('select');
          setContextMenu(null);
          return;
        }
        setEnteredGroupId(id);
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

  const applyPasteLayers = useCallback(
    (source: CanvasLayer[], offsetMm?: number) => {
      if (!source.length) return;
      const withIds = source.map((l) => ({ ...l, pageIndex }));
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
    [history.document.layers, pageIndex, setAllLayers],
  );

  const pasteClipboard = useCallback(
    async (offsetMm?: number) => {
      if (clipboard.length) {
        applyPasteLayers(clipboard, offsetMm);
        return;
      }
      try {
        const text = await navigator.clipboard?.readText?.();
        const parsed = text ? parseClipboardLayers(text) : null;
        if (!parsed?.length) return;
        setClipboard(parsed);
        applyPasteLayers(parsed, offsetMm);
      } catch {
      }
    },
    [applyPasteLayers, clipboard],
  );

  const pasteReplaceClipboard = useCallback(async (targetIds?: string[]) => {
    const targets = (targetIds ?? selectedIds).filter((id) => {
      const layer = history.document.layers.find((l) => l.id === id);
      return layer && !layer.locked && layer.type !== 'frame';
    });
    if (!targets.length) return;
    let src = clipboard;
    if (!src.length) {
      try {
        const text = await navigator.clipboard?.readText?.();
        src = (text ? parseClipboardLayers(text) : null) ?? [];
      } catch {
        src = [];
      }
    }
    if (!src.length) return;
    sealPanelAndAbortGesture();
    const result = pasteToReplaceLayers(history.document.layers, src, targets);
    if (!result) return;
    setAllLayers(assignUniqueLogoSides(result.layers, result.newIds));
    setSelectedIds(result.newIds);
  }, [clipboard, selectedIds, history.document.layers, sealPanelAndAbortGesture]);

  const onEyedropperPick = useCallback(
    (color: string) => {
      setEyedropperActive(false);
      const idSet = new Set(
        selectedIds.filter((id) => {
          const layer = history.document.layers.find((l) => l.id === id);
          return layer && !layer.locked && layer.type !== 'frame';
        }),
      );
      if (!idSet.size) return;
      sealPanelAndAbortGesture();
      const layers = history.document.layers.map((l) => {
        if (!idSet.has(l.id)) return l;
        const textish = l.type === 'text' || l.type === 'field';
        const cssVars: LayerCssVars = { ...l.cssVars };
        if (textish) cssVars['--color'] = color;
        else {
          cssVars['--background-color'] = color;
          cssVars['--fill-visible'] = '1';
        }
        let next = { ...l, cssVars };
        if (l.meta?.instanceOf) {
          const master = findComponentMaster(history.document.layers, l.meta.instanceOf);
          if (master) next = bakeInstanceOverrides(next, master);
        }
        return next;
      });
      setAllLayers(layers);
    },
    [selectedIds, history.document.layers, sealPanelAndAbortGesture],
  );

  const copyLayersToClipboard = useCallback((layers: CanvasLayer[]) => {
    const copies = layers.map((l) => ({ ...l, cssVars: { ...l.cssVars } }));
    clipboardCoordinatorRef.current?.copy(copies, async () => {
      const createdUrls: string[] = [];
      const rewritten = await Promise.all(
        copies.map(async (l) => {
          if (
            (l.type === 'image' || l.type === 'logo') &&
            typeof l.value === 'string' &&
            l.value.startsWith('data:')
          ) {
            try {
              const res = await fetch(l.value);
              const blob = await res.blob();
              const reg = await registerImageBlob(blob);
              createdUrls.push(reg.url);
              return { ...l, value: reg.url };
            } catch {
              return l;
            }
          }
          return l;
        }),
      );
      return { layers: rewritten, createdUrls };
    });
  }, []);

  const onKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => onKeyDownRef.current(e);
    const onKeyUp = (e: KeyboardEvent) => {
      if (mode !== 'design') return;
      if (e.code === 'Space') {
        const prev = toolBeforeSpaceRef.current;
        toolBeforeSpaceRef.current = null;
        if (prev) setTool(prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [mode, active]);

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

  const addLayerAt = useCallback((type: PlaceableTool, rect: DrawRect) => {
    const document = historyDocRef.current;
    const layerType = type as Exclude<CanvasLayerType, 'frame' | 'group' | 'component'>;
    let layer = createLayer(layerType);
    if (layerType === 'logo') {
      layer = withAssignedLogoSide(layer, document.layers);
    }
    layer.pageIndex = pageIndexRef.current;
    const defaults = DEFAULT_SIZES[type] ?? { w: 40, h: 30 };
    const useDefault = isClickPlace(rect) || (rect.w === 0 && rect.h === 0);
    const w = useDefault ? defaults.w : Math.max(type === 'line' ? 1 : 4, rect.w);
    const h = useDefault ? defaults.h : Math.max(4, rect.h);
    const x = useDefault ? rect.x : rect.x;
    const y = useDefault ? rect.y : rect.y;
    layer.cssVars = {
      ...layer.cssVars,
      ...placeRectCssVars(x, y, w, h),
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
    let layers = [...document.layers, layer];
    if (type === 'grid') {
      const slots: CanvasLayer[] = [];
      const cols = layer.meta?.cols ?? 2;
      const rows = layer.meta?.rows ?? 2;
      for (let i = 0; i < cols * rows; i += 1) {
        const slot = createLayer('imageSlot', {
          name: `Foto ${i + 1}`,
          pageIndex: pageIndexRef.current,
          parentId: layer.id,
          meta: { index: i },
        });
        slots.push(slot);
      }
      layers = applyGridToImageSlots([...layers, ...slots], layer.id);
    }
    setHistoryDocument(
      syncImagesPerPage({
        ...document,
        layers,
        fields:
          type === 'field' && layer.meta?.key
            ? [
                ...document.fields.filter((f) => f.key !== layer.meta!.key),
                { id: newId(), key: layer.meta.key, label: layer.meta.key },
              ]
            : document.fields,
      }),
    );
    setSelectedIds([layer.id]);
    setTool('select');
    if (type === 'text') {
      beginEditWithBaseline(cloneDocument({ ...document, layers }), layer.id);
    }
    flashStatus(`Capa «${layer.name}» creada`, 1500);
  }, [beginEditWithBaseline, flashStatus, historyDocRef, setHistoryDocument]);

  const onStageDrawLayer = useCallback(
    (drawTool: CanvasTool, rect: DrawRect) => {
      if (drawTool === 'select' || drawTool === 'hand' || drawTool === 'lasso' || drawTool === 'bend' || drawTool === 'cut') {
        return;
      }
      addLayerAt(drawTool, rect);
    },
    [addLayerAt],
  );

  const onStageStartPathEdit = useCallback((id: string) => {
    setPathEditingLayerId(id);
    setSelectedIds([id]);
    setTool('select');
  }, []);

  const onStageUpsertGuide = useCallback(
    (guide: CanvasGuide) => {
      const doc = historyDocRef.current;
      const exists = doc.guides?.some((g) => g.id === guide.id);
      if (!exists) {
        guideCreateBaselineRef.current = doc;
      }
      updateHistorySilent(upsertGuide(doc, guide));
    },
    [historyDocRef, updateHistorySilent],
  );

  const onStageCommitGuideCreate = useCallback(
    (guide: CanvasGuide) => {
      const baseline = guideCreateBaselineRef.current;
      guideCreateBaselineRef.current = null;
      const next = upsertGuide(historyDocRef.current, guide);
      if (baseline) {
        updateHistorySilent(next);
        commitHistoryFromBaseline(baseline);
      } else {
        setHistoryDocument(next);
      }
    },
    [commitHistoryFromBaseline, historyDocRef, setHistoryDocument, updateHistorySilent],
  );

  const onStageMoveGuide = useCallback(
    (id: string, posMm: number) => {
      setHistoryDocument(moveGuide(historyDocRef.current, id, posMm));
    },
    [historyDocRef, setHistoryDocument],
  );

  const onStageRemoveGuide = useCallback(
    (id: string) => {
      setHistoryDocument(removeGuide(historyDocRef.current, id));
    },
    [historyDocRef, setHistoryDocument],
  );

  const onStageCancelGuideCreate = useCallback(
    (id: string) => {
      guideCreateBaselineRef.current = null;
      updateHistorySilent(removeGuide(historyDocRef.current, id));
    },
    [historyDocRef, updateHistorySilent],
  );

  const onToggleRulers = useCallback(() => {
    const doc = historyDocRef.current;
    setHistoryDocument({
      ...doc,
      settings: {
        ...doc.settings,
        showRulers: doc.settings?.showRulers === false,
      },
    });
  }, [historyDocRef, setHistoryDocument]);

  const onToggleSnapToGrid = useCallback(() => {
    const doc = historyDocRef.current;
    setHistoryDocument({
      ...doc,
      settings: {
        ...doc.settings,
        snapToGrid: !doc.settings?.snapToGrid,
      },
    });
  }, [historyDocRef, setHistoryDocument]);

  const onExitGroupEdit = useCallback(() => setEnteredGroupId(null), []);

  const onStageContextMenu = useCallback(
    (layerId: string | null, x: number, y: number, pointMm?: { x: number; y: number }) => {
      const doc = historyDocRef.current;
      const sel = selectedIdsRef.current;
      const pageIdx = pageIndexRef.current;
      const pageLayersNow = indexLayersByPage(doc.layers).get(pageIdx) ?? [];
      const layer = layerId ? doc.layers.find((l) => l.id === layerId) : null;
      const pageCount = getPageCount(doc);
      const underCursor = pointMm
        ? buildSpatialIndex(pageLayersNow)
            .hitTest(pointMm.x, pointMm.y)
            .map((id) => doc.layers.find((l) => l.id === id))
            .filter((l): l is CanvasLayer => Boolean(l))
            .map((l) => ({ id: l.id, name: l.name }))
        : undefined;
      setContextMenu({
        x,
        y,
        layerId,
        locked: Boolean(layer?.locked),
        visible: layer?.visible !== false,
        isContainer: Boolean(layer && isLayerContainer(layer)),
        canGroup: sel.length >= 2 && (layerId ? sel.includes(layerId) : false),
        canUngroup: layer?.type === 'group' || layer?.type === 'component',
        canPaste: true,
        canPasteProps: Boolean(propsClipboardRef.current),
        hasParent: Boolean(layer?.parentId),
        underCursor,
        pageTargets:
          pageCount > 1
            ? Array.from({ length: pageCount }, (_, i) => i)
                .filter((i) => i !== pageIdx)
                .map((i) => ({
                  index: i,
                  label: doc.pages?.[i]?.name ?? `Página ${i + 1}`,
                }))
            : undefined,
        canMatchGridSlotSize:
          layer?.type === 'imageSlot' &&
          Boolean(layer.parentId) &&
          doc.layers.some((l) => l.id === layer.parentId && l.type === 'grid'),
        editKind: canInlineEditLayer(layer)
          ? 'text'
          : canFocusFieldBinding(layer)
            ? 'field'
            : null,
        refIsText: layer?.type === 'text' || layer?.type === 'field',
      });
    },
    [],
  );

  const onRename = (name: string) => {
    history.updateSilent({ ...history.document, name });
    setDocs((prev) => {
      const next = prev.map((d) => (d.id === history.document.id ? { ...d, name } : d));
      if (next.some((d) => d.id === history.document.id)) return next;
      return [...next, { id: history.document.id, name }];
    });
  };

  const onRenameStart = () => {
    renameBaselineRef.current = history.document;
    openDirtyRef.current = true;
  };
  const onRenameCommit = () => {
    const baseline = renameBaselineRef.current;
    renameBaselineRef.current = null;
    if (!baseline || baseline.name === history.document.name) {
      openDirtyRef.current = isOpenDocumentDirty(
        history.hasUnsavedEditsRef.current,
        panelBaselineRef.current != null,
        gestureBaselineRef.current != null,
        false,
      );
      return;
    }
    history.commitFromBaseline(baseline);
  };

  const onApplyPreset = (preset: CanvasPreset) => {
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

  const onContextAction = createCanvasContextActionHandler({
    contextMenu,
    selectedIds,
    pageLayers,
    document: history.document,
    setDocument: history.setDocument,
    pasteClipboard,
    pasteReplaceClipboard,
    copyLayersToClipboard,
    sealPanelAndAbortGesture,
    startContainerOrInlineEdit,
    setSelectedIds,
    setEyedropperActive,
    setAllLayers,
    propsClipboardRef,
  });

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

  const selectedContentIds = useMemo(
    () => selectedIds.filter((id) => {
      const layer = history.document.layers.find((l) => l.id === id);
      return layer && layer.type !== 'frame';
    }),
    [selectedIds, history.document.layers],
  );

  const selectedContentIdSet = useMemo(
    () => new Set(selectedContentIds),
    [selectedContentIds],
  );

  const selectionOrigin = useMemo(() => {
    if (selectedContentIds.length <= 1) return null;
    const b = selectionBounds(history.document.layers, selectedContentIds);
    return b ? { x: b.x, y: b.y } : null;
  }, [history.document.layers, selectedContentIds]);

  const bulkOpacityValue = useMemo(() => {
    const sel = history.document.layers.filter((l) => selectedContentIdSet.has(l.id));
    if (sel.length === 0) return undefined;
    const first = sel[0].cssVars['--opacity'];
    const allSame = sel.every((l) => l.cssVars['--opacity'] === first);
    if (!allSame) return null;
    const n = Number(first ?? '100');
    return Number.isFinite(n) ? clampOpacity(n) : undefined;
  }, [history.document.layers, selectedContentIdSet]);

  const onMoveLayer = useCallback(
    (draggedId: string, targetId: string, position: 'before' | 'after' | 'inside') => {
      setAllLayers(moveLayerInTree(history.document.layers, draggedId, targetId, position));
    },
    [history.document.layers, setAllLayers],
  );

  const onOpenDocRef = useRef(onOpenDoc);
  onOpenDocRef.current = onOpenDoc;
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  onDeleteDocRef.current = onDeleteDoc;

  const onSidebarOpenDoc = useCallback((id: string) => {
    void onOpenDocRef.current(id);
  }, []);


  const [isTemplatePickerOpen, setIsTemplatePickerOpen] = useState(false);

  useCanvasKeyboard({
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
    document: history.document,
    setDocument: history.setDocument,
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
  });

  const onOpenTemplates = useCallback(() => {
    setIsTemplatePickerOpen(true);
  }, []);

  const onCloseTemplates = useCallback(() => {
    setIsTemplatePickerOpen(false);
  }, []);

  const onNewFromPreset = useCallback(
    (preset: CanvasPreset) => {
      void onNewRef.current((doc) => {
        const tpl = preset.create();
        tpl.id = doc.id;
        tpl.name = preset.label || tpl.name;
        return syncImagesPerPage(tpl);
      });
    },
    [],
  );

  const onSidebarNew = useCallback(() => {
    void onNewRef.current();
  }, []);

  const onSidebarDeleteDoc = useCallback(() => {
    void onDeleteDocRef.current();
  }, []);

  const handleSelectIds = useCallback(
    (ids: string[]) => {
      if (panelBaselineRef.current) onPanelCommitLive();
      if (editingLayerId && (ids.length !== 1 || ids[0] !== editingLayerId)) {
        commitInlineEdit();
      }
      if (pathEditingLayerId && (ids.length !== 1 || ids[0] !== pathEditingLayerId)) {
        setPathEditingLayerId(null);
      }
      if (enteredGroupId) {
        const members = new Set(
          expandWithDescendants(history.document.layers, [enteredGroupId]),
        );
        if (!ids.every((i) => members.has(i))) setEnteredGroupId(null);
      }
      setSelectedIds(ids);
    },
    [
      editingLayerId,
      commitInlineEdit,
      pathEditingLayerId,
      enteredGroupId,
      history.document.layers,
      onPanelCommitLive,
    ],
  );

  const onPageChange = useCallback(
    (nextIndex: number) => {
      sealPanelAndAbortGesture();
      if (editingLayerId) commitInlineEdit();
      if (pathEditingLayerId) setPathEditingLayerId(null);
      setEnteredGroupId(null);
      setEyedropperActive(false);
      setSelectedIds((ids) => filterSelectionToPage(history.document.layers, ids, nextIndex));
      setPageIndex(nextIndex);
    },
    [commitInlineEdit, editingLayerId, history.document.layers, pathEditingLayerId, sealPanelAndAbortGesture],
  );

  const onAddPage = useCallback(() => {
    sealPanelAndAbortGesture();
    if (editingLayerId) commitInlineEdit();
    if (pathEditingLayerId) setPathEditingLayerId(null);
    const next = syncImagesPerPage(addPage(history.document));
    history.setDocument(next);
    setSelectedIds([]);
    setPageIndex(getPageCount(next) - 1);
  }, [commitInlineEdit, editingLayerId, history, pathEditingLayerId, sealPanelAndAbortGesture]);

  const onRemovePage = useCallback(
    (index: number) => {
      sealPanelAndAbortGesture();
      if (editingLayerId) commitInlineEdit();
      if (pathEditingLayerId) setPathEditingLayerId(null);
      const next = syncImagesPerPage(removePage(history.document, index));
      history.setDocument(next);
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
    [commitInlineEdit, editingLayerId, history, pathEditingLayerId, sealPanelAndAbortGesture],
  );

  const onDuplicatePage = useCallback(
    (index: number) => {
      sealPanelAndAbortGesture();
      if (editingLayerId) commitInlineEdit();
      if (pathEditingLayerId) setPathEditingLayerId(null);
      const next = syncImagesPerPage(duplicatePage(history.document, index));
      history.setDocument(next);
      setSelectedIds([]);
      setPageIndex(index + 1);
    },
    [commitInlineEdit, editingLayerId, history, pathEditingLayerId, sealPanelAndAbortGesture],
  );

  const onRenamePage = useCallback(
    (index: number, name: string) => {
      history.setDocument(renamePage(history.document, index, name));
    },
    [history],
  );

  const onReorderPage = useCallback(
    (fromIndex: number, toIndex: number) => {
      sealPanelAndAbortGesture();
      if (editingLayerId) commitInlineEdit();
      if (pathEditingLayerId) setPathEditingLayerId(null);
      const next = reorderPage(history.document, fromIndex, toIndex);
      if (next === history.document) return;
      history.setDocument(next);
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
    [commitInlineEdit, editingLayerId, history, pathEditingLayerId, sealPanelAndAbortGesture],
  );

  const onSelectLayerById = useCallback(
    (id: string) => {
      const layer = history.document.layers.find((l) => l.id === id);
      if (!layer) return;
      const targetPage = layer.pageIndex ?? 0;
      if (targetPage !== pageIndex) onPageChange(targetPage);
      setSelectedIds([id]);
    },
    [history.document.layers, onPageChange, pageIndex],
  );

  const onGroupSelected = useCallback(() => {
    const editable = selectedIds.filter((id) => {
      const l = history.document.layers.find((x) => x.id === id);
      return l && !l.locked && l.type !== 'frame';
    });
    if (editable.length < 2) return;
    const { layers, groupId } = groupLayers(history.document.layers, editable);
    if (!groupId) return;
    setAllLayers(layers);
    setSelectedIds([groupId]);
  }, [selectedIds, history.document.layers, setAllLayers]);

  const onUngroupSelected = useCallback(() => {
    if (selectedIds.length !== 1) return;
    const layer = history.document.layers.find((l) => l.id === selectedIds[0]);
    if (!layer || (layer.type !== 'group' && layer.type !== 'component') || layer.locked) return;
    setAllLayers(ungroupLayers(history.document.layers, layer.id));
  }, [selectedIds, history.document.layers, setAllLayers]);

  const onToggleVisible = useCallback(
    (id: string, visible: boolean) => {
      setAllLayers(setLayerVisible(history.document.layers, id, visible));
    },
    [history.document.layers, setAllLayers],
  );

  const onToggleLocked = useCallback(
    (id: string, locked: boolean) => {
      setAllLayers(setLayerLocked(history.document.layers, id, locked));
    },
    [history.document.layers, setAllLayers],
  );

  const onRenameLayer = useCallback(
    (id: string, name: string) => {
      const layer = history.document.layers.find((l) => l.id === id);
      if (!layer || layer.locked || layer.type === 'frame') return;
      setAllLayers(history.document.layers.map((l) => (l.id === id ? { ...l, name } : l)));
    },
    [history.document.layers, setAllLayers],
  );

  const handleSave = useCallback(() => void onSave(), [onSave]);

  const conflictSlot = useMemo(
    () =>
      syncConflict ? (
        <SyncConflictBar conflict={syncConflict} onResolve={onConflictResolve} />
      ) : (
        <>
          <CanvasPresenceBadge collaborators={collaborators} status={realtimeStatus} />
          <SyncStatusBadge status={syncStatus} />
        </>
      ),
    [syncConflict, collaborators, realtimeStatus, syncStatus, onConflictResolve],
  );

  const palette = useCanvasCommandPalette({
    paletteOpen,
    document: history.document,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    setDocument: history.setDocument,
    selectedIds,
    pageIndex,
    pageLayers,
    uiLocked,
    runUndo,
    runRedo,
    pasteClipboard,
    pasteReplaceClipboard,
    copyLayersToClipboard,
    setAllLayers,
    sealPanelAndAbortGesture,
    onAddPage,
    onDuplicatePage,
    onRemovePage,
    onRenamePage,
    zoomToFit,
    zoomToSelection,
    toggleBothPanels,
    togglePreview,
    handleSave,
    onNew,
    onDuplicate,
    onOpenTemplates,
    pdfImport,
    setTool,
    setSelectedIds,
    setRenameRequest,
    setUiLocked,
    setShowShortcuts,
    setEyedropperActive,
    setMode,
    propsClipboardRef,
    viewportNavRef,
  });

  if (loading) {
    return (
      <div className="canvas-app canvas-loading">
        <span className="canvas-loading-dot" aria-hidden />
        Cargando Canvas…
      </div>
    );
  }

  return (
    <>
    <input
      ref={pdfImport.pdfInputRef}
      type="file"
      accept="application/pdf,.pdf"
      className="hidden"
      onChange={(event) => void pdfImport.onPdfFileChange(event)}
      aria-label="Archivo PDF"
    />
    <div
      className="canvas-app relative flex h-full min-h-0 flex-col"
      style={{ ['--cv-left-panel-width' as string]: `${leftPanelWidth}px` }}
    >
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
        onUndo={runUndo}
        onRedo={runRedo}
        onSave={handleSave}
        onDuplicate={() => void onDuplicate()}
        onImportPdf={pdfImport.onImportPdf}
        importDisabled={pdfImport.pdfImporting}
        dirty={history.hasUnsavedEdits}
        leftPanelOpen={leftPanelOpen}
        rightPanelOpen={rightPanelOpen}
        uiLocked={uiLocked}
        onToggleUiLock={toggleUiLock}
        syncConflictSlot={conflictSlot}
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
            width={leftPanelWidth}
            onWidthChange={uiLocked ? undefined : setLeftPanelWidth}
            onHidePanel={toggleLeftPanel}
            hidePanelDisabled={uiLocked}
            documentName={history.document.name}
            docs={docs}
            documentId={history.document.id}
            docsSyncing={docsSyncing}
            layers={pageLayers}
            selectedIds={selectedIds}
            pageIndex={pageIndex}
            pageCount={getPageCount(history.document)}
            pages={history.document.pages}
            onSelect={onSelect}
            onOpenDoc={onSidebarOpenDoc}
            onOpenTemplates={onOpenTemplates}
            onNew={onSidebarNew}
            onDeleteDoc={onSidebarDeleteDoc}
            onPageChange={onPageChange}
            onAddPage={onAddPage}
            onRemovePage={onRemovePage}
            onDuplicatePage={onDuplicatePage}
            onRenamePage={onRenamePage}
            onReorderPage={onReorderPage}
            onMoveLayer={onMoveLayer}
            onGroupSelected={onGroupSelected}
            onUngroupSelected={onUngroupSelected}
            onToggleVisible={onToggleVisible}
            onToggleLocked={onToggleLocked}
            onRenameLayer={onRenameLayer}
            renameRequest={renameRequest}
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
            onSelectIds={handleSelectIds}
            gestureAbortToken={gestureAbortToken}
            enteredGroupId={enteredGroupId}
            onExitGroupEdit={onExitGroupEdit}
            eyedropperActive={eyedropperActive}
            onEyedropperPick={onEyedropperPick}
            onChangeLayers={setPageLayers}
            onPreviewLayers={setPageLayersLive}
            onCommitGesture={commitPageLayersGesture}
            onDrawLayer={onStageDrawLayer}
            onStartEdit={startContainerOrInlineEdit}
            onStartPathEdit={onStageStartPathEdit}
            onEditValue={onInlineEditValue}
            onFitTextHeight={onFitTextHeight}
            onCommitEdit={commitInlineEdit}
            onUpsertGuide={onStageUpsertGuide}
            onCommitGuideCreate={onStageCommitGuideCreate}
            onMoveGuide={onStageMoveGuide}
            onRemoveGuide={onStageRemoveGuide}
            onCancelGuideCreate={onStageCancelGuideCreate}
            showRulers={history.document.settings?.showRulers !== false}
            onToggleRulers={onToggleRulers}
            snapToGrid={Boolean(history.document.settings?.snapToGrid)}
            onToggleSnapToGrid={onToggleSnapToGrid}
            zoomPortalTarget={zoomPortalTarget}
            zoomFallbackSlotRef={setStageZoomSlot}
            showZoomFallback={!rightPanelOpen}
            showLeftReopen={!leftPanelOpen}
            showRightReopen={!rightPanelOpen}
            onShowLeftPanel={toggleLeftPanel}
            onShowRightPanel={toggleRightPanel}
            reopenDisabled={uiLocked}
            onContextMenu={onStageContextMenu}
          >
            {showPathToolbar && (
              <PathEditToolbar
                tool={tool}
                toolbarPosition={toolbarPosition}
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
            <BottomToolbar
              tool={tool}
              onTool={setTool}
              position={toolbarPosition}
              onPositionChange={setToolbarPosition}
            />
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
            {palette && (
              <CommandPalette
                commands={palette.commands}
                onRun={(id) => palette.runners.get(id)?.()}
                onClose={() => setPaletteOpen(false)}
              />
            )}
          </DesignStage>
          <RightPanel
            documentId={history.document.id}
            onVersionRestored={(doc) => {
              void (async () => {
                history.replaceDocument(await hydrateDocumentImages(doc));
                await refreshList();
              })();
            }}
            open={rightPanelOpen}
            onHidePanel={toggleRightPanel}
            hidePanelDisabled={uiLocked}
            layer={selected}
            selectedCount={selectedIds.length}
            selectedIds={selectedIds}
            pageColors={pageColors}
            onChange={(layer) => {
              if (panelBaselineRef.current) onPanelCommitLive();
              let nextLayer = layer;
              if (layer.meta?.instanceOf) {
                nextLayer = bakeInstanceOverrides(
                  layer,
                  findComponentMaster(history.document.layers, layer.meta.instanceOf),
                );
              }
              const prev = history.document.layers.find((l) => l.id === nextLayer.id);
              const layers = applyContainerLayoutPanelEffects(
                applyLivePanelLayerChange(history.document.layers, prev, nextLayer),
                prev,
                nextLayer,
              );
              const styleSynced = syncLinkedStylesFromLayer(
                { ...history.document, layers },
                prev,
                nextLayer,
              );
              const synced = syncComponentFromLayer(styleSynced, prev, nextLayer);
              history.setDocument(syncImagesPerPage(synced));
            }}
            onReplaceLayers={(nextLayers) => {
              if (panelBaselineRef.current) onPanelCommitLive();
              history.setDocument(
                syncImagesPerPage({
                  ...history.document,
                  layers: nextLayers,
                }),
              );
            }}
            onChangeLive={onPanelChangeLive}
            onCommitLive={onPanelCommitLive}
            onDelete={onDeleteLayer}
            onAlign={onAlign}
            onDistribute={onDistribute}
            layers={history.document.layers}
            onSelectLayer={onSelectLayerById}
            onInstantiateComponent={() => {
              if (!selected || selectedIds.length !== 1) return;
              if (!selected.meta?.componentId || selected.meta.instanceOf) return;
              if (panelBaselineRef.current) onPanelCommitLive();
              const { instance, childLayers } = instantiateComponent(
                selected,
                history.document,
              );
              history.setDocument(
                syncImagesPerPage({
                  ...history.document,
                  layers: [...history.document.layers, instance, ...childLayers],
                }),
              );
              setSelectedIds([instance.id]);
            }}
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
              onPanelChangeLayersLive(nudgeLayers(history.document.layers, selectedContentIds, dx, dy));
            }}
            selectionOrigin={selectionOrigin}
            onBulkVisible={(visible) => {
              sealPanelAndAbortGesture();
              setAllLayers(setLayersVisible(history.document.layers, selectedContentIds, visible));
            }}
            onBulkLocked={(locked) => {
              sealPanelAndAbortGesture();
              setAllLayers(setLayersLocked(history.document.layers, selectedContentIds, locked));
            }}
            onBulkOpacity={(opacity) => {
              sealPanelAndAbortGesture();
              setAllLayers(setLayersOpacity(history.document.layers, selectedContentIds, opacity));
            }}
            bulkOpacityValue={bulkOpacityValue}
            onBringFront={() => {
              sealPanelAndAbortGesture();
              setAllLayers(bringToFront(history.document.layers, selectedIds));
            }}
            onBringForward={() => {
              sealPanelAndAbortGesture();
              setAllLayers(bringForward(history.document.layers, selectedIds));
            }}
            onSendBack={() => {
              sealPanelAndAbortGesture();
              setAllLayers(sendToBack(history.document.layers, selectedIds));
            }}
            onSendBackward={() => {
              sealPanelAndAbortGesture();
              setAllLayers(sendBackward(history.document.layers, selectedIds));
            }}
            logoSideConflict={
              Boolean(selected?.type === 'logo' && logoSideHasConflict(history.document.layers, selected.id))
            }
            zoomSlotRef={setRightZoomSlot}
          />
        </div>
        )
      ) : (
        <Suspense fallback={<div className="canvas-app canvas-loading">Cargando generador…</div>}>
          <GeneratePanel document={history.document} runCloudSync={runCloudSync} />
        </Suspense>
      )}
      <PdfImportStatus
        progress={pdfImport.pdfImportProgress}
        report={pdfImport.pdfImportReport}
        error={pdfImport.pdfImportError}
        importing={pdfImport.pdfImporting}
        onCancel={pdfImport.cancelPdfImport}
      />
    </div>
    {pdfImport.pdfFile && pdfImport.pdfPreflight && !pdfImport.pdfImporting ? (
      <PdfImportOptionsDialog
        preflight={pdfImport.pdfPreflight}
        onCancel={pdfImport.cancelPdfImportOptions}
        onConfirm={(options) => void pdfImport.confirmPdfImport(options)}
      />
    ) : null}
      <TemplatePickerModal
        isOpen={isTemplatePickerOpen}
        onClose={onCloseTemplates}
        onApplyPreset={onApplyPreset}
        onNewFromPreset={onNewFromPreset}
        onNewBlank={onSidebarNew}
      />
    </>
  );
}
