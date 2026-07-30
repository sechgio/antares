import { Fragment, useEffect, useRef } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronUp,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Group,
  Layers,
  LayoutGrid,
  Lock,
  Pencil,
  Trash2,
  Ungroup,
  Unlock,
} from 'lucide-react';

export type CanvasContextAction =
  | 'edit'
  | 'copy'
  | 'paste'
  | 'pasteInPlace'
  | 'duplicate'
  | 'toggleLock'
  | 'toggleVisible'
  | 'bringFront'
  | 'bringForward'
  | 'sendBack'
  | 'sendBackward'
  | 'selectChildren'
  | 'group'
  | 'ungroup'
  | 'matchGridSlotSize'
  | 'delete';

export interface CanvasContextMenuState {
  x: number;
  y: number;
  layerId: string | null;
  locked: boolean;
  visible: boolean;
  isContainer: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  canPaste: boolean;
  /** When set, show "Editar texto/campo" at the top. */
  editKind?: 'text' | 'field' | null;
  /** Show "Mismo tamaño para todos" for an imageSlot inside a grid. */
  canMatchGridSlotSize?: boolean;
}

interface ContextMenuProps {
  menu: CanvasContextMenuState;
  onAction: (action: CanvasContextAction) => void;
  onClose: () => void;
}

interface MenuItem {
  id: CanvasContextAction;
  label: string;
  tip?: string;
  icon: typeof Copy;
  danger?: boolean;
  disabled?: boolean;
  /** Render a group separator above this item. */
  sepBefore?: boolean;
}

export default function ContextMenu({ menu, onAction, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
    };
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 8;
    const rect = el.getBoundingClientRect();
    let left = menu.x;
    let top = menu.y;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    el.style.left = `${Math.max(pad, left)}px`;
    el.style.top = `${Math.max(pad, top)}px`;
  }, [menu.x, menu.y]);

  const hasLayer = Boolean(menu.layerId);
  const items: MenuItem[] = [];
  if (menu.editKind === 'text') {
    items.push({ id: 'edit', label: 'Editar texto', tip: 'Enter', icon: Pencil, disabled: menu.locked });
  } else if (menu.editKind === 'field') {
    items.push({ id: 'edit', label: 'Editar campo', tip: 'Doble clic', icon: Pencil, disabled: menu.locked });
  }
  items.push(
    {
      id: 'copy',
      label: 'Copiar',
      tip: 'Ctrl+C',
      icon: Copy,
      disabled: !hasLayer,
      sepBefore: Boolean(menu.editKind),
    },
    { id: 'paste', label: 'Pegar', tip: 'Ctrl+V', icon: ClipboardPaste, disabled: !menu.canPaste },
    {
      id: 'pasteInPlace',
      label: 'Pegar en el sitio',
      tip: 'Ctrl+Shift+V',
      icon: ClipboardPaste,
      disabled: !menu.canPaste,
    },
    { id: 'duplicate', label: 'Duplicar', tip: 'Ctrl+D', icon: Copy, disabled: !hasLayer || menu.locked },
    {
      id: 'toggleLock',
      label: menu.locked ? 'Desbloquear' : 'Bloquear',
      icon: menu.locked ? Unlock : Lock,
      disabled: !hasLayer,
      sepBefore: true,
    },
    {
      id: 'toggleVisible',
      label: menu.visible ? 'Ocultar' : 'Mostrar',
      icon: menu.visible ? EyeOff : Eye,
      disabled: !hasLayer,
    },
    {
      id: 'selectChildren',
      label: 'Seleccionar hijos',
      tip: 'Enter',
      icon: Layers,
      disabled: !hasLayer || !menu.isContainer,
    },
    {
      id: 'group',
      label: 'Agrupar',
      tip: 'Ctrl+G',
      icon: Group,
      disabled: !menu.canGroup || menu.locked,
      sepBefore: true,
    },
    {
      id: 'ungroup',
      label: 'Desagrupar',
      tip: 'Ctrl+Shift+G',
      icon: Ungroup,
      disabled: !menu.canUngroup || menu.locked,
    },
    ...(menu.canMatchGridSlotSize
      ? [
          {
            id: 'matchGridSlotSize' as const,
            label: 'Mismo tamaño para todos',
            icon: LayoutGrid,
            disabled: menu.locked,
            sepBefore: true,
          },
        ]
      : []),
    {
      id: 'bringFront',
      label: 'Traer al frente',
      tip: ']',
      icon: ArrowUpToLine,
      disabled: !hasLayer || menu.locked,
      sepBefore: true,
    },
    {
      id: 'bringForward',
      label: 'Adelante',
      tip: 'Ctrl+]',
      icon: ChevronUp,
      disabled: !hasLayer || menu.locked,
    },
    {
      id: 'sendBackward',
      label: 'Atrás',
      tip: 'Ctrl+[',
      icon: ChevronDown,
      disabled: !hasLayer || menu.locked,
    },
    { id: 'sendBack', label: 'Enviar al fondo', tip: '[', icon: ArrowDownToLine, disabled: !hasLayer || menu.locked },
    {
      id: 'delete',
      label: 'Eliminar',
      tip: 'Supr',
      icon: Trash2,
      danger: true,
      disabled: !hasLayer || menu.locked,
      sepBefore: true,
    },
  );

  return (
    <div
      ref={ref}
      className="canvas-context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      data-testid="canvas-context-menu"
    >
      {!hasLayer && (
        <div className="canvas-context-hint">Clic derecho sobre una capa para editarla</div>
      )}
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.sepBefore ? <div className="canvas-context-sep" role="separator" /> : null}
          <button
            type="button"
            role="menuitem"
            className="canvas-context-item"
            data-danger={item.danger || undefined}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onAction(item.id);
              onClose();
            }}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 text-left">{item.label}</span>
            {item.tip && <kbd className="canvas-kbd">{item.tip}</kbd>}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
