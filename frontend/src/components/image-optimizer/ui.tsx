import React, { useId, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../../i18n';
import { ImageItem } from './types';
import { formatBytes } from '../../utils/format';
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover';
import Button from '@/components/ui/Button';

export const glassPanelClass = 'rounded-xl bg-[var(--bg-surface)]';

export const previewStageShellClass = 'rounded-xl bg-[var(--bg-surface)]';

const pressable =
  'active:scale-[0.96] transition-transform duration-100 ease-out motion-reduce:transition-none motion-reduce:active:scale-100';

type ThemeSelectOption = { value: string; label: string };

const MENU_ROW_H = 32;
const MENU_PAD_Y = 8;

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
  const listId = useId();
  const selected = options.find((o) => o.value === value) ?? options[0];
  const contentHeight = options.length * MENU_ROW_H + MENU_PAD_Y;

  const {
    isOpen: open,
    position: menuBox,
    triggerRef,
    popupRef: menuRef,
    close,
    toggle,
  } = useAnchoredPopover({
    estimatedHeight: contentHeight,
    matchTriggerWidth: true,
    gap: 4,
    maxHeightCap: contentHeight,
    minHeight: MENU_ROW_H + MENU_PAD_Y,
    lockSize: true,
  });

  return (
    <>
      <Button variant="none" size="none"
        ref={triggerRef}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={toggle}
        className={`flex h-9 w-full items-center gap-2 rounded-lg border bg-[var(--bg-input)] px-3 text-left text-[13px] text-[var(--text-primary)] outline-none transition-[border-color] duration-150 focus-visible:border-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-40 ${open ? 'border-[var(--accent-primary)]' : 'border-transparent'}`}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? '—'}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-[var(--text-secondary)] transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </Button>
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
            height: menuBox.maxHeight,
          }}
          className="fixed z-[200] box-border overflow-y-auto overscroll-contain rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] py-1 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.45)] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <Button variant="none" size="none"
                key={opt.value}
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  close();
                }}
                className={`flex h-8 w-full shrink-0 items-center gap-2 px-3 text-left text-[13px] transition-colors ${
                  active
                    ? 'bg-[var(--bg-input)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                <Check
                  size={12}
                  strokeWidth={2.5}
                  className={`shrink-0 text-[var(--accent-primary)] ${active ? 'opacity-100' : 'opacity-0'}`}
                  aria-hidden
                />
              </Button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

export function ProgressBar({ current, total }: { current: number; total: number }) {
  const percentage = total > 0 ? (current / total) * 100 : 0;
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--bg-input)]">
      <div
        className="h-full rounded-full bg-[var(--accent-primary)] transition-[width] duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export { SegmentedControl } from '@/components/ui/SegmentedControl';

export function BeforeAfterSlider({ before, after, alt }: { before: string; after: string; alt: string }) {
  const { t } = useTranslation();
  const [position, setPosition] = useState(50);
  return (
    <div className="flex h-full max-h-full w-full max-w-full flex-col gap-3">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg">
        <img src={before} alt={`${alt} ${t('optimizer.preview.original')}`} className="absolute inset-0 h-full w-full object-contain" />
        <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${position}%` }}>
          <img src={after} alt={`${alt} ${t('optimizer.preview.result')}`} className="h-full w-full object-contain" />
        </div>
        <div className="absolute inset-y-0" style={{ left: `calc(${position}% - 0.5px)` }}>
          <div className="h-full w-px bg-[color:color-mix(in_srgb,var(--text-primary)_70%,transparent)]" />
        </div>
        <div className="absolute left-3 top-3 rounded-md bg-[color:color-mix(in_srgb,var(--bg-base)_80%,transparent)] px-2 py-1 text-[12px] text-[var(--text-primary)]">
          {t('optimizer.preview.original')}
        </div>
        <div className="absolute right-3 top-3 rounded-md bg-[color:color-mix(in_srgb,var(--bg-base)_80%,transparent)] px-2 py-1 text-[12px] text-[var(--text-primary)]">
          {t('optimizer.preview.result')}
        </div>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={position}
        onChange={(e) => setPosition(Number(e.target.value))}
        className="w-full shrink-0 accent-[var(--accent-primary)]"
        aria-label={t('optimizer.preview.compare')}
      />
    </div>
  );
}

export function ItemSummary({ item }: { item: ImageItem }) {
  const { t } = useTranslation();
  const reduction = item.resultSize && item.originalSize > 0
    ? Math.max(0, ((item.originalSize - item.resultSize) / item.originalSize) * 100)
    : 0;

  const statusLabel = useMemo(() => {
    if (item.excluded) return t('optimizer.status.excluded');
    if (item.status === 'processing') return t('optimizer.status.processing');
    if (item.status === 'error') return t('optimizer.status.error');
    if (item.stale) return t('optimizer.status.stale');
    if (item.status === 'completed') return t('optimizer.status.completed');
    return t('optimizer.status.pending');
  }, [item, t]);

  const weightValue = item.resultSize
    ? `${formatBytes(item.originalSize)} / ${formatBytes(item.resultSize)}`
    : formatBytes(item.originalSize);

  const dimensionsValue = item.sourceWidth && item.sourceHeight
    ? item.finalWidth && item.finalHeight
      ? `${item.sourceWidth}×${item.sourceHeight} / ${item.finalWidth}×${item.finalHeight}`
      : `${item.sourceWidth}×${item.sourceHeight}`
    : t('optimizer.stats.noData');

  const savingsValue = item.resultSize ? `${reduction.toFixed(1)}%` : '—';

  const stats = [
    { label: t('optimizer.stats.status'), value: statusLabel },
    { label: t('optimizer.stats.size'), value: weightValue },
    { label: t('optimizer.stats.dimensions'), value: dimensionsValue },
    { label: t('optimizer.stats.savings'), value: savingsValue },
  ];

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0">
          <p className="text-[12px] text-[var(--text-secondary)]">{stat.label}</p>
          <p className="mt-0.5 truncate font-mono text-[13px] tabular-nums text-[var(--text-primary)]" title={String(stat.value)}>
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}

const formControlClassName =
  'w-full h-9 rounded-lg border border-transparent bg-[var(--bg-input)] px-3 text-[13px] text-[var(--text-primary)] outline-none transition-[border-color] duration-150 placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)]';

export function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block space-y-1.5">
      <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
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
    <Button variant="none" size="none"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors duration-150 ease-out ${pressable}`}
      style={checked ? { backgroundColor: accentColor } : { backgroundColor: 'var(--border-medium)' }}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
      />
    </Button>
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
    <div className="flex items-center gap-2.5">
      <label
        htmlFor={switchId}
        className={`cursor-pointer text-[13px] ${labelClassName ?? 'text-[var(--text-secondary)]'}`}
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
  enabled,
  onToggle,
  disabled,
  children,
}: {
  title: string;
  enabled: boolean;
  onToggle?: (value: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const isCollapsible = !!onToggle;
  const isOpen = !isCollapsible || enabled;

  const headerContent = (
    <>
      <span className={`flex-1 text-[14px] font-medium transition-colors duration-150 ${enabled ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
        {title}
      </span>
      {isCollapsible && (
        <span
          className="relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors duration-150"
          style={{ backgroundColor: enabled ? 'var(--accent-primary)' : 'var(--border-medium)' }}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`}
          />
        </span>
      )}
    </>
  );

  return (
    <div
      className={`relative shrink-0 border-b border-[var(--border-subtle)] py-4 transition-opacity duration-150 last:border-b-0 ${disabled ? 'pointer-events-none opacity-45' : ''}`}
    >
      {isCollapsible ? (
        <Button variant="none" size="none"
          onClick={() => onToggle?.(!enabled)}
          className="flex w-full items-center gap-3 text-left"
        >
          {headerContent}
        </Button>
      ) : (
        <div className="flex w-full items-center gap-3">
          {headerContent}
        </div>
      )}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-3 pt-3">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PillPreset({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="none" size="none"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-8 shrink-0 items-center rounded-lg px-3.5 text-[13px] transition-[color,background-color,transform] duration-150 ${pressable} ${active
        ? 'bg-[var(--bg-input)] font-medium text-[var(--text-primary)]'
        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
    >
      {label}
    </Button>
  );
}
