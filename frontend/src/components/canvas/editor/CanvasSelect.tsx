import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface CanvasSelectOption {
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

export default function CanvasSelect({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  className = '',
  disabled = false,
}: CanvasSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  const selectedOption = options.find((opt) => opt.value === value) || options[0];

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isOpen]);

  const handleSelect = (val: string) => {
    if (disabled) return;
    onChange(val);
    setIsOpen(false);

    if (selectRef.current && selectRef.current.value !== val) {
      selectRef.current.value = val;
    }
  };

  const handleNativeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value);
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Synchronized select element for form accessibility & test compatibility */}
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

      {/* Styled custom trigger button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-label={ariaLabel}
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
      </button>

      {/* Styled Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border p-1 shadow-lg transition-opacity duration-150"
          style={{
            background: 'var(--cv-panel-elevated)',
            borderColor: 'var(--cv-border-strong)',
            boxShadow: 'var(--cv-shadow-float)',
          }}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[11px] text-left transition-colors ${
                  isSelected
                    ? 'bg-[var(--cv-active)] font-medium text-[var(--cv-accent)]'
                    : 'text-[var(--cv-text)] hover:bg-[var(--cv-hover)]'
                }`}
              >
                <span className="truncate flex items-center gap-1.5 min-w-0">
                  {opt.icon}
                  <span className="truncate">{opt.label}</span>
                </span>
                {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--cv-accent)]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
