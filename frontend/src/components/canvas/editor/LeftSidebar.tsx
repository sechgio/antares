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
} from 'react';
import {
  FileText,
  Group,
  Minus,
  Plus,
  Trash2,
  Ungroup,
  PanelLeftClose,
  Search,
  LayoutTemplate,
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
import PageContextMenu, { type PageContextMenuState } from './PageContextMenu';
import CanvasSelect from './CanvasSelect';
import { LayerRow, type CapasDropPosition } from './LayerRow';
import Button from '@/components/ui/Button';

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
  onOpenTemplates?: () => void;
  onPageChange: (index: number) => void;
  onAddPage: () => void;
  onRemovePage: (index: number) => void;
  onDuplicatePage: (index: number) => void;
  onRenamePage: (index: number, name: string) => void;
  onReorderPage?: (fromIndex: number, toIndex: number) => void;
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
  onOpenTemplates,
  onPageChange,
  onAddPage,
  onRemovePage,
  onDuplicatePage,
  onRenamePage,
  onReorderPage,
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
  const lastRevealedRowsRef = useRef<unknown>(null);
  const [layerQuery, setLayerQuery] = useState('');
  const [layerScrollTop, setLayerScrollTop] = useState(0);
  const [layerListHeight, setLayerListHeight] = useState(400);
  const [pageMenu, setPageMenu] = useState<PageContextMenuState | null>(null);
  const pageDragIndexRef = useRef<number | null>(null);
  const [pageDropIndex, setPageDropIndex] = useState<number | null>(null);
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
      const cleanup = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };
      const onUp = () => {
        raf.flush();
        setResizing(false);
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch {
          // Pointer capture may already have been released by the browser.
        } finally {
          cleanup();
        }
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
      lastRevealedRowsRef.current = null;
      return;
    }
    if (
      selectionKey === lastRevealedKeyRef.current
      && lastRevealedRowsRef.current === rows
      && !pendingRevealIdRef.current
    ) return;

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
    lastRevealedRowsRef.current = rows;
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
              <Button variant="none" size="none" className="canvas-icon-btn !h-6 !w-6" onClick={onNew} aria-label="Nuevo">
                <Plus className="h-3 w-3" />
              </Button>
            </WithHoverTooltip>
            {onOpenTemplates && (
              <WithHoverTooltip label="Plantillas" placement="bottom" variant="dark">
                <Button variant="none" size="none"
                  className="canvas-icon-btn !h-6 !w-6"
                  onClick={onOpenTemplates}
                  aria-label="Plantillas"
                  data-testid="canvas-open-templates"
                >
                  <LayoutTemplate className="h-3 w-3" />
                </Button>
              </WithHoverTooltip>
            )}
            <WithHoverTooltip label="Eliminar" placement="bottom" variant="dark">
              <Button variant="none" size="none"
                className="canvas-icon-btn !h-6 !w-6"
                onClick={onDeleteDoc}
                aria-label="Eliminar documento"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </WithHoverTooltip>
            {onHidePanel && (
              <WithHoverTooltip label="Ocultar panel izquierdo" placement="bottom" variant="dark">
                <Button variant="none" size="none"
                  className="canvas-icon-btn !h-6 !w-6"
                  data-testid="canvas-toggle-left-panel"
                  disabled={hidePanelDisabled}
                  onClick={onHidePanel}
                  aria-label="Ocultar panel izquierdo"
                >
                  <PanelLeftClose className="h-3 w-3" />
                </Button>
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
              <Button variant="none" size="none" className="canvas-icon-btn !h-6 !w-6" onClick={onAddPage} aria-label="Añadir página">
                <Plus className="h-3 w-3" />
              </Button>
            </WithHoverTooltip>
            <WithHoverTooltip label="Quitar página" placement="bottom" variant="dark">
              <Button variant="none" size="none"
                className="canvas-icon-btn !h-6 !w-6"
                onClick={() => onRemovePage(pageIndex)}
                aria-label="Quitar página"
                disabled={pageCount <= 1}
              >
                <Minus className="h-3 w-3" />
              </Button>
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
              <Button variant="none" size="none"
                key={pages?.[i]?.id ?? i}
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
                data-page-drop={pageDropIndex === i ? 'true' : undefined}
                draggable={Boolean(onReorderPage) && pageCount > 1 && renamingIndex !== i}
                onDragStart={(e) => {
                  if (!onReorderPage || pageCount <= 1) {
                    e.preventDefault();
                    return;
                  }
                  pageDragIndexRef.current = i;
                  e.dataTransfer.setData('text/plain', String(i));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  if (!onReorderPage || pageDragIndexRef.current === null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                  setPageDropIndex(i);
                }}
                onDragLeave={() => setPageDropIndex((cur) => (cur === i ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const from = pageDragIndexRef.current;
                  pageDragIndexRef.current = null;
                  setPageDropIndex(null);
                  if (from === null || from === i) return;
                  onReorderPage?.(from, i);
                }}
                onDragEnd={() => {
                  pageDragIndexRef.current = null;
                  setPageDropIndex(null);
                }}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{pageLabel(i)}</span>
                <span className="canvas-page-format">A4</span>
              </Button>
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
            <Button variant="none" size="none"
              className="canvas-icon-btn !h-6 !w-6"
              aria-label="Agrupar"
              disabled={!canGroupSelected}
              onClick={onGroupSelected}
            >
              <Group className="h-3.5 w-3.5" />
            </Button>
          </WithHoverTooltip>
          <WithHoverTooltip label="Desagrupar (Ctrl+Shift+G)" placement="bottom" variant="dark">
            <Button variant="none" size="none"
              className="canvas-icon-btn !h-6 !w-6"
              aria-label="Desagrupar"
              disabled={!canUngroupSelected}
              onClick={onUngroupSelected}
            >
              <Ungroup className="h-3.5 w-3.5" />
            </Button>
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
