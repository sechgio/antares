import { useEffect, useId, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';

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
    <div className="relative w-full">
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
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
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
          </div>,
          document.body,
        )}
    </div>
  );
}
