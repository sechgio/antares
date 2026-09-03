import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface FolioMenuOption {
  value: string;
  label: string;
  detail?: string;
  labelStyle?: CSSProperties;
}

interface FolioMenuSelectProps {
  value: string;
  options: ReadonlyArray<FolioMenuOption>;
  onChange: (value: string) => void;
  'aria-label': string;
  variant?: 'setting' | 'toolbar';
}

export default function FolioMenuSelect({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  variant = 'setting',
}: FolioMenuSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const selected = options.find((o) => o.value === value) ?? options[0];

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedBtn = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    selectedBtn?.focus();
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
    <div
      className={`vpad-folio-menu vpad-folio-menu--${variant}${open ? ' is-open' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="vpad-folio-menu-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="vpad-folio-menu-trigger-label" style={selected?.labelStyle}>
          {selected?.label ?? '—'}
        </span>
        <ChevronDown
          className="vpad-folio-menu-chevron"
          size={variant === 'toolbar' ? 14 : 13}
          strokeWidth={2}
          aria-hidden
        />
      </button>

      {open && (
        <div
          ref={listRef}
          id={menuId}
          role="listbox"
          aria-label={ariaLabel}
          className="vpad-folio-menu-list"
          onKeyDown={onListKeyDown}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-value={opt.value}
                className={`vpad-folio-menu-option${isSelected ? ' is-selected' : ''}`}
                onClick={() => pick(opt.value)}
              >
                <span className="vpad-folio-menu-option-label" style={opt.labelStyle}>
                  {opt.label}
                </span>
                {opt.detail && (
                  <span className="vpad-folio-menu-option-detail tabular-nums">
                    {opt.detail}
                  </span>
                )}
                <span className="vpad-folio-menu-check" aria-hidden="true">
                  {isSelected ? <Check size={13} strokeWidth={2.5} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
