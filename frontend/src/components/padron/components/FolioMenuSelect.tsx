import { useId, type CSSProperties } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useAnchoredPopover } from '@/hooks/useAnchoredPopover';
import { useRovingListbox } from '@/hooks/useRovingListbox';
import Button from '@/components/ui/Button';

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
  const {
    isOpen: open,
    triggerRef,
    popupRef: listRef,
    close,
    toggle,
  } = useAnchoredPopover({ floating: false, stopEscapePropagation: true });
  const menuId = useId();

  const selected = options.find((o) => o.value === value) ?? options[0];

  const pick = (next: string) => {
    onChange(next);
    close();
  };

  const onListKeyDown = useRovingListbox(listRef, open, pick);

  return (
    <div
      className={`vpad-folio-menu vpad-folio-menu--${variant}${open ? ' is-open' : ''}`}
    >
      <Button variant="none" size="none"
        ref={triggerRef}
        className="vpad-folio-menu-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
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
      </Button>

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
              <Button variant="none" size="none"
                key={opt.value}
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
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
