interface CanvasToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}
export function CanvasToggle({ checked, onChange, label, disabled }: CanvasToggleProps) {
  return (
    <label
      className="inline-flex items-center gap-2 select-none"
      style={{ opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer' }}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className="canvas-switch"
        data-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="canvas-switch-knob" aria-hidden />
      </button>
      {label && (
        <span className="text-[12px]" style={{ color: 'var(--cv-text-secondary)' }}>
          {label}
        </span>
      )}
    </label>
  );
}

interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface CanvasSegmentedProps<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  size?: 'sm' | 'md';
}

export function CanvasSegmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = 'md',
}: CanvasSegmentedProps<T>) {
  const compact = size === 'sm';
  return (
    <div
      className={compact ? 'flex gap-0.5 rounded-md p-0.5' : 'inline-flex rounded-lg p-0.5'}
      style={{
        background: 'var(--cv-hover)',
        border: compact ? undefined : '1px solid var(--cv-border)',
      }}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            className={
              compact
                ? 'flex-1 rounded px-2 py-1.5 text-[10px] font-medium transition-all duration-150'
                : 'rounded-md px-3 py-1 text-[11px] font-semibold transition-all duration-150'
            }
            style={
              active
                ? {
                    background: 'var(--cv-panel-elevated)',
                    color: 'var(--cv-text)',
                    boxShadow: 'var(--cv-shadow)',
                  }
                : { color: 'var(--cv-text-muted)', background: 'transparent' }
            }
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface CanvasCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function CanvasCheckbox({ checked, onChange, label, disabled }: CanvasCheckboxProps) {
  return (
    <label
      className="inline-flex items-center gap-2 select-none"
      style={{ opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer' }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={label}
        className="canvas-checkbox"
        data-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        {checked && (
          <svg viewBox="0 0 14 14" className="canvas-checkbox-check" aria-hidden>
            <path d="M3 7.5L6 10.5L11 4.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {label && (
        <span className="text-[11px]" style={{ color: 'var(--cv-text-secondary)' }}>
          {label}
        </span>
      )}
    </label>
  );
}
