import { useState } from 'react';

interface InlineNumFieldProps {
  prefix: string;
  value: number;
  onChange: (n: number) => void;
  onCommit?: () => void;
  suffix?: string;
  step?: number;
  title?: string;
}

export default function InlineNumField({
  prefix,
  value,
  onChange,
  onCommit,
  suffix,
  step = 0.5,
  title,
}: InlineNumFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0';
  return (
    <label className="canvas-inline-field" title={title}>
      <span className="canvas-inline-field-prefix">{prefix}</span>
      <input
        type="number"
        step={step}
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
        aria-label={title || prefix}
      />
      {suffix ? <span className="canvas-inline-field-suffix">{suffix}</span> : null}
    </label>
  );
}
