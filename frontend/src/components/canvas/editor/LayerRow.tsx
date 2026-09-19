import { memo, useEffect, useRef, type RefObject } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Group,
  Image as ImageIcon,
  Square,
  Slash,
  Type,
  Layers,
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
  Component,
  Frame,
} from 'lucide-react';
import { isLayerContainer } from '../ops/layerTree';
import type { CanvasLayer } from '../types';
import { isImageLayerType, isTextualLayerType } from '../layerKinds';
import { getThumbnailUrl } from '../utils/imageBlobStore';
import { VisibilityIcon } from './VisibilityIcon';
import Button from '@/components/ui/Button';
export type CapasDropPosition = 'before' | 'after' | 'inside';

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
  if (isTextualLayerType(type)) return <Type className="h-3 w-3" />;
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
  if (isImageLayerType(type)) return <ImageIcon className="h-3 w-3" />;
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

export const LayerRow = memo(function LayerRow({
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
  // La lista de capas está ventaneada: si la fila se desmonta a mitad de drag no
  // llega un dragend y el fantasma que se colgó en document.body quedaría ahí.
  useEffect(() => () => dragGhostRef.current?.remove(), []);
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
          <Button variant="none" size="none"
            className="canvas-list-chevron"
            aria-label={expanded ? 'Colapsar' : 'Expandir'}
            aria-expanded={expanded}
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onToggleExpanded(layer.id)}
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
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
          <Button variant="none" size="none"
            className="canvas-list-action"
            aria-label={locked ? 'Desbloquear' : 'Bloquear'}
            aria-pressed={locked}
            title={locked ? 'Desbloquear capa' : 'Bloquear capa'}
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onToggleLocked(layer.id, !locked)}
          >
            {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          </Button>
          <Button variant="none" size="none"
            className="canvas-list-action"
            aria-label="Visibilidad"
            aria-pressed={!hidden}
            title={hidden ? 'Mostrar capa' : 'Ocultar capa'}
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onToggleVisible(layer.id, hidden)}
          >
            <VisibilityIcon visible={!hidden} className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </li>
  );
});
