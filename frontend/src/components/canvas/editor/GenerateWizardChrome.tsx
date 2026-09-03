import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle, ChevronDown } from 'lucide-react';
import { CanvasSegmented } from './CanvasControls';

interface StepProps {
  number: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  badge?: ReactNode;
  defaultOpen?: boolean;
  status?: 'pending' | 'done';
  statusLabel?: string;
}

export function GenerateStep({
  number,
  title,
  icon,
  children,
  disabled,
  badge,
  defaultOpen = true,
  status = 'pending',
  statusLabel,
}: StepProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const wasDisabled = useRef(!!disabled);
  const done = status === 'done';

  useEffect(() => {
    if (wasDisabled.current && !disabled) setIsOpen(true);
    wasDisabled.current = !!disabled;
  }, [disabled]);

  return (
    <div
      className={`rounded-lg border transition-colors ${disabled ? 'pointer-events-none opacity-40' : ''}`}
      style={{
        borderColor: isOpen ? 'var(--cv-border-strong)' : 'var(--cv-border)',
        background: isOpen ? 'var(--cv-panel-elevated)' : 'transparent',
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-2"
      >
        <span
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-colors"
          style={{
            background: done || isOpen ? 'var(--cv-accent)' : 'var(--cv-accent-soft)',
            color: done || isOpen ? '#fff' : 'var(--cv-accent)',
          }}
        >
          {done ? <CheckCircle size={12} /> : number}
        </span>
        <span className="truncate text-[11px] font-semibold" style={{ color: 'var(--cv-text)' }}>{title}</span>
        <span className="shrink-0" style={{ color: 'var(--cv-text-muted)' }}>{icon}</span>
        {(statusLabel || badge) && (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {statusLabel && (
              <span className={`canvas-generate-step-status ${done ? 'canvas-generate-step-status--done' : ''}`}>
                {statusLabel}
              </span>
            )}
            {badge && <span>{badge}</span>}
          </span>
        )}
        <ChevronDown
          size={12}
          className={`shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-0' : '-rotate-90'}`}
          style={{ color: 'var(--cv-text-muted)' }}
        />
      </button>
      {/*
        CSS grid 0fr/1fr expands to natural content height without JS measurement.
        Avoids the classic maxHeight+scrollHeight bug that clips growing children
        (e.g. column mapping rows after Excel load).
      */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-200 ease-in-out"
        style={{
          gridTemplateRows: isOpen ? '1fr' : '0fr',
          opacity: isOpen ? 1 : 0,
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-2 pb-2 pt-0.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function GenerateSegmented<T extends string>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string }>;
  'aria-label'?: string;
}) {
  return (
    <CanvasSegmented
      value={value}
      onChange={onChange}
      options={options}
      ariaLabel={ariaLabel}
      size="sm"
    />
  );
}
