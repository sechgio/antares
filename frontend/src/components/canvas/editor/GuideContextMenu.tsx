import { Trash2 } from 'lucide-react';
import { useContextMenuSurface } from '../hooks/useContextMenuSurface';
import Button from '@/components/ui/Button';

export interface GuideContextMenuState {
  id: string;
  x: number;
  y: number;
}

interface GuideContextMenuProps {
  menu: GuideContextMenuState;
  onRemove: (id: string) => void;
  onClose: () => void;
}

export default function GuideContextMenu({ menu, onRemove, onClose }: GuideContextMenuProps) {
  const ref = useContextMenuSurface(menu.x, menu.y, onClose);

  return (
    <div
      ref={ref}
      className="canvas-context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      data-testid="canvas-guide-context-menu"
    >
      <Button variant="none" size="none"
        role="menuitem"
        aria-label="Eliminar guía"
        className="canvas-context-item"
        data-danger
        onClick={() => {
          onRemove(menu.id);
          onClose();
        }}
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 text-left">Eliminar guía</span>
        <span className="canvas-kbd">Supr</span>
      </Button>
    </div>
  );
}
