import { useEffect, useRef } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Eye,
  EyeOff,
  Group,
  Layers,
  Lock,
  Pencil,
  Trash2,
  Unlock,
} from 'lucide-react';

export type CanvasContextAction =
  | 'edit'
  | 'duplicate'
  | 'toggleLock'
  | 'toggleVisible'
  | 'bringFront'
  | 'sendBack'
  | 'selectChildren'
  | 'group'
  | 'delete';

export interface CanvasContextMenuState {
  x: number;
  y: number;
  layerId: string | null;
  locked: boolean;
  visible: boolean;
  isContainer: boolean;
  canGroup: boolean;
  /** When set, show "Editar texto/campo" at the top. */
  editKind?: 'text' | 'field' | null;
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
    { id: 'duplicate', label: 'Duplicar', tip: 'Ctrl+D', icon: Copy, disabled: !hasLayer || menu.locked },
    {
      id: 'toggleLock',
      label: menu.locked ? 'Desbloquear' : 'Bloquear',
      icon: menu.locked ? Unlock : Lock,
      disabled: !hasLayer,
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
    },
    { id: 'bringFront', label: 'Traer al frente', tip: ']', icon: ArrowUpToLine, disabled: !hasLayer || menu.locked },
    { id: 'sendBack', label: 'Enviar al fondo', tip: '[', icon: ArrowDownToLine, disabled: !hasLayer || menu.locked },
    { id: 'delete', label: 'Eliminar', tip: 'Supr', icon: Trash2, danger: true, disabled: !hasLayer || menu.locked },
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
        <button
          key={item.id}
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
      ))}
    </div>
  );
}
