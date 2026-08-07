import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface ThemedSelectOption {
  value: string;
  label: string;
}

interface ThemedSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ThemedSelectOption[];
  'aria-label'?: string;
  placeholder?: string;
  disabled?: boolean;
}

interface MenuBox {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

const MENU_GAP = 4;
const MENU_MAX_H = 224;

export default function ThemedSelect({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  placeholder,
  disabled = false,
}: ThemedSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<MenuBox | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  const updateMenuBox = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
    const spaceAbove = rect.top - MENU_GAP;
    const openUp = spaceBelow < Math.min(MENU_MAX_H, 120) && spaceAbove > spaceBelow;
    const maxHeight = Math.min(MENU_MAX_H, Math.max(80, openUp ? spaceAbove : spaceBelow));
    const top = openUp
      ? Math.max(8, rect.top - maxHeight - MENU_GAP)
      : rect.bottom + MENU_GAP;
    setMenuBox({
      top,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
      width: rect.width,
      maxHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuBox(null);
      setPortalRoot(null);
      return;
    }
    setPortalRoot(document.body);
    updateMenuBox();
  }, [isOpen, options.length, updateMenuBox]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setIsOpen(false);
    };
    const onLayout = () => updateMenuBox();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, [isOpen, updateMenuBox]);

  const handleSelect = (val: string) => {
    if (disabled) return;
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-[11px] font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none ${
          isOpen
            ? 'bg-[var(--bg-elevated)] border-[var(--accent-primary)] ring-2 ring-[var(--accent-primary-glow)]'
            : 'bg-[var(--bg-input)] border-[var(--border-subtle)] hover:border-[var(--border-medium)] focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary-glow)]'
        } ${disabled ? '' : 'cursor-pointer'}`}
      >
        <span className="truncate text-[var(--text-primary)]">
          {selected?.label ?? placeholder ?? value}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'
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
            className="fixed z-[300] overflow-y-auto rounded-lg border p-1 shadow-xl custom-scrollbar"
            style={{
              top: menuBox?.top ?? -9999,
              left: menuBox?.left ?? -9999,
              width: menuBox?.width,
              maxHeight: menuBox?.maxHeight ?? MENU_MAX_H,
              visibility: menuBox ? 'visible' : 'hidden',
              background: 'var(--bg-elevated)',
              borderColor: 'var(--border-medium)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(opt.value)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                    isSelected
                      ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)] font-semibold'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>,
          portalRoot,
        )}
    </div>
  );
}
