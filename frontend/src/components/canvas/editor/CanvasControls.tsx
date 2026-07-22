interface CanvasToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

/** Compact work-tool switch (scoped to Canvas) — Figma-like pill toggle. */
export function CanvasToggle({ checked, onChange, label, disabled }: CanvasToggleProps) {
  return (
    <label
      className="inline-flex cursor-pointer items-center gap-2 select-none"
      style={{ opacity: disabled ? 0.45 : 1, pointerEvents: disabled ? 'none' : 'auto' }}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className="canvas-switch"
        data-checked={checked}
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
}

/** Segmented control (Diseñar / Generar). */
export function CanvasSegmented<T extends string>({ value, options, onChange }: CanvasSegmentedProps<T>) {
  return (
    <div
      className="inline-flex rounded-lg p-0.5"
      style={{ background: 'var(--cv-hover)', border: '1px solid var(--cv-border)' }}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            className="rounded-md px-3 py-1 text-[11px] font-semibold transition-all duration-150"
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
