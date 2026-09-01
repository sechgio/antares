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
  Plus,
  Slash,
  Square,
  Star,
  Diamond,
  Hexagon,
  Pentagon,
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

type ToolItem = { id: CanvasTool; icon: typeof Type; title: string; tip: string };

const NAV: ToolItem[] = [
  { id: 'select', icon: MousePointer2, title: 'Seleccionar', tip: 'V' },
  { id: 'hand', icon: Hand, title: 'Mano', tip: 'H' },
];

const SHAPE_MENU_ITEMS: {
  id: ShapeTool | 'image';
  icon: typeof Type;
  title: string;
  tip: string;
  sepBefore?: boolean;
}[] = [
  { id: 'rect', icon: Square, title: 'Rectángulo', tip: 'R' },
  { id: 'line', icon: Slash, title: 'Línea', tip: 'L' },
  { id: 'arrow', icon: ArrowUpRight, title: 'Flecha', tip: 'Shift+L' },
  { id: 'ellipse', icon: Circle, title: 'Elipse', tip: 'O' },
  { id: 'polygon', icon: Triangle, title: 'Polígono', tip: 'Shift+P' },
  { id: 'star', icon: Star, title: 'Estrella', tip: 'Shift+S' },
  { id: 'diamond', icon: Diamond, title: 'Rombo', tip: 'Shift+D' },
  { id: 'hexagon', icon: Hexagon, title: 'Hexágono', tip: 'Shift+H' },
  { id: 'pentagon', icon: Pentagon, title: 'Pentágono', tip: 'Shift+N' },
  { id: 'image', icon: ImageIcon, title: 'Imagen', tip: 'Ctrl+Shift+K', sepBefore: true },
];

const CONTENT: ToolItem[] = [
  { id: 'text', icon: Type, title: 'Texto', tip: 'T' },
  { id: 'field', icon: LayoutTemplate, title: 'Campo Excel', tip: 'F' },
];

const MORE_SECTIONS: { label: string; items: ToolItem[] }[] = [
  {
    label: 'Contenido',
    items: [
      { id: 'logo', icon: ImagePlus, title: 'Logo', tip: '' },
      { id: 'imageSlot', icon: Images, title: 'Slot foto', tip: 'I' },
    ],
  },
  {
    label: 'Estructura',
    items: [
      { id: 'grid', icon: Grid3X3, title: 'Cuadrícula', tip: 'G' },
      { id: 'table', icon: Table2, title: 'Tabla', tip: 'B' },
      { id: 'checkbox', icon: CheckSquare, title: 'Casilla', tip: '' },
      { id: 'signature', icon: PenLine, title: 'Firma', tip: '' },
    ],
  },
];

const MORE_TOOLS = MORE_SECTIONS.flatMap((section) => section.items);

const MENU_WIDTH = 220;
const MORE_MENU_WIDTH = 236;
const MENU_GAP = 8;

type MenuCoords = { left: number; top: number };

function isMenuItemChecked(id: ShapeTool | 'image', tool: CanvasTool, lastShapeTool: ShapeTool): boolean {
  if (id === 'image') return tool === 'image';
  return isShapeTool(tool) ? tool === id : lastShapeTool === id;
}

function menuPosition(trigger: DOMRect, width: number): MenuCoords {
  const left = Math.min(Math.max(width / 2 + 8, trigger.left + trigger.width / 2), window.innerWidth - width / 2 - 8);
  const top = Math.min(trigger.bottom + MENU_GAP, window.innerHeight - 8);
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
    const onLayout = () => {
      const el = rootRef.current;
      if (el) setMenu(menuPosition(el.getBoundingClientRect(), MENU_WIDTH));
    };
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
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
      if (onPointer) window.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const currentShapeId: ShapeTool | 'image' = tool === 'image' ? 'image' : isShapeTool(tool) ? tool : lastShapeTool;
  const currentShape = SHAPE_MENU_ITEMS.find((item) => item.id === currentShapeId) ?? SHAPE_MENU_ITEMS[0];
  const CurrentIcon = currentShape.icon;
  const shapeActive = isShapeTool(tool) || tool === 'image';
  const lastLabel = currentShape.title;
  const lastTip = currentShape.tip || undefined;

  const closeMenu = () => setMenu(null);

  const toggleMenu = () => {
    if (open) {
      closeMenu();
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    setMenu(menuPosition(el.getBoundingClientRect(), MENU_WIDTH));
  };

  const selectTool = (id: ShapeTool | 'image') => {
    if (isShapeTool(id)) setLastShapeTool(id);
    onTool(id);
    closeMenu();
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <div className="canvas-shape-split" data-active={shapeActive || open} data-open={open}>
        <WithHoverTooltip label={lastLabel} shortcut={lastTip} placement="bottom" variant="dark">
          <button
            type="button"
            aria-label={lastLabel}
            aria-pressed={shapeActive}
            aria-expanded={open}
            className="canvas-toolbar-tool canvas-toolbar-tool--labeled canvas-shape-split-main"
            data-active={shapeActive}
            onClick={(e) => {
              e.stopPropagation();
              closeMenu();
              onTool(currentShapeId);
            }}
          >
            <CurrentIcon className="h-4 w-4" strokeWidth={shapeActive ? 2 : 1.5} />
            <span className="canvas-toolbar-tool-label">{lastLabel}</span>
          </button>
        </WithHoverTooltip>
        <WithHoverTooltip label="Más formas" placement="bottom" variant="dark">
          <button
            type="button"
            aria-label="Más formas"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            className="canvas-toolbar-tool canvas-shape-split-chevron"
            data-active={open}
            onClick={(e) => {
              e.stopPropagation();
              toggleMenu();
            }}
          >
            <ChevronDown className="h-3 w-3" strokeWidth={2} />
          </button>
        </WithHoverTooltip>
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
                transform: 'translateX(-50%)',
                pointerEvents: 'auto',
              }}
            >
              {SHAPE_MENU_ITEMS.map(({ id, icon: ItemIcon, title, tip, sepBefore }) => {
                const checked = isMenuItemChecked(id, tool, lastShapeTool);
                return (
                  <div key={id}>
                    {sepBefore ? <div className="canvas-shape-menu-sep" role="separator" /> : null}
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={checked}
                      className="canvas-shape-menu-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        selectTool(id);
                      }}
                    >
                      <span className="canvas-shape-menu-icon" aria-hidden>
                        <ItemIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </span>
                      <span className="canvas-shape-menu-label">{title}</span>
                      {tip ? <span className="canvas-shape-menu-tip" aria-hidden="true">{tip}</span> : null}
                    </button>
                  </div>
                );
              })}
            </div>,
            (rootRef.current?.closest('.canvas-app') as HTMLElement | null) ?? document.body,
          )
        : null}
    </div>
  );
}

function isMoreTool(tool: CanvasTool): boolean {
  return MORE_TOOLS.some((item) => item.id === tool);
}

function MoreToolMenu({ tool, onTool }: BottomToolbarProps) {
  const [menu, setMenu] = useState<MenuCoords | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = menu != null;
  const active = isMoreTool(tool);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };

    let onPointer: ((e: MouseEvent) => void) | null = null;
    const onLayout = () => {
      const el = rootRef.current;
      if (el) setMenu(menuPosition(el.getBoundingClientRect(), MORE_MENU_WIDTH));
    };
    const timer = window.setTimeout(() => {
      onPointer = (e: MouseEvent) => {
        const target = e.target as Node;
        if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
        setMenu(null);
      };
      window.addEventListener('mousedown', onPointer);
    }, 0);

    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
      if (onPointer) window.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const toggleMenu = () => {
    if (open) {
      setMenu(null);
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    setMenu(menuPosition(el.getBoundingClientRect(), MORE_MENU_WIDTH));
  };

  const selectTool = (id: CanvasTool) => {
    onTool(id);
    setMenu(null);
  };

  return (
    <div ref={rootRef} className="relative shrink-0" data-testid="canvas-more-tools">
      <WithHoverTooltip label="Más herramientas" placement="bottom" variant="dark">
        <button
          type="button"
          aria-label="Más herramientas"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-pressed={active}
          className="canvas-toolbar-tool canvas-toolbar-tool--labeled canvas-more-tools-trigger"
          data-active={active}
          data-open={open}
          onClick={(e) => {
            e.stopPropagation();
            toggleMenu();
          }}
        >
          <Plus className="h-4 w-4" strokeWidth={active ? 2 : 1.75} />
          <span className="canvas-toolbar-tool-label">Más</span>
          <ChevronDown className="h-3 w-3" strokeWidth={2} />
        </button>
      </WithHoverTooltip>

      {menu
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className="canvas-shape-menu canvas-more-tools-menu"
              role="menu"
              aria-label="Más herramientas"
              style={{
                position: 'fixed',
                left: menu.left,
                top: menu.top,
                width: MORE_MENU_WIDTH,
                transform: 'translateX(-50%)',
                pointerEvents: 'auto',
              }}
            >
              {MORE_SECTIONS.map((section, sectionIndex) => (
                <div key={section.label} role="group" aria-label={section.label}>
                  {sectionIndex > 0 ? <div className="canvas-shape-menu-sep" role="separator" /> : null}
                  <div className="canvas-tool-menu-heading">{section.label}</div>
                  {section.items.map(({ id, icon: ItemIcon, title, tip }) => {
                    const checked = tool === id;
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
                        <span className="canvas-shape-menu-icon" aria-hidden>
                          <ItemIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </span>
                        <span className="canvas-shape-menu-label">{title}</span>
                        {checked ? <Check className="canvas-tool-menu-check" strokeWidth={2.5} aria-hidden /> : null}
                        {tip ? <span className="canvas-shape-menu-tip" aria-hidden="true">{tip}</span> : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>,
            (rootRef.current?.closest('.canvas-app') as HTMLElement | null) ?? document.body,
          )
        : null}
    </div>
  );
}

function ToolGroup({
  tools,
  tool,
  onTool,
  showLabels = false,
}: {
  tools: ToolItem[];
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  showLabels?: boolean;
}) {
  return (
    <>
      {tools.map(({ id, icon: Icon, title, tip }) => {
        const active = tool === id;
        return (
          <WithHoverTooltip key={id} label={title} shortcut={tip || undefined} placement="bottom" variant="dark">
            <button
              type="button"
              aria-label={title}
              aria-pressed={active}
              className={`canvas-toolbar-tool${showLabels ? ' canvas-toolbar-tool--labeled' : ''}`}
              data-active={active}
              onClick={(e) => {
                e.stopPropagation();
                onTool(id);
              }}
            >
              <Icon className="h-4 w-4" strokeWidth={active ? 2 : 1.5} />
              {showLabels ? <span className="canvas-toolbar-tool-label">{title}</span> : null}
            </button>
          </WithHoverTooltip>
        );
      })}
    </>
  );
}

export default memo(function BottomToolbar({ tool, onTool }: BottomToolbarProps) {
  return (
    <div
      className="canvas-toolbar-dock pointer-events-none absolute left-1/2 top-3 z-[70] -translate-x-1/2"
      data-testid="canvas-toolbar-dock"
    >
      <div className="canvas-toolbar-float pointer-events-auto" role="toolbar" aria-label="Herramientas Canvas">
        <ToolGroup tools={NAV} tool={tool} onTool={onTool} showLabels />
        <div className="canvas-toolbar-sep" aria-hidden />
        <ShapeToolMenu tool={tool} onTool={onTool} />
        <div className="canvas-toolbar-sep" aria-hidden />
        <ToolGroup tools={CONTENT} tool={tool} onTool={onTool} showLabels />
        <div className="canvas-toolbar-sep" aria-hidden />
        <MoreToolMenu tool={tool} onTool={onTool} />
      </div>
    </div>
  );
});

