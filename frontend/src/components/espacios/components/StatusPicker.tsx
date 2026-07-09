import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BoardColumn, TareaStatus } from '../types';
import {
  columnColor,
  columnLabel,
  columnSoft,
  fallbackBoardColumns,
  pickerColumns,
} from '../utils/statusConfig';

interface StatusPickerProps {
  value: TareaStatus;
  onChange: (status: TareaStatus) => void;
  columns?: BoardColumn[];
  label?: string;
  disabled?: boolean;
  /** Compact chip for table cells; default is form-sized. */
  size?: 'sm' | 'md';
  className?: string;
}

interface MenuPosition {
  top: number;
  left: number;
  minWidth: number;
}

const MENU_GAP = 6;

export default function StatusPicker({
  value,
  onChange,
  columns: columnsProp,
  label,
  disabled = false,
  size = 'sm',
  className = '',
}: StatusPickerProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const finishedRef = useRef(false);

  const columns = useMemo(
    () => (columnsProp && columnsProp.length > 0 ? columnsProp : fallbackBoardColumns('local')),
    [columnsProp],
  );
  const options = useMemo(() => pickerColumns(columns), [columns]);

  const color = columnColor(columns, value);
  const soft = columnSoft(columns, value);
  const displayLabel = columnLabel(columns, value);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 180;
    const menuWidth = Math.max(rect.width, 168);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < menuHeight + MENU_GAP && rect.top > spaceBelow;

    let left = rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));

    const top = openUp
      ? Math.max(8, rect.top - menuHeight - MENU_GAP)
      : Math.min(rect.bottom + MENU_GAP, window.innerHeight - menuHeight - 8);

    setPosition({ top, left, minWidth: menuWidth });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    finishedRef.current = false;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onLayout = () => updatePosition();

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, [open, updatePosition]);

  const pick = (status: TareaStatus) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onChange(status);
    setOpen(false);
  };

  const isSm = size === 'sm';

  return (
    <div className={`relative inline-flex ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={label ?? `Estado: ${displayLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`group inline-flex items-center gap-1.5 rounded-full border font-medium outline-none transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
          isSm ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-sm'
        } focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/35`}
        style={{
          color,
          background: soft,
          borderColor: `color-mix(in srgb, ${color} 32%, transparent)`,
        }}
      >
        <span
          className={`shrink-0 rounded-full ${isSm ? 'h-1.5 w-1.5' : 'h-2 w-2'}`}
          style={{ backgroundColor: color, boxShadow: `0 0 0 2px color-mix(in srgb, ${color} 22%, transparent)` }}
          aria-hidden
        />
        <span className="whitespace-nowrap">{displayLabel}</span>
        <ChevronDown
          className={`shrink-0 opacity-60 transition-transform duration-150 ${isSm ? 'h-3 w-3' : 'h-3.5 w-3.5'} ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="listbox"
            aria-label="Seleccionar estado"
            className="fixed z-[200] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shadow-[0_12px_40px_color-mix(in_srgb,var(--bg-base)_55%,transparent),0_0_0_1px_color-mix(in_srgb,var(--border-medium)_40%,transparent)]"
            style={
              position
                ? { top: position.top, left: position.left, minWidth: position.minWidth }
                : { top: -9999, left: -9999, visibility: 'hidden' }
            }
            onMouseDown={(e) => e.stopPropagation()}
          >
            {options.map((col) => {
              const selected = col.key === value;
              return (
                <button
                  key={col.key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => pick(col.key)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors duration-100 ${
                    selected
                      ? 'bg-[var(--bg-base)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-base)]/70 hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: col.color,
                      boxShadow: selected
                        ? `0 0 0 3px color-mix(in srgb, ${col.color} 22%, transparent)`
                        : undefined,
                    }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 font-medium">{col.name}</span>
                  {selected && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-[var(--text-primary)]" strokeWidth={2.5} aria-hidden />
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
