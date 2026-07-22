import {
  Lasso,
  MousePointer2,
  MoreHorizontal,
  Scissors,
  Spline,
} from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import type { CanvasTool } from '../types';

export type PathEditTool = Extract<CanvasTool, 'select' | 'lasso' | 'bend' | 'cut'>;

interface PathEditToolbarProps {
  tool: CanvasTool;
  onTool: (tool: PathEditTool) => void;
  canClosePath?: boolean;
  pathClosed?: boolean;
  onToggleClosed?: () => void;
}

const ITEMS: { id: PathEditTool; icon: typeof MousePointer2; title: string }[] = [
  { id: 'select', icon: MousePointer2, title: 'Mover' },
  { id: 'lasso', icon: Lasso, title: 'Lazo' },
  { id: 'bend', icon: Spline, title: 'Curvar' },
  { id: 'cut', icon: Scissors, title: 'Cortar' },
];

export default function PathEditToolbar({
  tool,
  onTool,
  canClosePath = false,
  pathClosed = false,
  onToggleClosed,
}: PathEditToolbarProps) {
  const active: PathEditTool =
    tool === 'lasso' || tool === 'bend' || tool === 'cut' ? tool : 'select';

  return (
    <div className="canvas-path-edit-toolbar" data-testid="canvas-path-edit-toolbar" role="toolbar" aria-label="Edición de trazo">
      {ITEMS.map(({ id, icon: Icon, title }) => {
        const isActive = active === id;
        return (
          <WithHoverTooltip key={id} label={title}>
            <button
              type="button"
              className={`canvas-path-edit-btn${isActive ? ' is-active' : ''}`}
              aria-label={title}
              aria-pressed={isActive}
              onClick={() => onTool(id)}
            >
              <Icon className="h-4 w-4" />
            </button>
          </WithHoverTooltip>
        );
      })}
      {canClosePath && onToggleClosed && (
        <>
          <span className="canvas-path-edit-sep" aria-hidden />
          <WithHoverTooltip label={pathClosed ? 'Abrir trazo' : 'Cerrar trazo'}>
            <button
              type="button"
              className={`canvas-path-edit-btn${pathClosed ? ' is-active' : ''}`}
              aria-label={pathClosed ? 'Abrir trazo' : 'Cerrar trazo'}
              aria-pressed={pathClosed}
              onClick={onToggleClosed}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </WithHoverTooltip>
        </>
      )}
    </div>
  );
}
