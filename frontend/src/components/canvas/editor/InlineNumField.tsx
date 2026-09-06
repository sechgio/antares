import { useRef, useState } from 'react';

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
      const n = Number(raw);
      if (raw !== '' && Number.isFinite(n)) onChange(n);
    }
    setDraft(null);
    onCommit?.();
  };

  return (
    <label className="canvas-inline-field" title={title} data-mixed={mixed || undefined}>
      {prefix ? <span className="canvas-inline-field-prefix">{prefix}</span> : null}
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
            const current = Number(draft ?? (mixed ? '' : display));
            const base = Number.isFinite(current) ? current : originRef.current;
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
