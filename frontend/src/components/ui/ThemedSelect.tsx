import {
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { useAnchoredPopover, type PopoverPosition } from '../../hooks/useAnchoredPopover';

interface ThemedSelectOption {
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
  className?: string;
  triggerClassName?: string;
}

const MENU_GAP = 4;
const MENU_MAX_H = 224;

/** Shared measuring frame: off-screen and invisible until the popover is anchored. */
const PANEL_HIDDEN_STYLE: CSSProperties = { top: -9999, left: -9999, visibility: 'hidden' };

interface ThemedSelectPanelProps {
  id?: string;
  panelRef: RefObject<HTMLDivElement | null>;
  role?: 'listbox' | 'dialog';
  ariaLabel?: string;
  /** Resolved popover box; `null` keeps the panel hidden while measuring. */
  position: PopoverPosition | null;
  /** Exact style keys applied once the position is resolved. */
  positionStyle?: (position: PopoverPosition) => CSSProperties;
  /** Overrides the hidden frame; defaults to the shared off-screen fallback. */
  hiddenStyle?: CSSProperties;
  /** Portal target. Defaults to `document.body`. */
  host?: HTMLElement | null;
  className?: string;
  dataPlacement?: string;
  children: ReactNode;
}

/**
 * Anchored portal surface of the ThemedSelect family (ThemedSelect itself,
 * StatusPicker, SelectPicker, CanvasSelect, FontPicker): it owns the portal,
 * the off-screen measuring frame and the mousedown guard, while callers keep
 * their exact container classes, option rows and style maps.
 */
export function ThemedSelectPanel({
  id,
  panelRef,
  role = 'listbox',
  ariaLabel,
  position,
  positionStyle,
  hiddenStyle,
  host,
  className,
  dataPlacement,
  children,
}: ThemedSelectPanelProps) {
  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      data-placement={dataPlacement}
      className={className}
      style={position ? positionStyle?.(position) : hiddenStyle ?? PANEL_HIDDEN_STYLE}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    host ?? document.body,
  );
}

/**
 * Resolves the portal host of canvas-anchored pickers: the `.canvas-app` root
 * when the picker lives inside the canvas, falling back to `document.body`.
 */
export function usePortalHost(
  isOpen: boolean,
  containerRef: RefObject<HTMLElement | null>,
  selector = '.canvas-app',
): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) {
      setHost(null);
      return;
    }
    setHost((containerRef.current?.closest(selector) as HTMLElement | null) ?? document.body);
  }, [isOpen, containerRef, selector]);

  return host;
}

export default function ThemedSelect({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  placeholder,
  disabled = false,
  className,
  triggerClassName,
}: ThemedSelectProps) {
  const { isOpen, position: menuBox, triggerRef, popupRef: menuRef, open, close, updatePosition } =
    useAnchoredPopover({
      estimatedHeight: MENU_MAX_H,
      gap: MENU_GAP,
      matchTriggerWidth: true,
      maxHeightCap: MENU_MAX_H,
    });
  const menuId = useId();
  const [highlightedIndex, setHighlightedIndex] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));

  const selected = options.find((o) => o.value === value);
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    setHighlightedIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen, options.length, updatePosition]);

  const handleSelect = (val: string) => {
    if (disabled) return;
    onChange(val);
    close();
    triggerRef.current?.focus();
  };

  const moveHighlight = (direction: 1 | -1) => {
    if (options.length === 0) return;
    setHighlightedIndex((current) => (current + direction + options.length) % options.length);
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        setHighlightedIndex(selectedIndex);
        open();
        return;
      }
      moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      if (!isOpen || options.length === 0) return;
      event.preventDefault();
      setHighlightedIndex(event.key === 'Home' ? 0 : options.length - 1);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!isOpen) {
        setHighlightedIndex(selectedIndex);
        open();
      } else if (options[highlightedIndex]) {
        handleSelect(options[highlightedIndex].value);
      }
      return;
    }

    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      close();
    }
  };

  return (
    <div className={`relative w-full${className ? ` ${className}` : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (disabled) return;
          if (isOpen) close();
          else open();
        }}
        onKeyDown={handleTriggerKeyDown}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-controls={isOpen ? menuId : undefined}
        aria-activedescendant={isOpen && options[highlightedIndex] ? `${menuId}-${options[highlightedIndex].value}` : undefined}
        className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-[11px] font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none ${
          isOpen
            ? 'bg-[var(--bg-elevated)] border-[var(--accent-primary)] ring-2 ring-[var(--accent-primary-glow)]'
            : 'bg-[var(--bg-input)] border-[var(--border-subtle)] hover:border-[var(--border-medium)] focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary-glow)]'
        } ${disabled ? '' : 'cursor-pointer'} ${triggerClassName ?? ''}`}
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

      {isOpen && (
        <ThemedSelectPanel
          id={menuId}
          panelRef={menuRef}
          ariaLabel={ariaLabel}
          position={menuBox}
          className="fixed z-[300] overflow-y-auto rounded-lg border p-1 shadow-xl custom-scrollbar"
          positionStyle={(position) => ({
            top: position.top,
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight ?? MENU_MAX_H,
            visibility: 'visible',
            background: 'var(--bg-elevated)',
            borderColor: 'var(--border-medium)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12)',
          })}
          hiddenStyle={{
            top: -9999,
            left: -9999,
            maxHeight: MENU_MAX_H,
            visibility: 'hidden',
            background: 'var(--bg-elevated)',
            borderColor: 'var(--border-medium)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12)',
          }}
        >
            {options.map((opt, index) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  id={`${menuId}-${opt.value}`}
                  tabIndex={-1}
                  data-highlighted={index === highlightedIndex ? 'true' : undefined}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => handleSelect(opt.value)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                    index === highlightedIndex
                      ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)] font-semibold'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })}
          </ThemedSelectPanel>
        )}
    </div>
  );
}
