import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { clampZoom, nextZoomPreset } from '../ops/viewportNav';

interface ZoomMenuProps {
  zoom: number;
  onZoom: (z: number) => void;
  onZoomFit: () => void;
  onZoomSelection?: () => void;
  showRulers?: boolean;
  onToggleRulers?: () => void;
  snapToGrid?: boolean;
  onToggleSnapToGrid?: () => void;
}

function parseZoomPercent(raw: string): number | null {
  const cleaned = raw.trim().replace(/%/g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return clampZoom(n / 100);
}

interface ZoomAction {
  id: string;
  label: string;
  tip?: string;
  run: () => void;
  checked?: boolean;
}

interface MenuBox {
  top: number;
  left: number;
}

const MENU_WIDTH = 260;
const MENU_GAP = 6;
const MENU_EDGE = 8;

export default function ZoomMenu({
  zoom,
  onZoom,
  onZoomFit,
  onZoomSelection,
  showRulers = true,
  onToggleRulers,
  snapToGrid = false,
  onToggleSnapToGrid,
}: ZoomMenuProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [menuBox, setMenuBox] = useState<MenuBox | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const pct = Math.round(zoom * 100);

  const updateMenuBox = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(
      MENU_EDGE,
      Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - MENU_EDGE),
    );
    setMenuBox({ top: rect.bottom + MENU_GAP, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuBox(null);
      setPortalRoot(null);
      return;
    }
    setDraft(`${pct}%`);
    const host =
      (rootRef.current?.closest('.canvas-app') as HTMLElement | null) ?? document.body;
    setPortalRoot(host);
    updateMenuBox();
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
    // Only on open transition — pct changes while open are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, updateMenuBox]);

  useEffect(() => {
    if (!open) return;
    if (document.activeElement === inputRef.current) return;
    setDraft(`${pct}%`);
  }, [open, pct]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onLayout = () => updateMenuBox();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, [open, updateMenuBox]);

  const commitDraft = () => {
    const next = parseZoomPercent(draft);
    if (next == null) {
      setDraft(`${pct}%`);
      return;
    }
    onZoom(next);
    setOpen(false);
  };

  const runAndClose = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  const near = (target: number) => Math.abs(pct - target) < 1;

  const actions: ZoomAction[] = [
    {
      id: 'in',
      label: 'Acercar',
      tip: 'Ctrl++',
      run: () => onZoom(nextZoomPreset(zoom, 'in')),
    },
    {
      id: 'out',
      label: 'Alejar',
      tip: 'Ctrl+-',
      run: () => onZoom(nextZoomPreset(zoom, 'out')),
    },
    {
      id: 'fit',
      label: 'Zoom para encajar',
      tip: 'Shift+1',
      run: onZoomFit,
    },
    ...(onZoomSelection
      ? [
          {
            id: 'selection',
            label: 'Zoom a la selección',
            tip: 'Shift+2',
            run: onZoomSelection,
          } satisfies ZoomAction,
        ]
      : []),
    {
      id: '50',
      label: 'Zoom al 50 %',
      run: () => onZoom(0.5),
      checked: near(50),
    },
    {
      id: '100',
      label: 'Zoom al 100 %',
      tip: 'Ctrl+0',
      run: () => onZoom(1),
      checked: near(100),
    },
    {
      id: '200',
      label: 'Zoom al 200 %',
      run: () => onZoom(2),
      checked: near(200),
    },
    ...(onToggleRulers
      ? [
          {
            id: 'rulers',
            label: showRulers ? 'Ocultar reglas' : 'Mostrar reglas',
            tip: 'Shift+R',
            run: onToggleRulers,
            checked: showRulers,
          } satisfies ZoomAction,
        ]
      : []),
    ...(onToggleSnapToGrid
      ? [
          {
            id: 'snap-grid',
            label: snapToGrid ? 'Desactivar snap a cuadrícula' : 'Snap a cuadrícula',
            tip: "Shift+'",
            run: onToggleSnapToGrid,
            checked: snapToGrid,
          } satisfies ZoomAction,
        ]
      : []),
  ];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <WithHoverTooltip label="Zoom" placement="bottom" variant="dark">
        <button
          type="button"
          className="canvas-zoom-trigger"
          aria-label="Zoom"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
        >
          <span>{pct}%</span>
          <ChevronDown className="h-2.5 w-2.5 opacity-70" strokeWidth={2.5} aria-hidden />
        </button>
      </WithHoverTooltip>

      {open &&
        portalRoot &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className="canvas-zoom-menu"
            role="menu"
            data-testid="canvas-zoom-menu"
            style={{
              top: menuBox?.top ?? -9999,
              left: menuBox?.left ?? -9999,
              visibility: menuBox ? 'visible' : 'hidden',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="canvas-zoom-menu-pad">
              <input
                ref={inputRef}
                className="canvas-zoom-menu-input"
                value={draft}
                aria-label="Porcentaje de zoom"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitDraft();
                  }
                }}
                onBlur={() => {
                  const next = parseZoomPercent(draft);
                  if (next != null) onZoom(next);
                  else setDraft(`${pct}%`);
                }}
              />
            </div>

            <div className="canvas-zoom-menu-sep" />

            <div className="canvas-zoom-menu-pad py-1">
              {actions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className="canvas-zoom-menu-item"
                  onClick={() => runAndClose(item.run)}
                >
                  <span className="canvas-zoom-menu-check" aria-hidden>
                    {item.checked ? <Check className="h-3 w-3" strokeWidth={2.5} /> : null}
                  </span>
                  <span className="min-w-0 flex-1 text-left">{item.label}</span>
                  {item.tip ? <span className="canvas-zoom-menu-tip">{item.tip}</span> : null}
                </button>
              ))}
            </div>
          </div>,
          portalRoot,
        )}
    </div>
  );
}
