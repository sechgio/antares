import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';
import { ImageItem, Toast } from './types';
import { formatBytes } from './utils';

export function ToastContainer({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: string) => void }) {
  return (
    <div className="fixed right-4 top-20 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-2 rounded-[20px] border px-4 py-3 shadow-lg backdrop-blur-xl ${toast.type === 'error'
            ? 'border-red-500/20 bg-red-950/90 text-red-300'
            : toast.type === 'success'
              ? 'border-emerald-500/20 bg-emerald-950/90 text-emerald-300'
              : 'border-[var(--border-medium)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
            }`}
        >
          {toast.type === 'error' && <AlertCircle size={16} />}
          {toast.type === 'success' && <CheckCircle size={16} />}
          {toast.type === 'info' && <Info size={16} />}
          <span className="flex-1 text-sm font-mono leading-snug">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)]"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({ current, total }: { current: number; total: number }) {
  const percentage = total > 0 ? (current / total) * 100 : 0;
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--bg-input)]">
      <div
        className="h-full bg-[var(--accent-primary)] shadow-[0_0_10px_rgba(94,106,210,0.5)] transition-all duration-250"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-[20px] border border-[var(--border-medium)] bg-[var(--bg-elevated)] p-1 shadow-inner backdrop-blur-sm">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-[16px] px-4 py-2 text-[10px] font-mono uppercase tracking-[0.2em] transition-all hover:bg-[var(--bg-surface)] ${value === option.value ? 'bg-[var(--text-primary)] font-semibold text-[var(--bg-base)] hover:bg-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function BeforeAfterSlider({ before, after, alt }: { before: string; after: string; alt: string }) {
  const [position, setPosition] = useState(50);
  return (
    <div className="flex h-full max-h-full w-full max-w-full flex-col gap-2">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <img src={before} alt={`${alt} original`} className="absolute inset-0 h-full w-full object-contain" />
        <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${position}%` }}>
          <img src={after} alt={`${alt} resultado`} className="h-full w-full object-contain" />
        </div>
        <div className="absolute inset-y-0" style={{ left: `calc(${position}% - 1px)` }}>
          <div className="h-full w-0.5 bg-[var(--accent-primary)] shadow-[0_0_12px_rgba(94,106,210,0.8)]" />
        </div>
        <div className="absolute left-3 top-3 rounded-md bg-[var(--bg-surface)]/80 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-primary)] backdrop-blur-md">
          Original
        </div>
        <div className="absolute right-3 top-3 rounded-md bg-[var(--bg-surface)]/80 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--accent-primary)] backdrop-blur-md">
          Resultado
        </div>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={position}
        onChange={(e) => setPosition(Number(e.target.value))}
        className="w-full shrink-0 accent-[var(--text-primary)]"
        aria-label="Comparar antes y despues"
      />
    </div>
  );
}

export function ItemSummary({ item }: { item: ImageItem }) {
  const reduction = item.resultSize && item.originalSize > 0
    ? Math.max(0, ((item.originalSize - item.resultSize) / item.originalSize) * 100)
    : 0;

  const statusLabel = useMemo(() => {
    if (item.excluded) return 'Excluida';
    if (item.status === 'processing') return 'Procesando';
    if (item.status === 'error') return 'Error';
    if (item.stale) return 'Stale';
    if (item.status === 'completed') return 'Lista';
    return 'Pendiente';
  }, [item]);

  const weightValue = item.resultSize
    ? `${formatBytes(item.originalSize)} / ${formatBytes(item.resultSize)}`
    : formatBytes(item.originalSize);

  const dimensionsValue = item.sourceWidth && item.sourceHeight
    ? item.finalWidth && item.finalHeight
      ? `${item.sourceWidth}x${item.sourceHeight} / ${item.finalWidth}x${item.finalHeight}`
      : `${item.sourceWidth}x${item.sourceHeight}`
    : 'Sin datos';

  const savingsValue = item.resultSize ? `${reduction.toFixed(1)}%` : '--';

  const stats = [
    { label: 'Estado', value: statusLabel },
    { label: 'Peso', value: weightValue },
    { label: 'Dimensiones', value: dimensionsValue },
    { label: 'Ahorro', value: savingsValue },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 py-2 sm:grid-cols-4 sm:gap-x-0 sm:divide-x sm:divide-[var(--border-medium)]/30">
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0 sm:px-4 first:sm:pl-0 last:sm:pr-0">
          <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-muted)]/60">{stat.label}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-primary)]" title={String(stat.value)}>
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}

const formControlClassName =
  'w-full rounded-md border-0 border-b border-[var(--border-medium)]/50 bg-transparent px-0 py-1.5 text-[11px] font-mono text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)]/40 focus:border-[var(--accent-primary)]/60';

export function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block space-y-1">
      <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-muted)]/60">{label}</span>
      {children}
    </div>
  );
}

export function SettingSwitch({
  checked,
  onChange,
  accentColor = 'var(--accent-primary)',
  id,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  accentColor?: string;
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-200"
      style={checked ? { backgroundColor: accentColor } : { backgroundColor: 'var(--border-medium)' }}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full shadow-sm transition duration-200 ${checked ? 'translate-x-3 bg-white' : 'translate-x-0.5 bg-[var(--text-muted)]'}`}
      />
    </button>
  );
}

export function SettingSwitchRow({
  label,
  labelClassName,
  checked,
  onChange,
  accentColor,
  switchId,
}: {
  label: string;
  labelClassName?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  accentColor?: string;
  switchId: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <label
        htmlFor={switchId}
        className={`cursor-pointer text-[10px] font-mono uppercase tracking-[0.1em] ${labelClassName ?? 'text-[var(--text-muted)]/80'}`}
      >
        {label}
      </label>
      <SettingSwitch
        id={switchId}
        checked={checked}
        onChange={onChange}
        accentColor={accentColor}
        aria-label={label}
      />
    </div>
  );
}

export { formControlClassName };

export function OperationSection({
  title,
  icon,
  accentColor,
  enabled,
  onToggle,
  disabled,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  accentColor: string;
  enabled: boolean;
  onToggle?: (value: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const isCollapsible = !!onToggle;
  const isOpen = !isCollapsible || enabled;

  const headerContent = (
    <>
      <span style={{ color: enabled ? accentColor : 'var(--text-muted)' }} className="shrink-0 transition-colors duration-200">
        {icon}
      </span>
      <span className="flex-1 text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--text-primary)]">
        {title}
      </span>
      {isCollapsible && (
        <span
          className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200"
          style={enabled ? { backgroundColor: accentColor } : { backgroundColor: 'var(--bg-input)' }}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition duration-200 ${enabled ? 'translate-x-4' : 'translate-x-0'}`}
          />
        </span>
      )}
    </>
  );

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-[14px] border border-[var(--border-medium)] bg-[var(--bg-surface)] transition-all duration-200 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}
      style={{ borderLeftColor: enabled ? accentColor : 'var(--border-medium)', borderLeftWidth: '3px' }}
    >
      {isCollapsible ? (
        <button
          type="button"
          onClick={() => onToggle?.(!enabled)}
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
        >
          {headerContent}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2.5 px-4 py-3">
          {headerContent}
        </div>
      )}
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <div className="px-4 pb-4 pt-1 space-y-3">
          {children}
        </div>
      </div>
    </div>
  );
}

export function ModeToggle({
  label,
  enabled,
  onChange,
  activeClassName,
}: {
  label: string;
  enabled: boolean;
  onChange: (value: boolean) => void;
  activeClassName?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      aria-pressed={enabled}
      className={`flex shrink-0 items-center rounded-full px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.12em] transition-all duration-150 border ${enabled
        ? activeClassName ?? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
        : 'border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)]'
        }`}
    >
      {label}
    </button>
  );
}

export function PillPreset({
  label,
  accentClassName,
  active,
  onClick,
}: {
  label: string;
  accentClassName: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center rounded-full px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.12em] transition-all duration-150 border ${active
        ? accentClassName
        : 'border-[var(--border-medium)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)]'
        }`}
    >
      {label}
    </button>
  );
}
