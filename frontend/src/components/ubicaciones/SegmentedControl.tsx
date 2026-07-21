import React from 'react';

export interface SegmentedControlOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  className = '',
  size = 'sm',
}: SegmentedControlProps<T>) {
  const pyClass = size === 'sm' ? 'py-1' : 'py-1.5';
  const textClass = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div className={`inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5 ${className}`}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 rounded-md px-3 ${pyClass} ${textClass} font-medium transition-all ${
              active
                ? 'bg-[var(--accent-primary)] text-[var(--text-on-accent)] shadow-sm'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
