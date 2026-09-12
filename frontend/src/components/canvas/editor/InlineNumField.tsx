import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { evalNumericExpression } from '../ops/numField';
import { createPointerGestureSession } from '../ops/pointerGestureSession';

interface InlineNumFieldProps {
  prefix: string;
  value: number;
  onChange: (n: number) => void;
  onCommit?: () => void;
  suffix?: string;
  step?: number;
  title?: string;
  mixed?: boolean;
}

export default function InlineNumField({
  prefix,
  value,
  onChange,
  onCommit,
  suffix,
  step = 0.5,
  title,
  mixed = false,
}: InlineNumFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const originRef = useRef(value);
  const display = Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0';
  const shown = draft ?? (mixed ? '' : display);

  const commitDraft = (raw: string | null, revert: boolean) => {
    if (revert) {
      if (!mixed) onChange(originRef.current);
      setDraft(null);
      return;
    }
    if (raw !== null) {
      const evaluated = evalNumericExpression(raw);
      if (evaluated != null) onChange(evaluated);
    }
    setDraft(null);
    onCommit?.();
  };

  const onScrubStart = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const drafted = draft != null ? evalNumericExpression(draft) : null;
    const origin = drafted ?? (Number.isFinite(value) ? value : 0);
    const startX = e.clientX;
    let last = origin;
    createPointerGestureSession({
      onMove: (ev) => {
        const mult = ev.shiftKey ? 10 : 1;
        const next = Math.round((origin + (ev.clientX - startX) * step * mult) * 1000) / 1000;
        if (next === last) return;
        last = next;
        setDraft(String(next));
        onChange(next);
      },
      onEnd: () => {
        setDraft(null);
        onCommit?.();
      },
      onAbort: () => {
        setDraft(null);
        if (!mixed) onChange(origin);
      },
    });
  };

  return (
    <label className="canvas-inline-field" title={title} data-mixed={mixed || undefined}>
      {prefix ? (
        <span
          className="canvas-inline-field-prefix"
          onPointerDown={onScrubStart}
          style={{ cursor: 'ew-resize', userSelect: 'none', touchAction: 'none' }}
          role="presentation"
        >
          {prefix}
        </span>
      ) : null}
      <input
        type="text"
        inputMode="decimal"
        step={step}
        value={shown}
        placeholder={mixed ? 'Varios' : undefined}
        onFocus={() => {
          originRef.current = value;
          setDraft(mixed ? '' : display);
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          if (mixed) return;
          const n = Number(raw);
          if (raw !== '' && Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => commitDraft(draft, false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            commitDraft(null, true);
            e.currentTarget.blur();
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const current = evalNumericExpression(draft ?? (mixed ? '' : display));
            const base = current ?? originRef.current;
            const next = Math.round((base + (e.key === 'ArrowUp' ? step : -step)) * 1000) / 1000;
            setDraft(String(next));
            if (!mixed) onChange(next);
          }
        }}
        aria-label={title || prefix}
      />
      {suffix ? <span className="canvas-inline-field-suffix">{suffix}</span> : null}
    </label>
  );
}
