import { Check, ChevronDown } from 'lucide-react';
import {
  useEffect,
  useId,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopover } from '@/hooks/useAnchoredPopover';
import Button from '@/components/ui/Button';

interface TemplatePickerOption {
  value: string;
  label: string;
}

interface TemplatePickerProps {
  value: string;
  options: ReadonlyArray<TemplatePickerOption>;
  onChange: (value: string) => void;
  placeholder: string;
  'aria-label'?: string;
  disabled?: boolean;
  maxMenuHeight?: number;
  direction?: 'auto' | 'up' | 'down';
  triggerClassName?: string;
}

const MENU_GAP = 4;

export default function TemplatePicker({
  value,
  options,
  onChange,
  placeholder,
  'aria-label': ariaLabel = 'Elegir plantilla',
  disabled = false,
  maxMenuHeight,
  direction = 'auto',
  triggerClassName,
}: TemplatePickerProps) {
  const {
    isOpen: open,
    position,
    triggerRef,
    popupRef: listRef,
    close,
    toggle,
    updatePosition,
  } = useAnchoredPopover({
    estimatedHeight: 280,
    direction,
    gap: MENU_GAP,
    matchTriggerWidth: true,
    maxHeightCap: maxMenuHeight,
    stopEscapePropagation: true,
  });
  const menuId = useId();

  const selected = options.find((o) => o.value === value);
  const displayLabel = selected?.label ?? placeholder;

  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);

  useEffect(() => {
    if (open) updatePosition();
  }, [open, options.length, maxMenuHeight, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const selectedBtn = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    (selectedBtn ?? listRef.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    close();
  };

  const onListKeyDown = (event: KeyboardEvent) => {
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    if (items.length === 0) return;
    const idx = items.findIndex((el) => el === document.activeElement);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(idx + 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const active = document.activeElement as HTMLButtonElement | null;
      const val = active?.dataset.value;
      if (val != null) pick(val);
    }
  };

  return (
    <div className={`pp-template-picker relative w-full${open ? ' is-open' : ''}`}>
      <Button variant="none" size="none"
        ref={triggerRef}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          toggle();
        }}
        className={`pp-template-picker-trigger flex h-7 w-full items-center gap-1.5 rounded-md border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-2 text-left text-[10px] text-[var(--text-primary)] outline-none transition-[border-color,transform] duration-100 ease-out focus-visible:border-[var(--accent-primary)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50${triggerClassName ? ` ${triggerClassName}` : ''}`}
      >
        <span className="min-w-0 flex-1 truncate">{displayLabel}</span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={`shrink-0 text-[var(--text-muted)] transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </Button>

      {open &&
        createPortal(
          <div
            ref={listRef}
            id={menuId}
            role="listbox"
            aria-label={ariaLabel}
            className="pp-template-picker-list fixed z-[200] flex flex-col gap-px rounded-[11px] p-1"
            style={
              position
                ? {
                    top: position.top,
                    left: position.left,
                    width: position.width,
                    ...(maxMenuHeight != null
                      ? { maxHeight: position.maxHeight ?? maxMenuHeight, overflowY: 'auto' as const }
                      : {}),
                  }
                : { top: -9999, left: -9999, visibility: 'hidden' }
            }
            onKeyDown={onListKeyDown}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <OptionRow
              value=""
              label={placeholder}
              selected={!value}
              muted
              onPick={pick}
            />
            {options.map((opt) => (
              <OptionRow
                key={opt.value}
                value={opt.value}
                label={opt.label}
                selected={opt.value === value}
                onPick={pick}
              />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function OptionRow({
  value,
  label,
  selected,
  muted = false,
  onPick,
}: {
  value: string;
  label: string;
  selected: boolean;
  muted?: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <Button variant="none" size="none"
      role="option"
      aria-selected={selected}
      data-value={value}
      onClick={() => onPick(value)}
      className={`pp-template-picker-option flex w-full items-center gap-2 rounded-[7px] px-2 py-[5px] text-left text-[10px] leading-tight tracking-[-0.01em] outline-none transition-colors duration-100 ease-[cubic-bezier(0.2,0,0,1)] ${
        selected
          ? 'bg-[color-mix(in_srgb,var(--accent-primary)_14%,transparent)] text-[var(--text-primary)]'
          : muted
            ? 'text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)] hover:text-[var(--text-secondary)]'
            : 'text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)]'
      } focus-visible:bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)]`}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
        {selected ? (
          <Check size={12} strokeWidth={2.5} className="text-[var(--accent-primary)]" />
        ) : null}
      </span>
    </Button>
  );
}
