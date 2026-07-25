import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
}: StepProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const done = status === 'done';

  // Measure the content height in a layout effect (after DOM commit) instead
  // of reading scrollHeight during render, which races with Strict Mode / SSR
  // and returns null on first paint. Re-measure when content or open state changes.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const el = contentRef.current;
    if (!el) return;
    setContentHeight(el.scrollHeight);
  }, [isOpen, children]);

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
        {badge && <span className="ml-auto mr-1">{badge}</span>}
        <ChevronDown
          size={12}
          className={`ml-auto shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-0' : '-rotate-90'}`}
          style={{ color: 'var(--cv-text-muted)' }}
        />
      </button>
      <div
        ref={contentRef}
        className="overflow-hidden transition-all duration-200 ease-in-out"
        style={{
          maxHeight: isOpen ? `${contentHeight ?? 800}px` : '0px',
          opacity: isOpen ? 1 : 0,
        }}
      >
        <div className="px-2 pb-2 pt-0.5">{children}</div>
      </div>
    </div>
  );
}

/**
 * Thin wrapper around `CanvasSegmented` (compact `sm` size) for the Generate
 * wizard. Kept as a named export so existing imports keep working; new code
 * should use `CanvasSegmented` directly with `size="sm"`.
 */
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
