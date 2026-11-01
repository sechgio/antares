import { Copy, Pencil, Trash2 } from 'lucide-react';
import { useContextMenuSurface } from '../hooks/useContextMenuSurface';
import ContextMenuList, { type ContextMenuItem } from './ContextMenuList';

type PageContextAction = 'rename' | 'duplicate' | 'delete';

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

type MenuItem = ContextMenuItem<PageContextAction, string | number>;

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
      <ContextMenuList items={items} onAction={onAction} onClose={onClose} />
    </div>
  );
}
