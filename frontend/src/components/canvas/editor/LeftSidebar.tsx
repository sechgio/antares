import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Group,
  Image as ImageIcon,
  Minus,
  Plus,
  Square,
  Slash,
  Type,
  Layers,
  Trash2,
  Table2,
  Grid3X3,
  CheckSquare,
  Circle,
  PenLine,
  ArrowUpRight,
  Triangle,
  Star,
  Diamond,
  Hexagon,
  Pentagon,
  Lock,
  Unlock,
  Ungroup,
  PanelLeftClose,
  Search,
  Component,
  Frame,
} from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import {
  ancestorIds,
  buildLayerTree,
  expandAncestorsForSelection,
  flattenLayerTree,
  isLayerContainer,
  reconcileExpandedContainers,
} from '../ops/layerTree';
import {
  LAYER_ROW_H,
  LAYER_VIRTUALIZE_AT,
  clampLayerScrollTop,
  layerVirtualWindow,
  nextLayerRowIndex,
  scrollTopToRevealIndex,
} from '../ops/layerListWindow';
import { clampLeftPanelWidth } from '../ops/panelChrome';
import { createGestureRaf } from '../ops/gestureRaf';
import type { CanvasDocumentSummary, CanvasLayer } from '../types';
import { getThumbnailUrl } from '../utils/imageBlobStore';
import { VisibilityIcon } from './VisibilityIcon';
import PageContextMenu, { type PageContextMenuState } from './PageContextMenu';
import CanvasSelect from './CanvasSelect';

interface LeftSidebarProps {
  documentName: string;
  docs: CanvasDocumentSummary[];
  documentId: string;
  layers: CanvasLayer[];
  selectedIds: string[];
  pageIndex: number;
  pageCount: number;
  pages?: Array<{ id: string; name: string }>;
  onSelect: (id: string, additive?: boolean) => void;
  onOpenDoc: (id: string) => void;
  onNew: () => void;
  onDeleteDoc: () => void;
  onPageChange: (index: number) => void;
  onAddPage: () => void;
  onRemovePage: (index: number) => void;
  onDuplicatePage: (index: number) => void;
  onRenamePage: (index: number, name: string) => void;
  onMoveLayer: (
    draggedId: string,
    targetId: string,
    position: 'before' | 'after' | 'inside',
  ) => void;
  onGroupSelected: () => void;
  onUngroupSelected: () => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onToggleLocked: (id: string, locked: boolean) => void;
  onRenameLayer: (id: string, name: string) => void;
  renameRequest?: { layerId: string; nonce: number } | null;
  open?: boolean;
  onHidePanel?: () => void;
  hidePanelDisabled?: boolean;
  docsSyncing?: boolean;
  width?: number;
  onWidthChange?: (width: number) => void;
}

type CapasDropPosition = 'before' | 'after' | 'inside';

function capasDropPosition(
  layer: CanvasLayer,
  clientY: number,
  rowTop: number,
  rowHeight: number,
): CapasDropPosition {
  const y = clientY - rowTop;
  if (isLayerContainer(layer)) {
    if (y < rowHeight / 3) return 'before';
    if (y > (rowHeight * 2) / 3) return 'after';
    return 'inside';
  }
  return y < rowHeight / 2 ? 'before' : 'after';
}

function layerIcon(type: CanvasLayer['type'], value?: string) {
  if (type === 'image' && value) {
    const thumb = getThumbnailUrl(value);
    if (thumb) {
      return <img src={thumb} className="h-3 w-3 object-cover rounded-[2px]" alt="" />;
    }
  }
  if (type === 'text' || type === 'field') return <Type className="h-3 w-3" />;
  if (type === 'rect') return <Square className="h-3 w-3" />;
  if (type === 'table') return <Table2 className="h-3 w-3" />;
  if (type === 'grid') return <Grid3X3 className="h-3 w-3" />;
  if (type === 'group') return <Group className="h-3 w-3" />;
  if (type === 'component') return <Component className="h-3 w-3" />;
  if (type === 'frame') return <Frame className="h-3 w-3" />;
  if (type === 'checkbox') return <CheckSquare className="h-3 w-3" />;
  if (type === 'signature') return <PenLine className="h-3 w-3" />;
  if (type === 'line') return <Slash className="h-3 w-3" />;
  if (type === 'ellipse') return <Circle className="h-3 w-3" />;
  if (type === 'arrow') return <ArrowUpRight className="h-3 w-3" />;
  if (type === 'polygon') return <Triangle className="h-3 w-3" />;
  if (type === 'star') return <Star className="h-3 w-3" />;
  if (type === 'diamond') return <Diamond className="h-3 w-3" />;
  if (type === 'hexagon') return <Hexagon className="h-3 w-3" />;
  if (type === 'pentagon') return <Pentagon className="h-3 w-3" />;
  if (type === 'imageSlot' || type === 'image' || type === 'logo') return <ImageIcon className="h-3 w-3" />;
  return <Layers className="h-3 w-3" />;
}

interface LayerRowProps {
  layer: CanvasLayer;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  selected: boolean;
  renaming: boolean;
  renameDraft: string;
  dropPosition: CapasDropPosition | null;
  layerRenameRef: RefObject<HTMLInputElement | null>;
  onToggleExpanded: (id: string) => void;
  onSelect: (id: string, additive?: boolean) => void;
  onStartRename: (id: string, name: string) => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onToggleLocked: (id: string, locked: boolean) => void;
  onMoveLayer: (draggedId: string, targetId: string, position: CapasDropPosition) => void;
  onDropHover: (id: string, position: CapasDropPosition | null) => void;
}

const LayerRow = memo(function LayerRow({
  layer,
  depth,
  hasChildren,
  expanded,
  selected,
  renaming,
  renameDraft,
  dropPosition,
  layerRenameRef,
  onToggleExpanded,
  onSelect,
  onStartRename,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onToggleVisible,
  onToggleLocked,
  onMoveLayer,
  onDropHover,
}: LayerRowProps) {
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const hidden = layer.visible === false;
  const locked = Boolean(layer.locked);

  return (
    <li>
      <div
        className="canvas-list-row"
        data-layer-id={layer.id}
        data-selected={selected}
        data-dimmed={hidden}
        data-locked={locked}
        data-container={isLayerContainer(layer)}
        data-component={layer.type === 'component'}
        data-drop={dropPosition ?? undefined}
        draggable={!locked && !renaming}
        onDragStart={(e) => {
          if (locked) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData('text/plain', layer.id);
          e.dataTransfer.effectAllowed = 'move';
          const ghost = document.createElement('div');
          ghost.className = 'canvas-layer-drag-ghost';
          ghost.textContent = layer.name;
          document.body.appendChild(ghost);
          dragGhostRef.current = ghost;
          e.dataTransfer.setDragImage(ghost, 12, 12);
        }}
        onDragEnd={() => {
          dragGhostRef.current?.remove();
          dragGhostRef.current = null;
          onDropHover(layer.id, null);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onDropHover(layer.id, capasDropPosition(layer, e.clientY, rect.top, rect.height));
        }}
        onDragLeave={(e) => {
          const related = e.relatedTarget as Node | null;
          if (related && e.currentTarget.contains(related)) return;
          onDropHover(layer.id, null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDropHover(layer.id, null);
          const draggedId = e.dataTransfer.getData('text/plain');
          if (!draggedId || draggedId === layer.id) return;
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onMoveLayer(
            draggedId,
            layer.id,
            capasDropPosition(layer, e.clientY, rect.top, rect.height),
          );
        }}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="canvas-list-chevron"
            aria-label={expanded ? 'Colapsar' : 'Expandir'}
            aria-expanded={expanded}
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onToggleExpanded(layer.id)}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : (
          <span className="canvas-list-chevron-spacer" aria-hidden />
        )}
        {renaming ? (
          <div className="canvas-list-label">
            <span className="canvas-list-type-icon">{layerIcon(layer.type, layer.value)}</span>
            <input
              ref={layerRenameRef}
              className="canvas-input canvas-input--inline min-w-0 flex-1"
              value={renameDraft}
              aria-label="Nombre de capa"
              onChange={(e) => onRenameDraftChange(e.target.value)}
              onBlur={onCommitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onCommitRename();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onCancelRename();
                }
              }}
            />
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            className="canvas-list-label"
            aria-pressed={selected}
            title={layer.name}
            onClick={(e) => onSelect(layer.id, e.shiftKey || e.ctrlKey || e.metaKey)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(layer.id, e.shiftKey || e.ctrlKey || e.metaKey);
              }
            }}
            onDoubleClick={(e) => {
              e.preventDefault();
              if (locked) return;
              onStartRename(layer.id, layer.name);
            }}
          >
            <span className="canvas-list-type-icon">{layerIcon(layer.type, layer.value)}</span>
            <span className="canvas-list-name">{layer.name}</span>
          </div>
        )}
        <div className="canvas-list-row-actions">
          <button
            type="button"
            className="canvas-list-action"
            aria-label={locked ? 'Desbloquear' : 'Bloquear'}
            aria-pressed={locked}
            title={locked ? 'Desbloquear capa' : 'Bloquear capa'}
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onToggleLocked(layer.id, !locked)}
          >
            {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          </button>
          <button
            type="button"
            className="canvas-list-action"
            aria-label="Visibilidad"
            aria-pressed={!hidden}
            title={hidden ? 'Mostrar capa' : 'Ocultar capa'}
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onToggleVisible(layer.id, hidden)}
          >
            <VisibilityIcon visible={!hidden} className="h-3 w-3" />
          </button>
        </div>
      </div>
    </li>
  );
});

export default memo(function LeftSidebar({
  documentName,
  docs,
  documentId,
  layers,
  selectedIds,
  pageIndex,
  pageCount,
  pages,
  onSelect,
  onOpenDoc,
  onNew,
  onDeleteDoc,
  onPageChange,
  onAddPage,
  onRemovePage,
  onDuplicatePage,
  onRenamePage,
  onMoveLayer,
  onGroupSelected,
  onUngroupSelected,
  onToggleVisible,
  onToggleLocked,
  onRenameLayer,
  renameRequest = null,
  open = true,
  onHidePanel,
  hidePanelDisabled = false,
  docsSyncing = false,
  width = 248,
  onWidthChange,
}: LeftSidebarProps) {
  const tree = useMemo(() => buildLayerTree(layers), [layers]);
  const layersById = useMemo(() => new Map(layers.map((layer) => [layer.id, layer])), [layers]);
  const containerIds = useMemo(
    () => layers.filter((l) => isLayerContainer(l)).map((l) => l.id),
    [layers],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const canGroupSelected = useMemo(() => {
    let n = 0;
    for (const id of selectedIds) {
      const layer = layersById.get(id);
      if (layer && !layer.locked && layer.type !== 'frame') n += 1;
      if (n >= 2) return true;
    }
    return false;
  }, [layersById, selectedIds]);
  const canUngroupSelected = useMemo(() => {
    if (selectedIds.length !== 1) return false;
    const layer = layersById.get(selectedIds[0]!);
    return Boolean(layer && (layer.type === 'group' || layer.type === 'component') && !layer.locked);
  }, [layersById, selectedIds]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(containerIds));
  const knownContainerIdsRef = useRef<Set<string>>(new Set(containerIds));
  const documentIdRef = useRef(documentId);
  const pendingRevealIdRef = useRef<string | null>(null);
  const lastRevealedKeyRef = useRef('');
  const [layerQuery, setLayerQuery] = useState('');
  const [layerScrollTop, setLayerScrollTop] = useState(0);
  const [layerListHeight, setLayerListHeight] = useState(400);
  const [pageMenu, setPageMenu] = useState<PageContextMenuState | null>(null);
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [dropHover, setDropHover] = useState<{
    id: string;
    position: CapasDropPosition;
  } | null>(null);
  const [resizing, setResizing] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const layerRenameRef = useRef<HTMLInputElement>(null);
  const layerListRef = useRef<HTMLUListElement>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const fileOptions = useMemo(() => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    byId.set(documentId, {
      id: documentId,
      name: documentName.trim() || byId.get(documentId)?.name || 'Sin título',
    });
    return [...byId.values()];
  }, [docs, documentId, documentName]);

  useEffect(() => {
    if (documentIdRef.current !== documentId) {
      documentIdRef.current = documentId;
      knownContainerIdsRef.current = new Set();
      setExpandedIds(new Set());
      setLayerQuery('');
      setLayerScrollTop(0);
      if (layerListRef.current) layerListRef.current.scrollTop = 0;
    }
    setExpandedIds((prev) => {
      const { expanded, known } = reconcileExpandedContainers(
        prev,
        knownContainerIdsRef.current,
        containerIds,
      );
      knownContainerIdsRef.current = known;
      if (expanded.size === prev.size) {
        let same = true;
        for (const id of expanded) {
          if (!prev.has(id)) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return expanded;
    });
  }, [containerIds, documentId]);



  useEffect(() => {
    if (renamingIndex === null) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingIndex]);

  useEffect(() => {
    if (renamingLayerId === null) return;
    layerRenameRef.current?.focus();
    layerRenameRef.current?.select();
  }, [renamingLayerId]);

  const commitRename = () => {
    if (renamingIndex === null) return;
    onRenamePage(renamingIndex, renameDraft);
    setRenamingIndex(null);
  };

  const commitLayerRename = useCallback(() => {
    if (renamingLayerId === null) return;
    const name = renameDraft.trim();
    if (name) onRenameLayer(renamingLayerId, name);
    setRenamingLayerId(null);
  }, [renamingLayerId, renameDraft, onRenameLayer]);

  const cancelLayerRename = useCallback(() => {
    setRenamingLayerId(null);
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!onWidthChange || hidePanelDisabled || !open) return;
      event.preventDefault();
      const handle = event.currentTarget;
      const originX = event.clientX;
      const originW = width;
      handle.setPointerCapture(event.pointerId);
      setResizing(true);
      const raf = createGestureRaf((next: number) => onWidthChange(next));
      const onMove = (ev: PointerEvent) => {
        raf.schedule(clampLeftPanelWidth(originW + (ev.clientX - originX)));
      };
      const onUp = () => {
        raf.flush();
        setResizing(false);
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    },
    [hidePanelDisabled, onWidthChange, open, width],
  );

  const startLayerRename = useCallback((id: string, name: string) => {
    setRenameDraft(name);
    setRenamingLayerId(id);
  }, []);

  const lastRenameNonceRef = useRef(-1);
  useEffect(() => {
    if (!renameRequest || renameRequest.nonce === lastRenameNonceRef.current) return;
    lastRenameNonceRef.current = renameRequest.nonce;
    const layer = layers.find((l) => l.id === renameRequest.layerId);
    if (layer && !layer.locked) startLayerRename(layer.id, layer.name);
  }, [renameRequest, layers, startLayerRename]);

  const onDropHover = useCallback((id: string, position: CapasDropPosition | null) => {
    if (position === 'inside') {
      setExpandedIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
    setDropHover((prev) => {
      if (position == null) {
        return prev?.id === id ? null : prev;
      }
      if (prev?.id === id && prev.position === position) return prev;
      return { id, position };
    });
  }, []);

  const rows = useMemo(() => {
    const query = layerQuery.trim().toLowerCase();
    const matches = (layer: CanvasLayer) => {
      if (!query) return true;
      return (
        layer.name.toLowerCase().includes(query) ||
        layer.type.toLowerCase().includes(query) ||
        Boolean(layer.meta?.key?.toLowerCase().includes(query))
      );
    };
    if (!query) return flattenLayerTree(tree, expandedIds);

    const expandAll = new Set(containerIds);
    const flat = flattenLayerTree(tree, expandAll);
    const matchIds = new Set(flat.filter((r) => matches(r.layer)).map((r) => r.layer.id));
    const keep = new Set(matchIds);
    for (const id of matchIds) {
      for (const aid of ancestorIds(layersById, id)) keep.add(aid);
    }
    return flat.filter((r) => keep.has(r.layer.id));
  }, [tree, expandedIds, layerQuery, containerIds, layersById]);
  const pageLabel = (i: number) => pages?.[i]?.name ?? `Página ${i + 1}`;

  useEffect(() => {
    const el = layerListRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h && h > 0) setLayerListHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const virtualizeLayers = rows.length >= LAYER_VIRTUALIZE_AT;
  const layerWindow = useMemo(() => {
    if (!virtualizeLayers) {
      const scrollTop = clampLayerScrollTop(layerScrollTop, rows.length, layerListHeight);
      return { start: 0, end: rows.length, padTop: 0, padBottom: 0, scrollTop };
    }
    return layerVirtualWindow({
      rowCount: rows.length,
      scrollTop: layerScrollTop,
      listHeight: layerListHeight,
    });
  }, [virtualizeLayers, rows.length, layerListHeight, layerScrollTop]);
  const visibleRows = virtualizeLayers ? rows.slice(layerWindow.start, layerWindow.end) : rows;

  useLayoutEffect(() => {
    const el = layerListRef.current;
    if (!el) return;
    if (el.scrollTop !== layerWindow.scrollTop) el.scrollTop = layerWindow.scrollTop;
    if (layerWindow.scrollTop !== layerScrollTop) setLayerScrollTop(layerWindow.scrollTop);
  }, [layerWindow.scrollTop, layerScrollTop, rows.length]);

  useLayoutEffect(() => {
    const id = selectedIds[selectedIds.length - 1];
    const selectionKey = selectedIds.join('\0');
    if (!id) {
      pendingRevealIdRef.current = null;
      lastRevealedKeyRef.current = '';
      return;
    }
    if (selectionKey === lastRevealedKeyRef.current && !pendingRevealIdRef.current) return;

    const nextExpanded = expandAncestorsForSelection(expandedIds, layersRef.current, selectedIds);
    if (nextExpanded !== expandedIds) {
      pendingRevealIdRef.current = id;
      setExpandedIds(nextExpanded);
      return;
    }

    const index = rows.findIndex((row) => row.layer.id === id);
    if (index < 0) {
      pendingRevealIdRef.current = id;
      return;
    }

    const el = layerListRef.current;
    const listHeight = (el?.clientHeight && el.clientHeight > 0 ? el.clientHeight : layerListHeight);
    const current = el?.scrollTop ?? layerScrollTop;
    const nextScroll = scrollTopToRevealIndex(index, LAYER_ROW_H, listHeight, current);
    pendingRevealIdRef.current = null;
    lastRevealedKeyRef.current = selectionKey;
    if (el && el.scrollTop !== nextScroll) el.scrollTop = nextScroll;
    if (nextScroll !== layerScrollTop) setLayerScrollTop(nextScroll);
  }, [selectedIds, rows, expandedIds, layerListHeight, layerScrollTop]);

  const onLayerListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const currentId = selectedIds[selectedIds.length - 1];
    const currentIndex = currentId ? rows.findIndex((row) => row.layer.id === currentId) : -1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const nextIndex = nextLayerRowIndex(currentIndex, rows.length, event.key === 'ArrowDown' ? 1 : -1);
      const next = rows[nextIndex];
      if (next && next.layer.id !== currentId) onSelect(next.layer.id, event.shiftKey);
      return;
    }
    if (!currentId) return;
    const current = rows[currentIndex];
    if (!current?.hasChildren) return;
    if (event.key === 'ArrowRight' && !expandedIds.has(currentId)) toggleExpanded(currentId);
    if (event.key === 'ArrowLeft' && expandedIds.has(currentId)) toggleExpanded(currentId);
  };

  return (
    <aside
      className={
        open
          ? 'canvas-panel canvas-panel-chrome canvas-panel-chrome--left flex h-full shrink-0 flex-col overflow-hidden border-r'
          : 'canvas-panel canvas-panel-chrome canvas-panel-chrome--left flex h-full w-0 min-w-0 shrink-0 flex-col overflow-hidden border-r-0'
      }
      style={open ? { width } : undefined}
      data-open={open ? 'true' : 'false'}
      data-resizing={resizing ? 'true' : undefined}
      data-testid="canvas-left-panel"
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div className="canvas-left-files canvas-section">
        <div className="canvas-section-header canvas-sidebar-heading">
          <span className="canvas-section-title">Archivos</span>
          <div className="flex gap-0.5">
            <WithHoverTooltip label="Nuevo" placement="bottom" variant="dark">
              <button type="button" className="canvas-icon-btn !h-6 !w-6" onClick={onNew} aria-label="Nuevo">
                <Plus className="h-3 w-3" />
              </button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Eliminar" placement="bottom" variant="dark">
              <button
                type="button"
                className="canvas-icon-btn !h-6 !w-6"
                onClick={onDeleteDoc}
                aria-label="Eliminar documento"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </WithHoverTooltip>
            {onHidePanel && (
              <WithHoverTooltip label="Ocultar panel izquierdo" placement="bottom" variant="dark">
                <button
                  type="button"
                  className="canvas-icon-btn !h-6 !w-6"
                  data-testid="canvas-toggle-left-panel"
                  disabled={hidePanelDisabled}
                  onClick={onHidePanel}
                  aria-label="Ocultar panel izquierdo"
                >
                  <PanelLeftClose className="h-3 w-3" />
                </button>
              </WithHoverTooltip>
            )}
          </div>
        </div>
        <div aria-busy={docsSyncing || undefined}>
          <CanvasSelect
            value={documentId}
            onChange={(val) => onOpenDoc(val)}
            aria-label="Archivo abierto"
            className={`canvas-document-picker${docsSyncing ? ' animate-pulse' : ''}`}
            options={fileOptions.map((d) => ({
              value: d.id,
              label: d.name,
              icon: <FileText className="h-3.5 w-3.5 text-[var(--cv-text-muted)]" aria-hidden="true" />,
            }))}
          />
        </div>
      </div>

      <div className="canvas-left-pages canvas-section">
        <div className="canvas-section-header canvas-sidebar-heading">
          <span className="canvas-section-title">
            Páginas
          </span>
          <span className="canvas-section-count" data-testid="canvas-pages-count" aria-label={`${pageCount} páginas`}>
            {pageCount}
          </span>
          <div className="flex gap-0.5">
            <WithHoverTooltip label="Añadir página" placement="bottom" variant="dark">
              <button type="button" className="canvas-icon-btn !h-6 !w-6" onClick={onAddPage} aria-label="Añadir página">
                <Plus className="h-3 w-3" />
              </button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Quitar página" placement="bottom" variant="dark">
              <button
                type="button"
                className="canvas-icon-btn !h-6 !w-6"
                onClick={() => onRemovePage(pageIndex)}
                aria-label="Quitar página"
                disabled={pageCount <= 1}
              >
                <Minus className="h-3 w-3" />
              </button>
            </WithHoverTooltip>
          </div>
        </div>
        <div className="canvas-page-list">
          {Array.from({ length: pageCount }, (_, i) => (
            renamingIndex === i ? (
              <input
                key={pages?.[i]?.id ?? i}
                ref={renameInputRef}
                className="canvas-input canvas-input--inline w-full py-1.5"
                value={renameDraft}
                aria-label="Nombre de página"
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenamingIndex(null);
                  }
                }}
              />
            ) : (
              <button
                key={pages?.[i]?.id ?? i}
                type="button"
                onClick={() => onPageChange(i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onPageChange(i);
                  setPageMenu({ x: e.clientX, y: e.clientY, pageIndex: i });
                }}
                className="canvas-page-row"
                aria-current={pageIndex === i ? 'page' : undefined}
                aria-label={`${pageLabel(i)} A4`}
                title={`${pageLabel(i)} · A4`}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{pageLabel(i)}</span>
                <span className="canvas-page-format">A4</span>
              </button>
            )
          ))}
        </div>
        {pageMenu && (
          <PageContextMenu
            menu={pageMenu}
            canDelete={pageCount > 1}
            onClose={() => setPageMenu(null)}
            onAction={(action) => {
              const index = pageMenu.pageIndex;
              if (action === 'rename') {
                setRenameDraft(pageLabel(index));
                setRenamingIndex(index);
                return;
              }
              if (action === 'duplicate') {
                onDuplicatePage(index);
                return;
              }
              onRemovePage(index);
            }}
          />
        )}
      </div>

      <div className="canvas-left-layers flex min-h-0 flex-1 flex-col">
        <div className="canvas-section-header canvas-layers-header">
          <span className="canvas-section-title min-w-0">Capas</span>
          <span className="canvas-section-count" data-testid="canvas-layers-count" aria-label={`${rows.length} capas`}>
            {rows.length}
          </span>
          <WithHoverTooltip label="Agrupar (Ctrl+G)" placement="bottom" variant="dark">
            <button
              type="button"
              className="canvas-icon-btn !h-6 !w-6"
              aria-label="Agrupar"
              disabled={!canGroupSelected}
              onClick={onGroupSelected}
            >
              <Group className="h-3.5 w-3.5" />
            </button>
          </WithHoverTooltip>
          <WithHoverTooltip label="Desagrupar (Ctrl+Shift+G)" placement="bottom" variant="dark">
            <button
              type="button"
              className="canvas-icon-btn !h-6 !w-6"
              aria-label="Desagrupar"
              disabled={!canUngroupSelected}
              onClick={onUngroupSelected}
            >
              <Ungroup className="h-3.5 w-3.5" />
            </button>
          </WithHoverTooltip>
        </div>
        <div className="canvas-layer-search">
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          <input
            type="search"
            className="canvas-input"
            placeholder="Buscar capas…"
            value={layerQuery}
            aria-label="Buscar capas"
            onChange={(e) => setLayerQuery(e.target.value)}
          />
        </div>
        <ul
          ref={layerListRef}
          className="min-h-0 flex-1 overflow-y-auto px-1 pb-3"
          data-testid="canvas-layer-list"
          data-window-start={layerWindow.start}
          data-window-end={layerWindow.end}
          tabIndex={0}
          aria-label="Capas"
          onKeyDown={onLayerListKeyDown}
          onScroll={(e) => {
            const next = (e.currentTarget as HTMLUListElement).scrollTop;
            setLayerScrollTop((prev) => (prev === next ? prev : next));
          }}
        >
          {layerWindow.padTop > 0 && (
            <li aria-hidden style={{ height: layerWindow.padTop, listStyle: 'none' }} />
          )}
          {visibleRows.map((row) => {
            const { layer, depth, hasChildren } = row;
            return (
              <LayerRow
                key={layer.id}
                layer={layer}
                depth={depth}
                hasChildren={hasChildren}
                expanded={expandedIds.has(layer.id)}
                selected={selectedIdSet.has(layer.id)}
                renaming={renamingLayerId === layer.id}
                renameDraft={renamingLayerId === layer.id ? renameDraft : ''}
                dropPosition={dropHover?.id === layer.id ? dropHover.position : null}
                layerRenameRef={layerRenameRef}
                onToggleExpanded={toggleExpanded}
                onSelect={onSelect}
                onStartRename={startLayerRename}
                onRenameDraftChange={setRenameDraft}
                onCommitRename={commitLayerRename}
                onCancelRename={cancelLayerRename}
                onToggleVisible={onToggleVisible}
                onToggleLocked={onToggleLocked}
                onMoveLayer={onMoveLayer}
                onDropHover={onDropHover}
              />
            );
          })}
          {layerWindow.padBottom > 0 && (
            <li aria-hidden style={{ height: layerWindow.padBottom, listStyle: 'none' }} />
          )}
          {rows.length === 0 && (
            <li className="canvas-empty-hint">
              {layerQuery.trim() ? (
                <>
                  <strong>No se encontraron capas</strong>
                  <span>Prueba otro nombre o tipo.</span>
                </>
              ) : (
                <>
                  <strong>Sin capas todavía</strong>
                  <span>Usa la barra inferior o aplica un preset.</span>
                </>
              )}
            </li>
          )}
        </ul>
      </div>
      {open && onWidthChange ? (
        <div
          className="canvas-panel-resizer"
          data-testid="canvas-left-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Ancho del panel izquierdo"
          aria-valuemin={200}
          aria-valuemax={420}
          aria-valuenow={width}
          onPointerDown={onResizePointerDown}
        />
      ) : null}
    </aside>
  );
});
