import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
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
} from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { ancestorIds, buildLayerTree, flattenLayerTree, isLayerContainer } from '../ops/layerTree';
import type { CanvasDocumentSummary, CanvasLayer } from '../types';
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
  /** When false, panel collapses via CSS but stays mounted. */
  open?: boolean;
  /** Hide this sidebar (Archivos header). */
  onHidePanel?: () => void;
  hidePanelDisabled?: boolean;
  /** Cloud sync in flight — pulse Archivos select (keep mounted; no skeleton swap). */
  docsSyncing?: boolean;
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

import { getThumbnailUrl } from '../utils/imageBlobStore';

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

/** Capas row: chevron + type icon + name; lock/eye on hover (Figma-like). */
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
  open = true,
  onHidePanel,
  hidePanelDisabled = false,
  docsSyncing = false,
}: LeftSidebarProps) {
  const tree = useMemo(() => buildLayerTree(layers), [layers]);
  const containerIds = useMemo(
    () => layers.filter((l) => isLayerContainer(l)).map((l) => l.id),
    [layers],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const canGroupSelected = useMemo(() => {
    let n = 0;
    for (const id of selectedIds) {
      const layer = layers.find((l) => l.id === id);
      if (layer && !layer.locked && layer.type !== 'frame') n += 1;
      if (n >= 2) return true;
    }
    return false;
  }, [layers, selectedIds]);
  const canUngroupSelected = useMemo(() => {
    if (selectedIds.length !== 1) return false;
    const layer = layers.find((l) => l.id === selectedIds[0]);
    return Boolean(layer && (layer.type === 'group' || layer.type === 'component') && !layer.locked);
  }, [layers, selectedIds]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(containerIds));
  const [layerQuery, setLayerQuery] = useState('');
  const [pageMenu, setPageMenu] = useState<PageContextMenuState | null>(null);
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [dropHover, setDropHover] = useState<{
    id: string;
    position: CapasDropPosition;
  } | null>(null);
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

  // Keep newly created containers expanded by default.
  useEffect(() => {
    setExpandedIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of containerIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [containerIds]);

  // Expand ancestors + scroll selected Capas row into view (selection-driven, not every layers edit).
  useEffect(() => {
    const id = selectedIds[0];
    if (!id) return;
    const ancestors = ancestorIds(layersRef.current, id);
    if (ancestors.length) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        let changed = false;
        for (const aid of ancestors) {
          if (!next.has(aid)) {
            next.add(aid);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
    requestAnimationFrame(() => {
      const el = layerListRef.current?.querySelector(`[data-layer-id="${id}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }, [selectedIds]);

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

  const startLayerRename = useCallback((id: string, name: string) => {
    setRenameDraft(name);
    setRenamingLayerId(id);
  }, []);

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
    const byId = new Map(layers.map((l) => [l.id, l]));
    for (const id of matchIds) {
      for (const aid of ancestorIds(byId, id)) keep.add(aid);
    }
    return flat.filter((r) => keep.has(r.layer.id));
  }, [tree, expandedIds, layerQuery, containerIds, layers]);
  const pageLabel = (i: number) => pages?.[i]?.name ?? `Página ${i + 1}`;

  /** Windowed Capas list — skip mounting off-screen rows when the tree is large. */
  const LAYER_ROW_H = 28;
  const LAYER_OVERSCAN = 8;
  const LAYER_VIRTUALIZE_AT = 80;
  const [layerScrollTop, setLayerScrollTop] = useState(0);
  const [layerListHeight, setLayerListHeight] = useState(400);
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
      return { start: 0, end: rows.length, padTop: 0, padBottom: 0 };
    }
    const visible = Math.ceil(layerListHeight / LAYER_ROW_H) + LAYER_OVERSCAN * 2;
    const start = Math.max(0, Math.floor(layerScrollTop / LAYER_ROW_H) - LAYER_OVERSCAN);
    const end = Math.min(rows.length, start + visible);
    return {
      start,
      end,
      padTop: start * LAYER_ROW_H,
      padBottom: Math.max(0, (rows.length - end) * LAYER_ROW_H),
    };
  }, [virtualizeLayers, rows.length, layerListHeight, layerScrollTop]);
  const visibleRows = virtualizeLayers ? rows.slice(layerWindow.start, layerWindow.end) : rows;

  return (
    <aside
      className={
        open
          ? 'canvas-panel canvas-panel-chrome canvas-panel-chrome--left flex h-full w-[248px] shrink-0 flex-col overflow-hidden border-r'
          : 'canvas-panel canvas-panel-chrome canvas-panel-chrome--left flex h-full w-0 min-w-0 shrink-0 flex-col overflow-hidden border-r-0'
      }
      data-open={open ? 'true' : 'false'}
      data-testid="canvas-left-panel"
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div className="border-b px-2 py-2" style={{ borderColor: 'var(--cv-border)' }}>
        <div className="canvas-section-title mb-1.5 flex items-center justify-between px-1">
          <span>Archivos</span>
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
            className={docsSyncing ? 'animate-pulse' : undefined}
            options={fileOptions.map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>
      </div>

      <div className="border-b px-3 py-2" style={{ borderColor: 'var(--cv-border)' }}>
        <div className="canvas-section-title flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <FileText className="h-3 w-3" />
            Páginas
          </span>
          <span className="canvas-section-count ml-auto mr-1" data-testid="canvas-pages-count" aria-label={`${pageCount} páginas`}>
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
        <div className="mt-1 space-y-0.5">
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
                className="w-full rounded-md px-2 py-1.5 text-left text-[12px]"
                style={{
                  background: pageIndex === i ? 'var(--cv-active)' : 'transparent',
                  color: 'var(--cv-text)',
                }}
              >
                {pageLabel(i)} · A4
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

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="canvas-section-title flex items-center gap-1.5 px-3 pt-3">
          <Layers className="h-3 w-3" />
          <span className="min-w-0 flex-1">Capas</span>
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
        <div className="px-2 pb-1.5 pt-1">
          <input
            type="search"
            className="canvas-input !py-1.5 text-[11px]"
            placeholder="Buscar por nombre o tipo…"
            value={layerQuery}
            aria-label="Buscar capas"
            onChange={(e) => setLayerQuery(e.target.value)}
          />
        </div>
        <ul
          ref={layerListRef}
          className="flex-1 overflow-y-auto px-1 pb-3"
          onScroll={
            virtualizeLayers
              ? (e) => setLayerScrollTop((e.currentTarget as HTMLUListElement).scrollTop)
              : undefined
          }
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
    </aside>
  );
});
