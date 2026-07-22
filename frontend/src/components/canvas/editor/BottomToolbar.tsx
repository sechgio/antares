import { memo, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
  Check,
  CheckSquare,
  ChevronDown,
  Circle,
  Grid3X3,
  Hand,
  Image as ImageIcon,
  ImagePlus,
  Images,
  LayoutTemplate,
  MousePointer2,
  PenLine,
  Slash,
  Square,
  Star,
  Table2,
  Triangle,
  Type,
} from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { isShapeTool, type ShapeTool } from '../ops/shapePaths';
import type { CanvasTool } from '../types';

interface BottomToolbarProps {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
}

const NAV: { id: CanvasTool; icon: typeof Type; title: string; tip: string }[] = [
  { id: 'select', icon: MousePointer2, title: 'Seleccionar', tip: 'V' },
  { id: 'hand', icon: Hand, title: 'Mano', tip: 'H' },
];

const SHAPE_MENU_ITEMS: {
  id: ShapeTool | 'image';
  icon: typeof Type;
  title: string;
  tip: string;
}[] = [
  { id: 'rect', icon: Square, title: 'Rectángulo', tip: 'R' },
  { id: 'line', icon: Slash, title: 'Línea', tip: 'L' },
  { id: 'arrow', icon: ArrowUpRight, title: 'Flecha', tip: 'Shift+L' },
  { id: 'ellipse', icon: Circle, title: 'Elipse', tip: 'O' },
  { id: 'polygon', icon: Triangle, title: 'Polígono', tip: '' },
  { id: 'star', icon: Star, title: 'Estrella', tip: '' },
  { id: 'image', icon: ImageIcon, title: 'Imagen/vídeo...', tip: 'Ctrl+Shift+K' },
];

const CONTENT: { id: CanvasTool; icon: typeof Type; title: string; tip: string }[] = [
  { id: 'text', icon: Type, title: 'Texto', tip: 'T' },
  { id: 'field', icon: LayoutTemplate, title: 'Campo Excel', tip: 'F' },
  { id: 'logo', icon: ImagePlus, title: 'Logo', tip: '' },
  { id: 'imageSlot', icon: Images, title: 'Slot foto', tip: 'I' },
];

const LAYOUT: { id: CanvasTool; icon: typeof Type; title: string; tip: string }[] = [
  { id: 'grid', icon: Grid3X3, title: 'Cuadrícula', tip: 'G' },
  { id: 'table', icon: Table2, title: 'Tabla', tip: 'B' },
  { id: 'checkbox', icon: CheckSquare, title: 'Casilla', tip: '' },
  { id: 'signature', icon: PenLine, title: 'Firma', tip: '' },
];

const MENU_WIDTH = 248;
const MENU_GAP = 8;

type MenuCoords = { left: number; top: number };

function shapeIcon(id: ShapeTool | 'image'): typeof Type {
  return SHAPE_MENU_ITEMS.find((item) => item.id === id)?.icon ?? Square;
}

function isMenuItemChecked(id: ShapeTool | 'image', tool: CanvasTool, lastShapeTool: ShapeTool): boolean {
  if (id === 'image') return tool === 'image';
  return lastShapeTool === id;
}

function menuPosition(trigger: DOMRect): MenuCoords {
  const left = Math.min(Math.max(MENU_WIDTH / 2 + 8, trigger.left + trigger.width / 2), window.innerWidth - MENU_WIDTH / 2 - 8);
  const top = Math.max(8, trigger.top - MENU_GAP);
  return { left, top };
}

function ShapeToolMenu({ tool, onTool }: BottomToolbarProps) {
  const [lastShapeTool, setLastShapeTool] = useState<ShapeTool>('rect');
  const [menu, setMenu] = useState<MenuCoords | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = menu != null;

  useEffect(() => {
    if (isShapeTool(tool)) setLastShapeTool(tool);
  }, [tool]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };

    let onPointer: ((e: MouseEvent) => void) | null = null;
    // Defer so the opening click does not immediately close the menu.
    const timer = window.setTimeout(() => {
      onPointer = (e: MouseEvent) => {
        const target = e.target as Node;
        if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
        setMenu(null);
      };
      window.addEventListener('mousedown', onPointer);
    }, 0);

    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      if (onPointer) window.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const Icon = shapeIcon(lastShapeTool);
  const shapeActive = isShapeTool(tool);
  const lastLabel = SHAPE_MENU_ITEMS.find((item) => item.id === lastShapeTool)?.title ?? 'Forma';
  const lastTip = SHAPE_MENU_ITEMS.find((i) => i.id === lastShapeTool)?.tip || undefined;

  const closeMenu = () => setMenu(null);

  const toggleMenu = () => {
    if (open) {
      closeMenu();
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    setMenu(menuPosition(el.getBoundingClientRect()));
  };

  const selectTool = (id: ShapeTool | 'image') => {
    if (isShapeTool(id)) setLastShapeTool(id);
    onTool(id);
    closeMenu();
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <div className="canvas-shape-split" data-active={shapeActive || open} data-open={open}>
        <WithHoverTooltip label={lastLabel} shortcut={lastTip} placement="top" variant="dark">
          <button
            type="button"
            aria-label={lastLabel}
            aria-pressed={shapeActive}
            className="canvas-toolbar-tool canvas-shape-split-main"
            data-active={shapeActive}
            onClick={(e) => {
              e.stopPropagation();
              closeMenu();
              onTool(lastShapeTool);
            }}
          >
            <Icon className="h-[15px] w-[15px]" strokeWidth={shapeActive ? 2 : 1.75} />
          </button>
        </WithHoverTooltip>
        <button
          type="button"
          aria-label="Más formas"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          title="Más formas"
          className="canvas-toolbar-tool canvas-shape-split-chevron"
          data-active={open}
          onClick={(e) => {
            e.stopPropagation();
            toggleMenu();
          }}
        >
          <ChevronDown className="h-3 w-3" strokeWidth={2.25} />
        </button>
      </div>

      {menu
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className="canvas-shape-menu"
              role="menu"
              aria-label="Formas"
              style={{
                position: 'fixed',
                left: menu.left,
                top: menu.top,
                width: MENU_WIDTH,
                transform: 'translate(-50%, -100%)',
                pointerEvents: 'auto',
              }}
            >
              {SHAPE_MENU_ITEMS.map(({ id, icon: ItemIcon, title, tip }) => {
                const checked = isMenuItemChecked(id, tool, lastShapeTool);
                return (
                  <button
                    key={id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    className="canvas-shape-menu-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      selectTool(id);
                    }}
                  >
                    <span className="canvas-shape-menu-check" aria-hidden>
                      {checked ? <Check className="h-3.5 w-3.5" strokeWidth={2.75} /> : null}
                    </span>
                    <span className="canvas-shape-menu-icon" aria-hidden>
                      <ItemIcon className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <span className="canvas-shape-menu-label">{title}</span>
                    {tip ? <span className="canvas-shape-menu-tip">{tip}</span> : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function ToolGroup({
  tools,
  tool,
  onTool,
}: {
  tools: typeof NAV;
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
}) {
  return (
    <>
      {tools.map(({ id, icon: Icon, title, tip }) => {
        const active = tool === id;
        return (
          <WithHoverTooltip key={id} label={title} shortcut={tip || undefined} placement="top" variant="dark">
            <button
              type="button"
              aria-label={title}
              aria-pressed={active}
              className="canvas-toolbar-tool"
              data-active={active}
              onClick={(e) => {
                e.stopPropagation();
                onTool(id);
              }}
            >
              <Icon className="h-[15px] w-[15px]" strokeWidth={active ? 2 : 1.75} />
            </button>
          </WithHoverTooltip>
        );
      })}
    </>
  );
}

export default memo(function BottomToolbar({ tool, onTool }: BottomToolbarProps) {
  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-50 -translate-x-1/2">
      <div className="canvas-toolbar-float pointer-events-auto" role="toolbar" aria-label="Herramientas Canvas">
        <ToolGroup tools={NAV} tool={tool} onTool={onTool} />
        <div className="canvas-toolbar-sep" aria-hidden />
        <ShapeToolMenu tool={tool} onTool={onTool} />
        <div className="canvas-toolbar-sep" aria-hidden />
        <ToolGroup tools={CONTENT} tool={tool} onTool={onTool} />
        <div className="canvas-toolbar-sep" aria-hidden />
        <ToolGroup tools={LAYOUT} tool={tool} onTool={onTool} />
      </div>
    </div>
  );
});

