import { Copy, Pencil, Trash2 } from 'lucide-react';
import { useContextMenuSurface } from '../hooks/useContextMenuSurface';

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
  const ref = useContextMenuSurface(menu.x, menu.y, onClose);

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
