import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import './canvas.css';
import { createLayer } from './constants';
import { CANVAS_PRESETS } from './presets';
import GeneratePanel from './editor/GeneratePanel';
import Artboard from './editor/Artboard';
import BottomToolbar from './editor/BottomToolbar';
import ContextMenu, {
  type CanvasContextAction,
  type CanvasContextMenuState,
} from './editor/ContextMenu';
import LeftSidebar from './editor/LeftSidebar';
import RightPanel from './editor/RightPanel';
import TopBar from './editor/TopBar';
import ZoomMenu from './editor/ZoomMenu';
import { useCanvasHistory } from './hooks/useCanvasHistory';
import { CANVAS_SHORTCUTS } from './shortcuts';
import {
  alignLayers,
  bringForward,
  bringToFront,
  deleteLayers,
  distributeLayers,
  duplicateLayers,
  groupLayers,
  nudgeLayers,
  reorderAmongSiblings,
  sendBackward,
  sendToBack,
  setLayerVisible,
  setLayerLocked,
  setLayersLocked,
  setLayersOpacity,
  setLayersVisible,
  ungroupLayers,
} from './ops/layerOps';
import { childIdsOf, isLayerContainer } from './ops/layerTree';
import { collectDocumentColors } from './ops/layerStyle';
import { addPage, duplicatePage, getPageCount, removePage, renamePage, setActivePageLayers } from './ops/pages';
import { applyGridToImageSlots } from './ops/gridLayout';
import { isClickPlace, type DrawRect } from './ops/drawHelpers';
import { canFocusFieldBinding, canInlineEditLayer, isEditableKeyboardTarget } from './ops/inlineEdit';
import { fitZoomForViewport } from './ops/viewportNav';
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
  type CanvasTool,
  newId,
} from './types';

type PlaceableTool = Exclude<CanvasTool, 'select' | 'hand'>;

const DEFAULT_SIZES: Partial<Record<PlaceableTool, { w: number; h: number }>> = {
  rect: { w: 50, h: 40 },
  ellipse: { w: 40, h: 40 },
  line: { w: 60, h: 1 },
  arrow: { w: 50, h: 24 },
  polygon: { w: 40, h: 40 },
  star: { w: 40, h: 40 },
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
  const [mode, setMode] = useState<CanvasMode>('design');
  const [docs, setDocs] = useState<CanvasDocumentSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<CanvasTool>('select');
  const toolBeforeSpaceRef = useRef<CanvasTool | null>(null);
  const [clipboard, setClipboard] = useState<CanvasLayer[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const editBaselineRef = useRef<CanvasDocument | null>(null);
  const panelBaselineRef = useRef<CanvasDocument | null>(null);

  const selectedId = selectedIds[0] ?? null;
  const pageLayers = history.document.layers.filter((l) => (l.pageIndex ?? 0) === pageIndex);

  const refreshList = useCallback(async () => {
    try {
      const res = await api.canvasList();
      setDocs(res.documents);
    } catch {
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await api.canvasList();
        if (cancelled) return;
        setDocs(list.documents);
        if (list.documents.length > 0) {
          const got = await api.canvasGet(list.documents[0].id);
          if (!cancelled) history.replaceDocument(normalizeDocument(got.document as CanvasDocument));
        } else {
          const created = await api.canvasCreate('Sin título');
          if (!cancelled) {
            history.replaceDocument(normalizeDocument(created.document as CanvasDocument));
            setDocs([{ id: created.document.id, name: created.document.name }]);
          }
        }
      } catch {
        if (!cancelled) history.replaceDocument(createEmptyDocument());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount bootstrap only
  }, []);

  const onSave = useCallback(async () => {
    try {
      const res = await api.canvasSave(history.document);
      history.replaceDocument(normalizeDocument(res.document as CanvasDocument));
      await refreshList();
      setStatus('Guardado');
      setTimeout(() => setStatus(null), 2000);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Error al guardar');
    }
  }, [history, refreshList]);

  const setPageLayers = (layers: CanvasLayer[]) => {
    history.setDocument(setActivePageLayers(history.document, pageIndex, layers));
  };

  const setAllLayers = (layers: CanvasLayer[]) => {
    history.setDocument({ ...history.document, layers });
  };

  const cloneDocument = (doc: CanvasDocument): CanvasDocument => ({
    ...doc,
    page: { ...doc.page },
    layers: doc.layers.map((l) => ({
      ...l,
      cssVars: { ...l.cssVars },
      meta: l.meta ? { ...l.meta } : undefined,
    })),
    fields: doc.fields.map((f) => ({ ...f })),
    pages: doc.pages?.map((p) => ({ ...p })),
    settings: doc.settings ? { ...doc.settings, gridRules: doc.settings.gridRules?.map((r) => ({ ...r })) } : undefined,
  });

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
    (id: string) => {
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
      setEditingLayerId(id);
      setContextMenu(null);
    },
    [history.document, editingLayerId, commitInlineEdit],
  );

  const onInlineEditValue = useCallback(
    (id: string, value: string) => {
      history.updateSilent({
        ...history.document,
        layers: history.document.layers.map((l) => (l.id === id ? { ...l, value } : l)),
      });
    },
    [history],
  );

  const onPanelChangeLive = useCallback(
    (layer: CanvasLayer) => {
      if (!panelBaselineRef.current) {
        panelBaselineRef.current = cloneDocument(history.document);
      }
      history.updateSilent({
        ...history.document,
        layers: history.document.layers.map((l) => (l.id === layer.id ? layer : l)),
      });
    },
    [history],
  );

  const onPanelCommitLive = useCallback(() => {
    const baseline = panelBaselineRef.current;
    if (!baseline) return;
    panelBaselineRef.current = null;
    history.commitFromBaseline(baseline);
  }, [history]);

  const onSelect = (id: string | null, additive = false) => {
    if (editingLayerId && id !== editingLayerId) {
      commitInlineEdit();
    }
    if (panelBaselineRef.current) {
      onPanelCommitLive();
    }
    if (!id) {
      setSelectedIds([]);
      return;
    }
    if (additive) {
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    } else {
      setSelectedIds([id]);
    }
  };

  const zoomToFit = useCallback(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="canvas-viewport"]');
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setZoom(fitZoomForViewport(width, height, A4_WIDTH_PX, A4_HEIGHT_PX));
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== 'design') return;
      if (isEditableKeyboardTarget(e.target) || editingLayerId) {
        if (e.key === 'Escape' && editingLayerId) {
          e.preventDefault();
          commitInlineEdit();
        }
        return;
      }

      if (e.key === 'v' || e.key === 'V') setTool('select');
      if (e.key === 'h' || e.key === 'H') setTool('hand');
      if (e.key === 't' || e.key === 'T') setTool('text');
      if (e.key === 'r' || e.key === 'R') setTool('rect');
      if (e.key === 'o' || e.key === 'O') setTool('ellipse');
      if (e.key === 'f' || e.key === 'F') setTool('field');
      if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey) {
        setTool(e.shiftKey ? 'arrow' : 'line');
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setTool('image');
      }
      if (e.key === 'i' || e.key === 'I') setTool('imageSlot');
      if (e.key === 'g' || e.key === 'G') setTool('grid');
      if (e.key === 'b' || e.key === 'B') setTool('table');
      if (e.key === 'm' || e.key === 'M') setTool('image');
      // Space = temporary hand (OpenPencil)
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        if (toolBeforeSpaceRef.current == null) toolBeforeSpaceRef.current = tool;
        setTool('hand');
      }
      // Zoom shortcuts (OpenPencil: Ctrl/⌘ + / - / 0; Shift+1 = fit)
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setZoom((z) => Math.min(4, Math.round((z + 0.1) * 100) / 100));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        setZoom((z) => Math.max(0.2, Math.round((z - 0.1) * 100) / 100));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'Digit1') {
        e.preventDefault();
        zoomToFit();
      }

      const editableIds = selectedIds.filter((id) => {
        const layer = history.document.layers.find((l) => l.id === id);
        return layer && !layer.locked && layer.type !== 'frame';
      });

      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey && editableIds.length === 1) {
        const layer = history.document.layers.find((l) => l.id === editableIds[0]);
        if (layer && isLayerContainer(layer)) {
          const kids = childIdsOf(history.document.layers, layer.id);
          if (kids.length) {
            e.preventDefault();
            setSelectedIds(kids);
            return;
          }
        }
        if (canInlineEditLayer(layer)) {
          e.preventDefault();
          startInlineEdit(editableIds[0]);
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
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        setAllLayers(nudgeLayers(history.document.layers, editableIds, dx, dy));
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void onSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        if (!editableIds.length) return;
        const { layers, newIds } = duplicateLayers(history.document.layers, editableIds);
        setAllLayers(layers);
        setSelectedIds(newIds);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        const copies = history.document.layers.filter((l) => editableIds.includes(l.id));
        setClipboard(copies.map((l) => ({ ...l, cssVars: { ...l.cssVars } })));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        if (!clipboard.length) return;
        const withIds = clipboard.map((l) => ({ ...l, pageIndex }));
        const temp = [...history.document.layers, ...withIds];
        const { layers, newIds } = duplicateLayers(
          temp,
          withIds.map((l) => l.id),
        );
        const originalClipIds = new Set(withIds.map((l) => l.id));
        setAllLayers(layers.filter((l) => !originalClipIds.has(l.id)));
        setSelectedIds(newIds);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        if (e.shiftKey && editableIds.length === 1) {
          const layer = history.document.layers.find((l) => l.id === editableIds[0]);
          if (layer?.type === 'group') {
            setAllLayers(ungroupLayers(history.document.layers, layer.id));
          }
        } else if (editableIds.length >= 2) {
          const { layers, groupId } = groupLayers(history.document.layers, editableIds);
          setAllLayers(layers);
          setSelectedIds([groupId]);
        }
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
        if (selectedIds.length) setSelectedIds([]);
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
    history,
    onSave,
    clipboard,
    pageIndex,
    pageLayers,
    tool,
    zoomToFit,
    editingLayerId,
    commitInlineEdit,
    startInlineEdit,
  ]);

  const selected = history.document.layers.find((l) => l.id === selectedId) || null;

  const addLayerAt = (type: PlaceableTool, rect: DrawRect) => {
    const layerType = type as Exclude<CanvasLayerType, 'frame' | 'group'>;
    const layer = createLayer(layerType);
    layer.pageIndex = pageIndex;
    const defaults = DEFAULT_SIZES[type] ?? { w: 40, h: 30 };
    const useDefault = isClickPlace(rect) || (rect.w === 0 && rect.h === 0);
    const w = useDefault ? defaults.w : Math.max(type === 'line' ? 1 : 4, rect.w);
    const h = useDefault ? defaults.h : Math.max(type === 'line' ? 0.5 : 4, rect.h);
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
      layer.cssVars['--background-color'] = layer.cssVars['--background-color'] || '#000000';
      layer.cssVars['--height'] = mm(Math.max(0.5, useDefault ? 1 : Math.min(h, 2)));
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
    history.setDocument({
      ...history.document,
      layers,
      fields:
        type === 'field' && layer.meta?.key
          ? [
              ...history.document.fields.filter((f) => f.key !== layer.meta!.key),
              { id: newId(), key: layer.meta.key, label: layer.meta.key },
            ]
          : history.document.fields,
    });
    setSelectedIds([layer.id]);
    setTool('select');
    if (type === 'text') {
      editBaselineRef.current = cloneDocument({ ...history.document, layers });
      setEditingLayerId(layer.id);
    }
    setStatus(`Capa «${layer.name}» creada`);
    setTimeout(() => setStatus(null), 1500);
  };

  const onDuplicate = async () => {
    try {
      await api.canvasSave(history.document);
      const res = await api.canvasDuplicate(history.document.id);
      history.replaceDocument(normalizeDocument(res.document as CanvasDocument));
      setSelectedIds([]);
      setPageIndex(0);
      await refreshList();
      setStatus('Duplicado');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Error al duplicar');
    }
  };

  const onDeleteDoc = async () => {
    try {
      await api.canvasDelete(history.document.id);
      const list = await api.canvasList();
      if (list.documents.length) {
        const got = await api.canvasGet(list.documents[0].id);
        history.replaceDocument(normalizeDocument(got.document as CanvasDocument));
        setDocs(list.documents);
      } else {
        const created = await api.canvasCreate('Sin título');
        history.replaceDocument(normalizeDocument(created.document as CanvasDocument));
        setDocs([{ id: created.document.id, name: created.document.name }]);
      }
      setSelectedIds([]);
      setPageIndex(0);
      setPan({ x: 0, y: 0 });
      setStatus('Documento eliminado');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Error al eliminar');
    }
  };

  const onOpenDoc = async (id: string) => {
    if (!id || id === history.document.id) return;
    try {
      await api.canvasSave(history.document);
      const res = await api.canvasGet(id);
      history.replaceDocument(normalizeDocument(res.document as CanvasDocument));
      setSelectedIds([]);
      setPageIndex(0);
      setPan({ x: 0, y: 0 });
      await refreshList();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Error al abrir');
    }
  };

  const onNew = async () => {
    try {
      await api.canvasSave(history.document);
      const res = await api.canvasCreate('Sin título');
      history.replaceDocument(normalizeDocument(res.document as CanvasDocument));
      setSelectedIds([]);
      setPageIndex(0);
      setPan({ x: 0, y: 0 });
      await refreshList();
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

  const onApplyPreset = (presetId: string) => {
    const preset = CANVAS_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const doc = preset.create();
    doc.id = history.document.id;
    doc.name = history.document.name;
    history.setDocument(doc);
    setSelectedIds([]);
    setPageIndex(0);
  };

  const onDeleteLayer = (id: string) => {
    setAllLayers(deleteLayers(history.document.layers, [id]));
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  };

  const onContextAction = (action: CanvasContextAction) => {
    const id = contextMenu?.layerId;
    if (!id) return;
    const layer = history.document.layers.find((l) => l.id === id);
    if (!layer || layer.type === 'frame') return;

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
    if (layer.locked) return;

    if (action === 'duplicate') {
      const { layers, newIds } = duplicateLayers(history.document.layers, [id]);
      setAllLayers(layers);
      setSelectedIds(newIds);
      return;
    }
    if (action === 'bringFront') {
      setAllLayers(bringToFront(history.document.layers, [id]));
      return;
    }
    if (action === 'sendBack') {
      setAllLayers(sendToBack(history.document.layers, [id]));
      return;
    }
    if (action === 'delete') {
      onDeleteLayer(id);
    }
  };

  const onAlign = (align: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (selectedIds.length < 2) return;
    setAllLayers(alignLayers(history.document.layers, selectedIds, align));
  };

  const onDistribute = (axis: 'horizontal' | 'vertical') => {
    if (selectedIds.length < 3) return;
    setAllLayers(distributeLayers(history.document.layers, selectedIds, axis));
  };

  const editableSelectedIds = selectedIds.filter((id) => {
    const layer = history.document.layers.find((l) => l.id === id);
    return layer && layer.type !== 'frame';
  });

  const onReorderLayers = (draggedId: string, targetId: string, position: 'before' | 'after') => {
    setAllLayers(reorderAmongSiblings(history.document.layers, draggedId, targetId, position));
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
        onToggleShortcuts={() => setShowShortcuts((v) => !v)}
        onNameChange={onRename}
        onMode={(next) => {
          setMode(next);
          setContextMenu(null);
          setShowShortcuts(false);
        }}
        onUndo={history.undo}
        onRedo={history.redo}
        onSave={() => void onSave()}
        onDuplicate={() => void onDuplicate()}
      />

      {mode === 'design' ? (
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <LeftSidebar
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
            onApplyPreset={onApplyPreset}
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
            onReorderSibling={onReorderLayers}
            onToggleVisible={(id, visible) => setAllLayers(setLayerVisible(history.document.layers, id, visible))}
            onToggleLocked={(id, locked) => setAllLayers(setLayerLocked(history.document.layers, id, locked))}
            onRenameLayer={(id, name) => {
              const layer = history.document.layers.find((l) => l.id === id);
              if (!layer || layer.locked || layer.type === 'frame') return;
              setAllLayers(history.document.layers.map((l) => (l.id === id ? { ...l, name } : l)));
            }}
          />
          <div className="relative h-full min-h-0 min-w-0 flex-1">
            <Artboard
              document={{ ...history.document, layers: pageLayers }}
              selectedIds={selectedIds}
              zoom={zoom}
              tool={tool}
              pan={pan}
              editingLayerId={editingLayerId}
              onPan={setPan}
              onSelect={onSelect}
              onSelectIds={(ids) => {
                if (editingLayerId && (ids.length !== 1 || ids[0] !== editingLayerId)) {
                  commitInlineEdit();
                }
                setSelectedIds(ids);
              }}
              onChangeLayers={setPageLayers}
              onZoom={setZoom}
              onDrawLayer={(drawTool, rect) => {
                if (drawTool === 'select' || drawTool === 'hand') return;
                addLayerAt(drawTool, rect);
              }}
              onStartEdit={startInlineEdit}
              onEditValue={onInlineEditValue}
              onCommitEdit={commitInlineEdit}
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
                });
              }}
            />
            <BottomToolbar tool={tool} onTool={setTool} />
            <div className="canvas-viewport-zoom">
              <ZoomMenu zoom={zoom} onZoom={setZoom} onZoomFit={zoomToFit} />
            </div>
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
          </div>
          <RightPanel
            layer={selected}
            selectedCount={selectedIds.length}
            pageColors={collectDocumentColors(history.document.layers)}
            onChange={(layer) => {
              if (panelBaselineRef.current) onPanelCommitLive();
              setAllLayers(history.document.layers.map((l) => (l.id === layer.id ? layer : l)));
            }}
            onChangeLive={onPanelChangeLive}
            onCommitLive={onPanelCommitLive}
            onDelete={onDeleteLayer}
            onAlign={onAlign}
            onDistribute={onDistribute}
            onBulkVisible={(visible) =>
              setAllLayers(setLayersVisible(history.document.layers, editableSelectedIds, visible))
            }
            onBulkLocked={(locked) =>
              setAllLayers(setLayersLocked(history.document.layers, editableSelectedIds, locked))
            }
            onBulkOpacity={(opacity) =>
              setAllLayers(setLayersOpacity(history.document.layers, editableSelectedIds, opacity))
            }
            onBringFront={() => setAllLayers(bringToFront(history.document.layers, selectedIds))}
            onSendBack={() => setAllLayers(sendToBack(history.document.layers, selectedIds))}
            imagesPerPage={history.document.settings?.imagesPerPage ?? 4}
            onImagesPerPage={(n) =>
              history.setDocument({
                ...history.document,
                settings: { ...history.document.settings, imagesPerPage: n },
              })
            }
          />
        </div>
      ) : (
        <GeneratePanel document={history.document} />
      )}
    </div>
  );
}
