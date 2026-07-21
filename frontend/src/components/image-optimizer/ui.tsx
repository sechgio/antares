import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Check, CheckCircle, ChevronDown, Info, X } from 'lucide-react';
import { ImageItem, Toast } from './types';
import { formatBytes } from './utils';

/** Surfaces use solid theme tokens so text stays readable on any appearance preset. */
export const glassPanelClass =
  'rounded-xl border border-[var(--border-medium)] bg-[var(--bg-surface)]';

export const glassToolbarClass =
  'rounded-xl border border-[var(--border-medium)] bg-[var(--bg-surface)]';

export const previewStageShellClass =
  'rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)]';

const pressable =
  'active:scale-[0.96] transition-transform duration-100 ease-out motion-reduce:transition-none motion-reduce:active:scale-100';

export type ThemeSelectOption = { value: string; label: string };

const MENU_ROW_H = 28;
const MENU_PAD_Y = 8; // py-1

type MenuBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

/** Floating popover — fixed size on open; never clipped by parent overflow. */
export function ThemeSelect({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  disabled,
}: {
  value: string;
  options: ReadonlyArray<ThemeSelectOption>;
  onChange: (value: string) => void;
  'aria-label': string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<MenuBox | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef<{ width: number; height: number } | null>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value) ?? options[0];
  const contentHeight = options.length * MENU_ROW_H + MENU_PAD_Y;

  const close = useCallback(() => {
    setOpen(false);
    setMenuBox(null);
    sizeRef.current = null;
  }, []);

  const placeMenu = useCallback((lockSize: boolean) => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const edge = 8;
    const spaceBelow = window.innerHeight - rect.bottom - gap - edge;
    const spaceAbove = rect.top - gap - edge;
    const openUp = spaceBelow < contentHeight && spaceAbove > spaceBelow;
    const available = openUp ? spaceAbove : spaceBelow;

    let width: number;
    let height: number;
    if (lockSize && sizeRef.current) {
      width = sizeRef.current.width;
      height = sizeRef.current.height;
    } else {
      width = Math.round(rect.width);
      height = Math.min(contentHeight, Math.max(available, MENU_ROW_H + MENU_PAD_Y));
      sizeRef.current = { width, height };
    }

    const top = openUp
      ? Math.max(edge, rect.top - gap - height)
      : rect.bottom + gap;

    setMenuBox({
      top,
      left: Math.round(rect.left),
      width,
      height,
    });
  }, [contentHeight]);

  useEffect(() => {
    if (!open) return;
    placeMenu(false);
    const onReposition = () => placeMenu(true);
    const onPointer = (event: MouseEvent) => {
      const t = event.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('resize', onReposition);
    // Only document/window scroll of ancestors — ignore events from the menu itself
    const onScroll = (event: Event) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) {
        return;
      }
      placeMenu(true);
    };
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, placeMenu, close]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 w-full items-center gap-2 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-input)] px-2.5 text-left text-[11px] font-medium text-[var(--text-primary)] outline-none transition-[border-color] duration-100 hover:border-[var(--accent-primary)]/45 focus:border-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-40 ${open ? 'border-[var(--accent-primary)]' : ''}`}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? '—'}</span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-[var(--text-secondary)] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && menuBox && createPortal(
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            top: menuBox.top,
            left: menuBox.left,
            width: menuBox.width,
            height: menuBox.height,
          }}
          className="fixed z-[200] box-border overflow-y-auto overscroll-contain rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] py-1 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.45)] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  close();
                }}
                className={`flex h-7 w-full shrink-0 items-center gap-2 px-2.5 text-left text-[11px] transition-colors ${
                  active
                    ? 'bg-[var(--bg-input)] font-medium text-[var(--text-primary)]'
                    : 'font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                <Check
                  size={12}
                  strokeWidth={2.5}
                  className={`shrink-0 text-[var(--accent-primary)] ${active ? 'opacity-100' : 'opacity-0'}`}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

export function ToastContainer({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: string) => void }) {
  return (
    <div className="fixed right-4 top-20 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-1.5">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 backdrop-blur-xl ${toast.type === 'error'
            ? 'border-[var(--accent-red)]/25 bg-[var(--accent-red)]/10 text-[var(--accent-red)]'
            : toast.type === 'success'
              ? 'border-[var(--accent-green)]/25 bg-[var(--accent-green)]/10 text-[var(--accent-green)]'
              : 'border-[var(--border-medium)]/50 bg-[var(--bg-elevated)]/95 text-[var(--text-primary)]'
            }`}
        >
          {toast.type === 'error' && <AlertCircle size={14} className="shrink-0" />}
          {toast.type === 'success' && <CheckCircle size={14} className="shrink-0" />}
          {toast.type === 'info' && <Info size={14} className="shrink-0" />}
          <span className="flex-1 text-[12px] leading-snug">{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className={`flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] ${pressable}`}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ProgressBar({ current, total }: { current: number; total: number }) {
  const percentage = total > 0 ? (current / total) * 100 : 0;
  return (
    <div className="h-0.5 w-full overflow-hidden rounded-full bg-[var(--bg-input)]">
      <div
        className="h-full rounded-full bg-[var(--accent-primary)] transition-[width] duration-200 ease-out motion-reduce:transition-none"
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
    <div className="inline-flex w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-input)] p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`h-7 flex-1 rounded-md px-2 text-[10px] font-medium transition-[color,background-color,transform] duration-100 ${pressable} ${value === option.value
            ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
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
    <div className="flex h-full max-h-full w-full max-w-full flex-col gap-1.5">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg">
        <img src={before} alt={`${alt} original`} className="absolute inset-0 h-full w-full object-contain" />
        <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${position}%` }}>
          <img src={after} alt={`${alt} resultado`} className="h-full w-full object-contain" />
        </div>
        <div className="absolute inset-y-0" style={{ left: `calc(${position}% - 0.5px)` }}>
          <div className="h-full w-px bg-[var(--text-primary)]/70" />
        </div>
        <div className="absolute left-2 top-2 rounded-md border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--text-primary)]">
          Original
        </div>
        <div className="absolute right-2 top-2 rounded-md border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--text-primary)]">
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
      ? `${item.sourceWidth}×${item.sourceHeight} / ${item.finalWidth}×${item.finalHeight}`
      : `${item.sourceWidth}×${item.sourceHeight}`
    : 'Sin datos';

  const savingsValue = item.resultSize ? `${reduction.toFixed(1)}%` : '—';

  const stats = [
    { label: 'Estado', value: statusLabel },
    { label: 'Peso', value: weightValue },
    { label: 'Dims', value: dimensionsValue },
    { label: 'Ahorro', value: savingsValue },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 py-1 sm:grid-cols-4 sm:gap-x-0 sm:divide-x sm:divide-[var(--border-medium)]/20">
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0 sm:px-3 first:sm:pl-0 last:sm:pr-0">
          <p className="text-[9px] font-medium text-[var(--text-secondary)]">{stat.label}</p>
          <p className="truncate font-mono text-[10px] tabular-nums text-[var(--text-primary)]" title={String(stat.value)}>
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}

const formControlClassName =
  'w-full h-8 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-input)] px-2.5 text-[11px] font-medium text-[var(--text-primary)] outline-none transition-[border-color] duration-100 placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-primary)]';

export function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block space-y-1">
      <span className="text-[10px] font-medium text-[var(--text-secondary)]">{label}</span>
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
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-150 ease-out ${pressable}`}
      style={checked ? { backgroundColor: accentColor } : { backgroundColor: 'var(--border-medium)' }}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform duration-150 ease-out ${checked ? 'translate-x-3' : 'translate-x-0.5'}`}
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
    <div className="flex items-center gap-2 py-0.5">
      <label
        htmlFor={switchId}
        className={`cursor-pointer text-[10px] font-medium ${labelClassName ?? 'text-[var(--text-secondary)]'}`}
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
      <span style={{ color: enabled ? accentColor : 'var(--text-muted)' }} className="shrink-0 transition-colors duration-150">
        {icon}
      </span>
      <span className="flex-1 text-[11px] font-semibold text-[var(--text-primary)]">
        {title}
      </span>
      {isCollapsible && (
        <span
          className="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-150"
          style={enabled ? { backgroundColor: accentColor } : { backgroundColor: 'var(--bg-input)' }}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform duration-150 ${enabled ? 'translate-x-3' : 'translate-x-0.5'}`}
          />
        </span>
      )}
    </>
  );

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] transition-opacity duration-150 ${disabled ? 'pointer-events-none opacity-45' : ''}`}
      style={{ borderLeftWidth: 3, borderLeftColor: enabled ? accentColor : 'var(--border-medium)' }}
    >
      {isCollapsible ? (
        <button
          type="button"
          onClick={() => onToggle?.(!enabled)}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-input)] ${pressable}`}
        >
          {headerContent}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2 px-3 py-2">
          {headerContent}
        </div>
      )}
      <div
        className={`overflow-hidden transition-[max-height,opacity] duration-150 ease-out motion-reduce:transition-none ${isOpen ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <div className="space-y-2 border-t border-[var(--border-medium)] px-3 pb-3 pt-2">
          {children}
        </div>
      </div>
    </div>
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
      className={`flex h-7 shrink-0 items-center rounded-full border px-2.5 text-[10px] font-medium transition-[color,background-color,border-color,transform] duration-100 ${pressable} ${active
        ? accentClassName
        : 'border-[var(--border-medium)] bg-[var(--bg-input)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
    >
      {label}
    </button>
  );
}
