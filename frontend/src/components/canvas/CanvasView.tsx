import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import './canvas.css';
import { createLayer } from './constants';
import { loadCanvasPresets } from './presets/loadPresets';
import { queueCanvasCloudPush } from './sync/cloudQueue';
import { isNewer, type SyncConflict } from './sync/syncCompare';
import type { SyncConflictChoice } from './hooks/useCanvasSync';
import SyncConflictBar from './editor/SyncConflictBar';
import SyncStatusBadge from './editor/SyncStatusBadge';
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
import { useDocumentLifecycle } from './hooks/useDocumentLifecycle';
import { isOpenDocumentDirty, useCanvasSync } from './hooks/useCanvasSync';
import { useGestureBaselines } from './hooks/useGestureBaselines';
import { useInlineEdit } from './hooks/useInlineEdit';
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
  getPageCount,
  removePage,
  renamePage,
  setActivePageLayers,
  syncImagesPerPage,
} from './ops/pages';
import {
  applyGridToImageSlots,
  applyLivePanelLayerChange,
  matchGridSlotsToSourceSize,
} from './ops/gridLayout';
import { assignUniqueLogoSides, logoSideHasConflict, withAssignedLogoSide } from './ops/logoSide';
import { isClickPlace, placeRectCssVars, type DrawRect } from './ops/drawHelpers';
import { moveGuide, removeGuide, upsertGuide } from './ops/guides';
import { selectionBounds } from './ops/selectionTransform';
import { instantiateComponent, bakeInstanceOverrides, findComponentMaster, syncComponentFromLayer } from './ops/components';
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
import {
  createClipboardCopyCoordinator,
  parseClipboardLayers,
  writeClipboardLayersText,
  type ClipboardCopyCoordinator,
} from './ops/clipboardLayers';
import { nextZoomPreset } from './ops/viewportNav';
import { cloneDocument } from './ops/document';
import { autosaveDelayForDoc } from './utils/autosave';
import {
  A4_HEIGHT_PX,
  A4_WIDTH_PX,
  createEmptyDocument,
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

export default function CanvasView({ active = true }: { active?: boolean }) {
  const history = useCanvasHistory(createEmptyDocument('Sin título'));
  const historyReadyRef = useRef(false);
  const restoreGenerationRef = useRef(0);

  const historyDocRef = useRef(history.document);
  const openDirtyRef = useRef(false);
  historyDocRef.current = history.document;
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
      // Transient IPC/backend failure: keep the last known list.
    }
  }, []);


  const guideCreateBaselineRef = useRef<CanvasDocument | null>(null);

  const onDeleteDocRef = useRef<() => Promise<void>>(async () => {});

  const [syncConflict, setSyncConflict] = useState<SyncConflict | null>(null);
  const syncConflictRef = useRef<SyncConflict | null>(null);
  /** After Mantener, ignore the same remote timestamp until a newer one arrives. */
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
            // Consolidate failed (offline/RLS); dismissal stays; next sync retries.
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
          await api.canvasSave(conflict.remoteDoc!, { touch: false });
          history.replaceDocument(await hydrateDocumentImages(conflict.remoteDoc!));
          await refreshList();
        } catch {
          /* local remains; next sync retries */
        }
      })();
    },
    [history, refreshList],
  );

  const { runCloudSync, syncing: docsSyncing, syncStatus } = useCanvasSync({
    historyDocRef,
    openDirtyRef,
    refreshList,
    replaceDocument: history.replaceDocument,
    onConflict: handleConflict,
    active,
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

  const setPageLayers = (layers: CanvasLayer[]) => {
    history.setDocument(syncImagesPerPage(setActivePageLayers(history.document, pageIndex, layers)));
  };

  const setAllLayers = (layers: CanvasLayer[]) => {
    history.setDocument(syncImagesPerPage({ ...history.document, layers }));
  };

  const {
    panelBaselineRef,
    gestureBaselineRef,
    setPageLayersLive,
    commitPageLayersGesture,
    cancelPageLayersGesture,
    onPanelChangeLive,
    onPanelCommitLive,
  } = useGestureBaselines({ history, pageIndex });

  const [gestureAbortToken, setGestureAbortToken] = useState(0);

  const renameBaselineRef = useRef<typeof history.document | null>(null);

  openDirtyRef.current = isOpenDocumentDirty(
    history.hasUnsavedEditsRef.current,
    panelBaselineRef.current != null,
    gestureBaselineRef.current != null,
    renameBaselineRef.current != null,
  );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.document, active]);

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
        /* permission / unavailable — keep in-memory paste behavior */
      }
    },
    [applyPasteLayers, clipboard],
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
    onKeyDownRef.current = (e: KeyboardEvent) => {
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
          if (layer?.type === 'group' || layer?.type === 'component') {
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
          const layer = history.document.layers.find((l) => l.id === editingLayerId);
          if (layer) onInlineEditValue(editingLayerId, `${layer.value}${e.key}`);
          return;
        }
        // Block tool / delete / nudge shortcuts while editing.
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
      if (isEditableKeyboardTarget(e.target) && !isDuplicateShortcut) return;

      if (selectedIds.length === 1 && isTypeToEditKey(e.key, e)) {
        const layer = history.document.layers.find((l) => l.id === selectedIds[0]);
        if (canInlineEditLayer(layer)) {
          e.preventDefault();
          startInlineEdit(selectedIds[0], { seed: e.key });
          return;
        }
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
        if ((e.key === 'p' || e.key === 'P') && !e.shiftKey) {
          const lineId =
            pathEditingLayerId ||
            selectedIds.find((id) => history.document.layers.find((l) => l.id === id)?.type === 'line');
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

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        if (toolBeforeSpaceRef.current == null) toolBeforeSpaceRef.current = tool;
        setTool('hand');
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        viewportNavRef.current?.setZoom((z) => nextZoomPreset(z, 'in'));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        viewportNavRef.current?.setZoom((z) => nextZoomPreset(z, 'out'));
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
          sealPanelAndAbortGesture();
          setAllLayers(deleteLayers(history.document.layers, editableIds));
          setSelectedIds([]);
        }
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!editableIds.length) return;
        e.preventDefault();
        sealPanelAndAbortGesture();
        const step = e.altKey ? 0.1 : e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        setAllLayers(nudgeLayers(history.document.layers, editableIds, dx, dy));
      }


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
          sealPanelAndAbortGesture();
          setAllLayers(
            alignLayers(history.document.layers, editableIds, alignMap[alignKey]!, { pageIndex }),
          );
          return;
        }
        if ((alignKey === 'x' || alignKey === 'y') && editableIds.length >= 3) {
          e.preventDefault();
          sealPanelAndAbortGesture();
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
        const deepIdSet = new Set(deepIds);
        const copies = history.document.layers.filter((l) => deepIdSet.has(l.id));
        copyLayersToClipboard(copies);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        void pasteClipboard(e.shiftKey ? 0 : undefined);
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
        sealPanelAndAbortGesture();
        setAllLayers(bringForward(history.document.layers, editableIds));
      } else if (e.key === ']' || e.key === '}') {
        sealPanelAndAbortGesture();
        setAllLayers(bringToFront(history.document.layers, editableIds));
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '[' || e.key === '{')) {
        e.preventDefault();
        sealPanelAndAbortGesture();
        setAllLayers(sendBackward(history.document.layers, editableIds));
      } else if (e.key === '[' || e.key === '{') {
        sealPanelAndAbortGesture();
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
  });

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

  const addLayerAt = (type: PlaceableTool, rect: DrawRect) => {
    const layerType = type as Exclude<CanvasLayerType, 'frame' | 'group' | 'component'>;
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
    // Sync reads this ref without waiting for a re-render.
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

  const onApplyPreset = (presetId: string) => {
    void loadCanvasPresets().then((presets) => {
      const preset = presets.find((p) => p.id === presetId);
      if (!preset) return;
      const doc = preset.create();
      doc.id = history.document.id;
      doc.name = history.document.name;
      history.setDocument(syncImagesPerPage(doc));
      setSelectedIds([]);
      setPageIndex(0);
    });
  };

  const onDeleteLayer = (id: string) => {
    setAllLayers(deleteLayers(history.document.layers, [id]));
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  };

  const onContextAction = (action: CanvasContextAction) => {
    const id = contextMenu?.layerId;

    if (action === 'paste') {
      void pasteClipboard();
      return;
    }
    if (action === 'pasteInPlace') {
      void pasteClipboard(0);
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
      const deepIdSet = new Set(deepIds);
      const copies = history.document.layers.filter((l) => deepIdSet.has(l.id));
      copyLayersToClipboard(copies);
      return;
    }
    if (action === 'toggleLock') {
      sealPanelAndAbortGesture();
      setAllLayers(setLayerLocked(history.document.layers, id, !layer.locked));
      return;
    }
    if (action === 'toggleVisible') {
      sealPanelAndAbortGesture();
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
      sealPanelAndAbortGesture();
      const { layers, groupId } = groupLayers(history.document.layers, editable);
      setAllLayers(layers);
      setSelectedIds([groupId]);
      return;
    }
    if (action === 'ungroup') {
      if (layer.type !== 'group' && layer.type !== 'component') return;
      sealPanelAndAbortGesture();
      setAllLayers(ungroupLayers(history.document.layers, id));
      return;
    }
    if (layer.locked) return;

    const mutateRoots = selectedIds.includes(id) ? selectedIds : [id];

    if (action === 'matchGridSlotSize') {
      sealPanelAndAbortGesture();
      setAllLayers(matchGridSlotsToSourceSize(history.document.layers, id));
      return;
    }
    if (action === 'duplicate') {
      sealPanelAndAbortGesture();
      const editable = mutateRoots.filter((lid) => {
        const l = history.document.layers.find((x) => x.id === lid);
        return l && !l.locked && l.type !== 'frame';
      });
      if (!editable.length) return;
      const { layers, newIds } = duplicateLayers(history.document.layers, editable);
      setAllLayers(assignUniqueLogoSides(layers, newIds));
      setSelectedIds(newIds);
      return;
    }
    if (action === 'bringFront') {
      sealPanelAndAbortGesture();
      setAllLayers(bringToFront(history.document.layers, mutateRoots));
      return;
    }
    if (action === 'bringForward') {
      sealPanelAndAbortGesture();
      setAllLayers(bringForward(history.document.layers, mutateRoots));
      return;
    }
    if (action === 'sendBack') {
      sealPanelAndAbortGesture();
      setAllLayers(sendToBack(history.document.layers, mutateRoots));
      return;
    }
    if (action === 'sendBackward') {
      sealPanelAndAbortGesture();
      setAllLayers(sendBackward(history.document.layers, mutateRoots));
      return;
    }
    if (action === 'delete') {
      sealPanelAndAbortGesture();
      setAllLayers(deleteLayers(history.document.layers, mutateRoots));
      setSelectedIds((prev) => prev.filter((x) => !mutateRoots.includes(x)));
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

  const editableSelectedIds = useMemo(
    () => selectedIds.filter((id) => {
      const layer = history.document.layers.find((l) => l.id === id);
      return layer && layer.type !== 'frame';
    }),
    [selectedIds, history.document.layers],
  );

  const editableSelectedIdSet = useMemo(
    () => new Set(editableSelectedIds),
    [editableSelectedIds],
  );

  const selectionOrigin = useMemo(() => {
    if (editableSelectedIds.length <= 1) return null;
    const b = selectionBounds(history.document.layers, editableSelectedIds);
    return b ? { x: b.x, y: b.y } : null;
  }, [history.document.layers, editableSelectedIds]);

  const bulkOpacityValue = useMemo(() => {
    const sel = history.document.layers.filter((l) => editableSelectedIdSet.has(l.id));
    if (sel.length === 0) return undefined;
    const first = sel[0].cssVars['--opacity'];
    const allSame = sel.every((l) => l.cssVars['--opacity'] === first);
    if (!allSame) return null;
    const n = Number(first ?? '100');
    return Number.isFinite(n) ? clampOpacity(n) : undefined;
  }, [history.document.layers, editableSelectedIdSet]);

  const onMoveLayer = useCallback(
    (draggedId: string, targetId: string, position: 'before' | 'after' | 'inside') => {
      setAllLayers(moveLayerInTree(history.document.layers, draggedId, targetId, position));
    },
    // setAllLayers closes over history.document; re-bind when layers change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.document.layers],
  );

  const onOpenDocRef = useRef(onOpenDoc);
  onOpenDocRef.current = onOpenDoc;
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  onDeleteDocRef.current = onDeleteDoc;

  const onSidebarOpenDoc = useCallback((id: string) => {
    void onOpenDocRef.current(id);
  }, []);

  const onSidebarNew = useCallback(() => {
    void onNewRef.current();
  }, []);

  const onSidebarDeleteDoc = useCallback(() => {
    void onDeleteDocRef.current();
  }, []);

  const onAddPage = useCallback(() => {
    const next = syncImagesPerPage(addPage(history.document));
    history.setDocument(next);
    setPageIndex(getPageCount(next) - 1);
  }, [history]);

  const onRemovePage = useCallback(
    (index: number) => {
      const next = syncImagesPerPage(removePage(history.document, index));
      history.setDocument(next);
      setSelectedIds((prev) => prev.filter((id) => next.layers.some((l) => l.id === id)));
      setPageIndex((prev) => {
        if (index < prev) return prev - 1;
        if (index === prev) return Math.min(prev, Math.max(0, getPageCount(next) - 1));
        return prev;
      });
    },
    [history],
  );

  const onDuplicatePage = useCallback(
    (index: number) => {
      const next = syncImagesPerPage(duplicatePage(history.document, index));
      history.setDocument(next);
      setPageIndex(index + 1);
    },
    [history],
  );

  const onRenamePage = useCallback(
    (index: number, name: string) => {
      history.setDocument(renamePage(history.document, index, name));
    },
    [history],
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, history.document.layers]);

  const onUngroupSelected = useCallback(() => {
    if (selectedIds.length !== 1) return;
    const layer = history.document.layers.find((l) => l.id === selectedIds[0]);
    if (!layer || (layer.type !== 'group' && layer.type !== 'component') || layer.locked) return;
    setAllLayers(ungroupLayers(history.document.layers, layer.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, history.document.layers]);

  const onToggleVisible = useCallback(
    (id: string, visible: boolean) => {
      setAllLayers(setLayerVisible(history.document.layers, id, visible));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.document.layers],
  );

  const onToggleLocked = useCallback(
    (id: string, locked: boolean) => {
      setAllLayers(setLayerLocked(history.document.layers, id, locked));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.document.layers],
  );

  const onRenameLayer = useCallback(
    (id: string, name: string) => {
      const layer = history.document.layers.find((l) => l.id === id);
      if (!layer || layer.locked || layer.type === 'frame') return;
      setAllLayers(history.document.layers.map((l) => (l.id === id ? { ...l, name } : l)));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.document.layers],
  );

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
    <div className="canvas-app relative flex h-full min-h-0 flex-col">
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
        onSave={() => void onSave()}
        onDuplicate={() => void onDuplicate()}
        leftPanelOpen={leftPanelOpen}
        rightPanelOpen={rightPanelOpen}
        uiLocked={uiLocked}
        onToggleUiLock={toggleUiLock}
        syncConflictSlot={
          syncConflict ? (
            <SyncConflictBar conflict={syncConflict} onResolve={onConflictResolve} />
          ) : (
            <SyncStatusBadge status={syncStatus} />
          )
        }
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
            docsSyncing={docsSyncing}
            layers={pageLayers}
            selectedIds={selectedIds}
            pageIndex={pageIndex}
            pageCount={getPageCount(history.document)}
            pages={history.document.pages}
            onSelect={onSelect}
            onOpenDoc={onSidebarOpenDoc}
            onNew={onSidebarNew}
            onDeleteDoc={onSidebarDeleteDoc}
            onPageChange={setPageIndex}
            onAddPage={onAddPage}
            onRemovePage={onRemovePage}
            onDuplicatePage={onDuplicatePage}
            onRenamePage={onRenamePage}
            onMoveLayer={onMoveLayer}
            onGroupSelected={onGroupSelected}
            onUngroupSelected={onUngroupSelected}
            onToggleVisible={onToggleVisible}
            onToggleLocked={onToggleLocked}
            onRenameLayer={onRenameLayer}
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
              if (panelBaselineRef.current) onPanelCommitLive();
              if (editingLayerId && (ids.length !== 1 || ids[0] !== editingLayerId)) {
                commitInlineEdit();
              }
              if (pathEditingLayerId && (ids.length !== 1 || ids[0] !== pathEditingLayerId)) {
                setPathEditingLayerId(null);
              }
              setSelectedIds(ids);
            }}
            gestureAbortToken={gestureAbortToken}
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
              if (!exists) {
                guideCreateBaselineRef.current = history.document;
              }
              history.updateSilent(upsertGuide(history.document, guide));
            }}
            onCommitGuideCreate={(guide) => {
              const baseline = guideCreateBaselineRef.current;
              guideCreateBaselineRef.current = null;
              const next = upsertGuide(history.document, guide);
              if (baseline) {
                history.updateSilent(next);
                history.commitFromBaseline(baseline);
              } else {
                history.setDocument(next);
              }
            }}
            onMoveGuide={(id, posMm) => {
              // Called once on pointerup (Artboard keeps live preview local during drag).
              history.setDocument(moveGuide(history.document, id, posMm));
            }}
            onRemoveGuide={(id) => {
              history.setDocument(removeGuide(history.document, id));
            }}
            onCancelGuideCreate={(id) => {
              guideCreateBaselineRef.current = null;
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
                canUngroup: layer?.type === 'group' || layer?.type === 'component',
                canPaste: true,
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
              // Same gate as live path: only cols/rows/gap rebuild sibling slots.
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
              if (panelBaselineRef.current) onPanelCommitLive();
              setAllLayers(nudgeLayers(history.document.layers, editableSelectedIds, dx, dy));
            }}
            selectionOrigin={selectionOrigin}
            onBulkVisible={(visible) => {
              sealPanelAndAbortGesture();
              setAllLayers(setLayersVisible(history.document.layers, editableSelectedIds, visible));
            }}
            onBulkLocked={(locked) => {
              sealPanelAndAbortGesture();
              setAllLayers(setLayersLocked(history.document.layers, editableSelectedIds, locked));
            }}
            onBulkOpacity={(opacity) => {
              sealPanelAndAbortGesture();
              setAllLayers(setLayersOpacity(history.document.layers, editableSelectedIds, opacity));
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
          <GeneratePanel document={history.document} runCloudSync={runCloudSync} />
        </Suspense>
      )}
    </div>
    </>
  );
}
