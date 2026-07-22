import {
  Copy,
  Image as ImageIcon,
  Redo2,
  Save,
  Square,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { CanvasLayerType } from '../types';

interface ToolbarProps {
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onZoom: (z: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onDuplicate: () => void;
  onAddLayer: (type: Exclude<CanvasLayerType, 'frame'>) => void;
}

const BTN =
  'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40';

export default function Toolbar({
  zoom,
  canUndo,
  canRedo,
  onZoom,
  onUndo,
  onRedo,
  onSave,
  onDuplicate,
  onAddLayer,
}: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
      <button type="button" className={BTN} onClick={onSave} title="Guardar">
        <Save className="h-3.5 w-3.5" /> Guardar
      </button>
      <button type="button" className={BTN} onClick={onDuplicate} title="Duplicar documento">
        <Copy className="h-3.5 w-3.5" /> Duplicar
      </button>
      <div className="mx-1 h-5 w-px bg-[var(--border-subtle)]" />
      <button type="button" className={BTN} disabled={!canUndo} onClick={onUndo}>
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={BTN} disabled={!canRedo} onClick={onRedo}>
        <Redo2 className="h-3.5 w-3.5" />
      </button>
      <div className="mx-1 h-5 w-px bg-[var(--border-subtle)]" />
      <button type="button" className={BTN} onClick={() => onZoom(Math.max(0.4, zoom - 0.1))}>
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-[3rem] text-center text-xs text-[var(--text-muted)]">{Math.round(zoom * 100)}%</span>
      <button type="button" className={BTN} onClick={() => onZoom(Math.min(2, zoom + 0.1))}>
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
      <div className="mx-1 h-5 w-px bg-[var(--border-subtle)]" />
      <button type="button" className={BTN} onClick={() => onAddLayer('text')}>
        <Type className="h-3.5 w-3.5" /> Texto
      </button>
      <button type="button" className={BTN} onClick={() => onAddLayer('field')}>
        Campo
      </button>
      <button type="button" className={BTN} onClick={() => onAddLayer('logo')}>
        Logo
      </button>
      <button type="button" className={BTN} onClick={() => onAddLayer('imageSlot')}>
        <ImageIcon className="h-3.5 w-3.5" /> Foto
      </button>
      <button type="button" className={BTN} onClick={() => onAddLayer('rect')}>
        <Square className="h-3.5 w-3.5" /> Rect
      </button>
    </div>
  );
}
