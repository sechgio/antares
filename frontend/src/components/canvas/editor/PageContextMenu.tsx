import { useEffect, useRef } from 'react';
import { Copy, Pencil, Trash2 } from 'lucide-react';

export type PageContextAction = 'rename' | 'duplicate' | 'delete';

export interface PageContextMenuState {
  x: number;
  y: number;
  pageIndex: number;
}

interface PageContextMenuProps {
  menu: PageContextMenuState;
  canDelete: boolean;
  onAction: (action: PageContextAction) => void;
  onClose: () => void;
}

interface MenuItem {
  id: PageContextAction;
  label: string;
  icon: typeof Copy;
  danger?: boolean;
  disabled?: boolean;
  sepBefore?: boolean;
}

export default function PageContextMenu({
  menu,
  canDelete,
  onAction,
  onClose,
}: PageContextMenuProps) {
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

  const items: MenuItem[] = [
    { id: 'rename', label: 'Cambiar el nombre de página', icon: Pencil },
    { id: 'duplicate', label: 'Duplicar página', icon: Copy },
    { id: 'delete', label: 'Eliminar la página', icon: Trash2, danger: true, disabled: !canDelete, sepBefore: true },
  ];

  return (
    <div
      ref={ref}
      className="canvas-context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      data-testid="canvas-page-context-menu"
    >
      {items.map((item) => (
        <div key={item.id}>
          {item.sepBefore && <div className="canvas-context-sep" role="separator" />}
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
          </button>
        </div>
      ))}
    </div>
  );
}
