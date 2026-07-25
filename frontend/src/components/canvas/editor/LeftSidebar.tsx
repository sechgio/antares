import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
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
} from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { ancestorIds, buildLayerTree, flattenLayerTree, isLayerContainer } from '../ops/layerTree';
import type { CanvasDocumentSummary, CanvasLayer } from '../types';
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
  onReorderSibling: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onToggleLocked: (id: string, locked: boolean) => void;
  onRenameLayer: (id: string, name: string) => void;
}

function layerIcon(type: CanvasLayer['type']) {
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
  onReorderSibling,
  onToggleVisible,
  onToggleLocked,
  onRenameLayer,
}: LeftSidebarProps) {
  const tree = useMemo(() => buildLayerTree(layers), [layers]);
  const containerIds = useMemo(
    () => layers.filter((l) => isLayerContainer(l)).map((l) => l.id),
    [layers],
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(containerIds));
  const [layerQuery, setLayerQuery] = useState('');
  const [pageMenu, setPageMenu] = useState<PageContextMenuState | null>(null);
  const [renamingIndex, setRenamingIndex] = useState<number | null>(null);
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const layerRenameRef = useRef<HTMLInputElement>(null);
  const layerListRef = useRef<HTMLUListElement>(null);

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

  // Expand ancestors + scroll selected Capas row into view.
  useEffect(() => {
    const id = selectedIds[0];
    if (!id) return;
    const ancestors = ancestorIds(layers, id);
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
  }, [selectedIds, layers]);

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

  const commitLayerRename = () => {
    if (renamingLayerId === null) return;
    const name = renameDraft.trim();
    if (name) onRenameLayer(renamingLayerId, name);
    setRenamingLayerId(null);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
      for (const aid of ancestorIds(layers, id)) keep.add(aid);
    }
    return flat.filter((r) => keep.has(r.layer.id));
  }, [tree, expandedIds, layerQuery, containerIds, layers]);
  const pageLabel = (i: number) => pages?.[i]?.name ?? `Página ${i + 1}`;

  return (
    <aside
      className="canvas-panel flex h-full w-[248px] shrink-0 flex-col overflow-hidden border-r"
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
          </div>
        </div>
        <CanvasSelect
          value={documentId}
          onChange={(val) => onOpenDoc(val)}
          aria-label="Archivo abierto"
          options={fileOptions.map((d) => ({ value: d.id, label: d.name }))}
        />
      </div>

      <div className="border-b px-3 py-2" style={{ borderColor: 'var(--cv-border)' }}>
        <div className="canvas-section-title flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <FileText className="h-3 w-3" />
            Páginas
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
                className="canvas-input w-full !py-1.5 text-[12px]"
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
          Capas
        </div>
        <div className="px-2 pb-1.5 pt-1">
          <input
            type="search"
            className="canvas-input !py-1.5 text-[11px]"
            placeholder="Buscar capas…"
            value={layerQuery}
            aria-label="Buscar capas"
            onChange={(e) => setLayerQuery(e.target.value)}
          />
        </div>
        <ul ref={layerListRef} className="flex-1 overflow-y-auto px-1 pb-3">
          {rows.map((row) => {
            const { layer, depth, hasChildren } = row;
            const expanded = expandedIds.has(layer.id);
            const parentKey =
              layer.parentId && layers.some((l) => l.id === layer.parentId) ? layer.parentId : undefined;
            const siblingCapas = layers
              .filter((l) => {
                if (l.type === 'frame') return false;
                const p = l.parentId && layers.some((x) => x.id === l.parentId) ? l.parentId : undefined;
                return p === parentKey;
              })
              .reverse();
            const sibIndex = siblingCapas.findIndex((l) => l.id === layer.id);
            return (
              <li key={layer.id}>
                <div
                  className="canvas-list-row"
                  data-layer-id={layer.id}
                  data-selected={selectedIds.includes(layer.id)}
                  data-dimmed={layer.visible === false}
                  draggable={!layer.locked && renamingLayerId !== layer.id}
                  onDragStart={(e) => {
                    if (layer.locked) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData('text/plain', layer.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const draggedId = e.dataTransfer.getData('text/plain');
                    if (!draggedId || draggedId === layer.id) return;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                    onReorderSibling(draggedId, layer.id, position);
                  }}
                  style={{ color: 'var(--cv-text)', paddingLeft: `${4 + depth * 12}px` }}
                >
                  {hasChildren ? (
                    <button
                      type="button"
                      className="canvas-icon-btn !h-5 !w-5 shrink-0"
                      style={{ color: 'var(--cv-text-muted)' }}
                      aria-label={expanded ? 'Colapsar' : 'Expandir'}
                      onClick={() => toggleExpanded(layer.id)}
                    >
                      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </button>
                  ) : (
                    <span className="inline-block h-5 w-5 shrink-0" aria-hidden />
                  )}
                  {renamingLayerId === layer.id ? (
                    <input
                      ref={layerRenameRef}
                      className="canvas-input min-w-0 flex-1 !px-1 !py-0 text-[11px]"
                      value={renameDraft}
                      aria-label="Nombre de capa"
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={commitLayerRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitLayerRename();
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setRenamingLayerId(null);
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left"
                      onClick={(e) => onSelect(layer.id, e.shiftKey || e.ctrlKey || e.metaKey)}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        if (layer.locked) return;
                        setRenameDraft(layer.name);
                        setRenamingLayerId(layer.id);
                      }}
                    >
                      <span style={{ color: 'var(--cv-text-muted)' }}>{layerIcon(layer.type)}</span>
                      <span className="min-w-0 flex-1 truncate">{layer.name}</span>
                      {layer.meta?.key && (
                        <span
                          className="max-w-[72px] shrink-0 truncate rounded px-1 text-[9px] uppercase tracking-wide"
                          style={{
                            background: 'var(--cv-hover)',
                            color: 'var(--cv-text-muted)',
                          }}
                          title={layer.meta.key}
                        >
                          {layer.meta.key}
                        </span>
                      )}
                    </button>
                  )}
                  <WithHoverTooltip label="Visibilidad" placement="left" variant="dark">
                    <button
                      type="button"
                      className="canvas-icon-btn !h-6 !w-6"
                      aria-label="Visibilidad"
                      onClick={() => onToggleVisible(layer.id, layer.visible === false)}
                    >
                      {layer.visible === false ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </button>
                  </WithHoverTooltip>
                  <WithHoverTooltip label={layer.locked ? 'Desbloquear' : 'Bloquear'} placement="left" variant="dark">
                    <button
                      type="button"
                      className="canvas-icon-btn !h-6 !w-6"
                      aria-label={layer.locked ? 'Desbloquear' : 'Bloquear'}
                      onClick={() => onToggleLocked(layer.id, !layer.locked)}
                    >
                      {layer.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                    </button>
                  </WithHoverTooltip>
                  <WithHoverTooltip label="Subir" placement="left" variant="dark">
                    <button
                      type="button"
                      className="canvas-icon-btn !h-6 !w-6"
                      aria-label="Subir"
                      disabled={sibIndex <= 0 || layer.locked}
                      onClick={() => {
                        const prev = siblingCapas[sibIndex - 1];
                        if (prev) onReorderSibling(layer.id, prev.id, 'before');
                      }}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                  </WithHoverTooltip>
                  <WithHoverTooltip label="Bajar" placement="left" variant="dark">
                    <button
                      type="button"
                      className="canvas-icon-btn !h-6 !w-6"
                      aria-label="Bajar"
                      disabled={sibIndex < 0 || sibIndex >= siblingCapas.length - 1 || layer.locked}
                      onClick={() => {
                        const nextLayer = siblingCapas[sibIndex + 1];
                        if (nextLayer) onReorderSibling(layer.id, nextLayer.id, 'after');
                      }}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </WithHoverTooltip>
                </div>
              </li>
            );
          })}
          {rows.length === 0 && (
            <li className="canvas-empty-hint">
              Sin capas. Usa la barra inferior o un preset.
            </li>
          )}
        </ul>
      </div>
    </aside>
  );
});
