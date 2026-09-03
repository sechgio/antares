import { useEffect, useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { clampOpacity, normalizeHex } from '../../ops/layerStyle';

export function NumField({
  label,
  value,
  onChange,
  onCommit,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  onCommit?: () => void;
  suffix?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '0';
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="canvas-label !mb-0">{label}</span>
      <div className="relative">
        <input
          type="number"
          step={0.5}
          className="canvas-input pr-6"
          value={draft ?? display}
          onFocus={() => setDraft(display)}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const n = Number(raw);
            if (raw !== '' && Number.isFinite(n)) onChange(n);
          }}
          onBlur={() => {
            setDraft(null);
            onCommit?.();
          }}
        />
        {suffix && (
          <span
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px]"
            style={{ color: 'var(--cv-text-muted)' }}
          >
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

export function HexField({
  color,
  ariaLabel,
  onCommit,
}: {
  color: string;
  ariaLabel: string;
  onCommit: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(color.replace('#', ''));
  const canonical = normalizeHex(color);
  useEffect(() => {
    setDraft(canonical.replace('#', ''));
  }, [canonical]);
  return (
    <input
      className="canvas-input flex-1 uppercase"
      aria-label={ariaLabel}
      value={draft}
      onChange={(e) => {
        const raw = e.target.value.replace('#', '').slice(0, 6);
        if (!/^[0-9a-fA-F]*$/i.test(raw)) return;
        setDraft(raw);
        if (raw.length === 6) onCommit(`#${raw.toUpperCase()}`);
      }}
      onBlur={() => {
        if (/^[0-9a-fA-F]{6}$/i.test(draft)) onCommit(`#${draft.toUpperCase()}`);
        else setDraft(color.replace('#', ''));
      }}
    />
  );
}

export function BulkOpacityField({
  value,
  onCommit,
  selectionKey,
}: {
  value: number | null | undefined;
  onCommit: (opacity: number) => void;
  selectionKey: string;
}) {
  const fallback = value === undefined ? 100 : value;
  const display = value === null ? '' : String(fallback);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    setDraft(null);
  }, [selectionKey]);
  const shown = draft ?? display;
  return (
    <label className="mt-2 flex min-w-0 flex-col gap-0.5">
      <span className="canvas-label !mb-0">Opacidad</span>
      <input
        type="number"
        min={0}
        max={100}
        className="canvas-input"
        value={shown}
        placeholder={value === null ? '—' : undefined}
        aria-label="Opacidad múltiple"
        onFocus={() => setDraft(display)}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
        }}
        onBlur={(e) => {
          setDraft(null);
          const n = clampOpacity(Number(e.target.value) || 0);
          onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function ZOrderButtons({
  onBringFront,
  onBringForward,
  onSendBackward,
  onSendBack,
}: {
  onBringFront: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onSendBack: () => void;
}) {
  return (
    <>
      <WithHoverTooltip label="Al frente" placement="bottom" variant="dark">
        <button type="button" className="canvas-icon-btn" aria-label="Al frente" onClick={onBringFront}>
          <ArrowUpToLine className="h-3.5 w-3.5" />
        </button>
      </WithHoverTooltip>
      <WithHoverTooltip label="Adelante" placement="bottom" variant="dark">
        <button type="button" className="canvas-icon-btn" aria-label="Adelante" onClick={onBringForward}>
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      </WithHoverTooltip>
      <WithHoverTooltip label="Atrás" placement="bottom" variant="dark">
        <button type="button" className="canvas-icon-btn" aria-label="Atrás" onClick={onSendBackward}>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </WithHoverTooltip>
      <WithHoverTooltip label="Al fondo" placement="bottom" variant="dark">
        <button type="button" className="canvas-icon-btn" aria-label="Al fondo" onClick={onSendBack}>
          <ArrowDownToLine className="h-3.5 w-3.5" />
        </button>
      </WithHoverTooltip>
    </>
  );
}

export function SectionHeader({
  title,
  children,
}: {
  title: string;
  children?: import('react').ReactNode;
}) {
  return (
    <div className="canvas-section-header">
      <div className="canvas-section-title">{title}</div>
      {children ? <div className="canvas-section-header-actions">{children}</div> : null}
    </div>
  );
}

export const ALIGN_ITEMS = [
  { align: 'left' as const, icon: AlignStartVertical, label: 'Izquierda' },
  { align: 'center' as const, icon: AlignCenterVertical, label: 'Centro' },
  { align: 'right' as const, icon: AlignEndVertical, label: 'Derecha' },
  { align: 'top' as const, icon: AlignStartHorizontal, label: 'Arriba' },
  { align: 'middle' as const, icon: AlignCenterHorizontal, label: 'Medio' },
  { align: 'bottom' as const, icon: AlignEndHorizontal, label: 'Abajo' },
];
