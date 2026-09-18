import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { useAnchoredPopover } from '@/hooks/useAnchoredPopover';
import Button from '@/components/ui/Button';

interface CanvasSelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string;
}

interface CanvasSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CanvasSelectOption[];
  'aria-label'?: string;
  className?: string;
  disabled?: boolean;
}

const MENU_GAP = 4;
const MENU_MAX_H = 224;

export default function CanvasSelect({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  className = '',
  disabled = false,
}: CanvasSelectProps) {
  const {
    isOpen,
    position: menuBox,
    triggerRef: containerRef,
    popupRef: menuRef,
    open,
    close,
    updatePosition,
  } = useAnchoredPopover<HTMLDivElement>({
    estimatedHeight: MENU_MAX_H,
    gap: MENU_GAP,
    matchTriggerWidth: true,
    maxHeightCap: MENU_MAX_H,
  });
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  const selectedOption = options.find((opt) => opt.value === value) || options[0];

  useLayoutEffect(() => {
    if (!isOpen) {
      setPortalRoot(null);
      return;
    }
    const host =
      (containerRef.current?.closest('.canvas-app') as HTMLElement | null) ?? document.body;
    setPortalRoot(host);
  }, [isOpen, containerRef]);

  useEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen, options.length, updatePosition]);

  const handleSelect = (val: string) => {
    if (disabled) return;
    onChange(val);
    close();

    if (selectRef.current && selectRef.current.value !== val) {
      selectRef.current.value = val;
    }
  };

  const handleNativeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value);
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <select
        ref={selectRef}
        value={value}
        onChange={handleNativeChange}
        aria-label={ariaLabel}
        disabled={disabled}
        className="sr-only"
        tabIndex={-1}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <Button variant="none" size="none"
        onClick={() => {
          if (disabled) return;
          if (isOpen) close();
          else open();
        }}
        disabled={disabled}
        aria-expanded={isOpen}
        className="canvas-input flex w-full items-center justify-between gap-1.5 px-2 text-left cursor-pointer transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="truncate flex items-center gap-1.5 min-w-0 font-medium">
          {selectedOption?.icon}
          <span className="truncate">{selectedOption?.label || value}</span>
          {selectedOption?.badge && (
            <span className="ml-auto shrink-0 rounded px-1 text-[9px] font-semibold bg-[var(--cv-hover)] text-[var(--cv-text-muted)]">
              {selectedOption.badge}
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--cv-text-muted)] transition-transform duration-150 ${
            isOpen ? 'rotate-180 text-[var(--cv-accent)]' : ''
          }`}
        />
      </Button>

      {isOpen &&
        portalRoot &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel}
            className="fixed z-[300] overflow-y-auto rounded-lg border p-1 shadow-lg"
            style={{
              top: menuBox?.top ?? -9999,
              left: menuBox?.left ?? -9999,
              width: menuBox?.width,
              maxHeight: menuBox?.maxHeight ?? MENU_MAX_H,
              visibility: menuBox ? 'visible' : 'hidden',
              background: 'var(--cv-panel-elevated, #ffffff)',
              borderColor: 'var(--cv-border-strong, #c9d0d8)',
              boxShadow: 'var(--cv-shadow-float, 0 12px 28px rgba(26, 35, 50, 0.1))',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <Button variant="none" size="none"
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(opt.value)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[11px] text-left transition-colors ${
                    isSelected
                      ? 'bg-[var(--cv-active,#e8f3fb)] font-medium text-[var(--cv-accent,#0d99ff)]'
                      : 'text-[var(--cv-text,#1a2332)] hover:bg-[var(--cv-hover,#f0f3f7)]'
                  }`}
                >
                  <span className="truncate flex items-center gap-1.5 min-w-0">
                    {opt.icon}
                    <span className="truncate">{opt.label}</span>
                  </span>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--cv-accent,#0d99ff)]" />}
                </Button>
              );
            })}
          </div>,
          portalRoot,
        )}
    </div>
  );
}
