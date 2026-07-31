import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import {
  CANVAS_FONTS,
  ensureCanvasFontsLoaded,
  getFontByStack,
} from '../ops/fontCatalog';

interface FontPickerProps {
  value: string;
  onChange: (stack: string) => void;
  'aria-label'?: string;
  className?: string;
  disabled?: boolean;
}

interface MenuBox {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

const MENU_GAP = 8;
const MENU_EDGE = 8;
const MENU_WIDTH = 240;
const MENU_MAX_H = 420;

export default function FontPicker({
  value,
  onChange,
  'aria-label': ariaLabel = 'Familia de fuente',
  className = '',
  disabled = false,
}: FontPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuBox, setMenuBox] = useState<MenuBox | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = getFontByStack(value) ?? CANVAS_FONTS[0];
  const displayLabel = selected?.label ?? value;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CANVAS_FONTS;
    return CANVAS_FONTS.filter((f) => f.label.toLowerCase().includes(q));
  }, [query]);

  /** Float to the left of the trigger (Figma-style), clamped to the viewport. */
  const updateMenuBox = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = MENU_WIDTH;
    const spaceLeft = rect.left - MENU_GAP - MENU_EDGE;
    const spaceRight = window.innerWidth - rect.right - MENU_GAP - MENU_EDGE;
    // Prefer left (reference); fall back to right if left is too tight.
    const openLeft = spaceLeft >= width || spaceLeft >= spaceRight;
    const left = openLeft
      ? Math.max(MENU_EDGE, rect.left - width - MENU_GAP)
      : Math.min(rect.right + MENU_GAP, window.innerWidth - width - MENU_EDGE);

    const maxHeight = Math.min(
      MENU_MAX_H,
      Math.max(180, window.innerHeight - MENU_EDGE * 2),
    );
    // Align top with trigger; if it would overflow bottom, shift up.
    let top = Math.max(MENU_EDGE, rect.top);
    if (top + maxHeight > window.innerHeight - MENU_EDGE) {
      top = Math.max(MENU_EDGE, window.innerHeight - MENU_EDGE - maxHeight);
    }

    setMenuBox({ top, left, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuBox(null);
      setPortalRoot(null);
      return;
    }
    ensureCanvasFontsLoaded();
    const host =
      (containerRef.current?.closest('.canvas-app') as HTMLElement | null) ?? document.body;
    setPortalRoot(host);
    updateMenuBox();
    setQuery('');
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [isOpen, updateMenuBox]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const onLayout = () => updateMenuBox();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, [isOpen, updateMenuBox]);

  const handleSelect = (stack: string) => {
    if (disabled) return;
    onChange(stack);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className={`canvas-input flex w-full items-center justify-between gap-1.5 px-2 text-left cursor-pointer transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${
          isOpen ? 'ring-1 ring-[var(--cv-accent,#0d99ff)] border-[var(--cv-accent,#0d99ff)]' : ''
        }`}
      >
        <span
          className="truncate min-w-0 font-medium text-[12px]"
          style={{ fontFamily: selected?.stack ?? value }}
        >
          {displayLabel}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--cv-text-muted)] transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-[var(--cv-accent)]' : ''
          }`}
        />
      </button>

      {isOpen &&
        portalRoot &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel}
            data-placement="side"
            className="fixed z-[300] flex flex-col overflow-hidden rounded-lg border shadow-lg"
            style={{
              top: menuBox?.top ?? -9999,
              left: menuBox?.left ?? -9999,
              width: menuBox?.width ?? MENU_WIDTH,
              height: menuBox?.maxHeight ?? MENU_MAX_H,
              maxHeight: menuBox?.maxHeight ?? MENU_MAX_H,
              visibility: menuBox ? 'visible' : 'hidden',
              background: 'var(--cv-panel-elevated, #ffffff)',
              borderColor: 'var(--cv-border-strong, #c9d0d8)',
              boxShadow: 'var(--cv-shadow-float, 0 12px 28px rgba(26, 35, 50, 0.14))',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--cv-border,#e2e8f0)] bg-[var(--cv-panel-elevated)] px-2.5 py-2">
              <span
                className="truncate text-[12px] font-medium text-[var(--cv-text,#1a2332)]"
                style={{ fontFamily: selected?.stack ?? value }}
              >
                {displayLabel}
              </span>
              <button
                type="button"
                className="canvas-icon-btn shrink-0"
                aria-label="Cerrar"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="relative shrink-0 border-b border-[var(--cv-border,#e2e8f0)] bg-[var(--cv-panel-elevated)] px-2 py-1.5">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--cv-text-muted)]" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar fuente…"
                aria-label="Buscar fuente"
                className="canvas-input w-full !pl-7 text-[11px]"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--cv-panel-elevated)] p-1">
              {filtered.length === 0 ? (
                <p className="px-2 py-3 text-center text-[11px] text-[var(--cv-text-muted)]">
                  Sin resultados
                </p>
              ) : (
                filtered.map((font) => {
                  const isSelected = font.stack === selected?.stack;
                  return (
                    <button
                      key={font.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(font.stack)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                        isSelected
                          ? 'bg-[var(--cv-active,#e8f3fb)] text-[var(--cv-accent,#0d99ff)]'
                          : 'text-[var(--cv-text,#1a2332)] hover:bg-[var(--cv-hover,#f0f3f7)]'
                      }`}
                    >
                      <span
                        className="truncate text-[13px] leading-snug"
                        style={{ fontFamily: font.stack }}
                      >
                        {font.label}
                      </span>
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-[var(--cv-accent,#0d99ff)]" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          portalRoot,
        )}
    </div>
  );
}
