import { Check, ChevronDown } from 'lucide-react';
import { useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopover } from '../../../../hooks/useAnchoredPopover';

export interface SelectPickerOption {
  value: string;
  label: string;
  color?: string;
}

interface SelectPickerProps {
  value: string;
  options: SelectPickerOption[];
  onChange: (value: string) => void;
  'aria-label': string;
  className?: string;
  disabled?: boolean;
}

export default function SelectPicker({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  className = '',
  disabled = false,
}: SelectPickerProps) {
  const menuId = useId();
  const finishedRef = useRef(false);
  const {
    isOpen: open,
    position,
    triggerRef,
    popupRef: menuRef,
    close,
    toggle,
  } = useAnchoredPopover({ estimatedHeight: 200, estimatedWidth: 176 });

  const selected = options.find((o) => o.value === value) ?? options[0];
  const isFiltered = selected && selected.value !== options[0]?.value;

  useLayoutEffect(() => {
    if (open) finishedRef.current = false;
  }, [open]);

  const pick = (next: string) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onChange(next);
    close();
  };

  return (
    <div className={`relative inline-flex ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => !disabled && toggle()}
        className={`group inline-flex h-8 max-w-[200px] items-center gap-1.5 rounded-full border bg-[var(--bg-elevated)] pl-2.5 pr-2 text-xs outline-none transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
          open
            ? 'border-[var(--accent-primary)] text-[var(--text-primary)] shadow-[0_0_0_3px_var(--accent-primary-glow)]'
            : isFiltered
              ? 'border-[var(--border-medium)] text-[var(--text-primary)] hover:border-[var(--accent-primary)]/50'
              : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]'
        } focus-visible:border-[var(--accent-primary)] focus-visible:shadow-[0_0_0_3px_var(--accent-primary-glow)]`}
      >
        {selected?.color && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: selected.color }}
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{selected?.label ?? '—'}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform duration-150 ${
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
            aria-label={ariaLabel}
            className="fixed z-[200] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shadow-[0_12px_40px_color-mix(in_srgb,var(--bg-base)_55%,transparent),0_0_0_1px_color-mix(in_srgb,var(--border-medium)_40%,transparent)]"
            style={
              position
                ? { top: position.top, left: position.left, minWidth: position.width }
                : { top: -9999, left: -9999, visibility: 'hidden' }
            }
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
                  onClick={() => pick(opt.value)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors duration-100 ${
                    isSelected
                      ? 'bg-[color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-base)]/70 hover:text-[var(--text-primary)]'
                  }`}
                >
                  {opt.color ? (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: opt.color,
                        boxShadow: isSelected
                          ? `0 0 0 3px color-mix(in srgb, ${opt.color} 22%, transparent)`
                          : undefined,
                      }}
                      aria-hidden
                    />
                  ) : (
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full border ${
                        isSelected
                          ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]'
                          : 'border-[var(--border-medium)] bg-transparent'
                      }`}
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1 font-medium">{opt.label}</span>
                  {isSelected && (
                    <Check
                      className="h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]"
                      strokeWidth={2.5}
                      aria-hidden
                    />
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
