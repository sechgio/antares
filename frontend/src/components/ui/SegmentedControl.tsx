import type { ReactNode } from 'react';

export interface SegmentedControlOption<T extends string = string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  'aria-label'?: string;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  className = 'flex gap-0.5 rounded-lg bg-[var(--bg-input)] p-0.5',
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className={className}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-medium transition-all duration-150 ${
              active
                ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm ring-1 ring-[var(--border-subtle)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
