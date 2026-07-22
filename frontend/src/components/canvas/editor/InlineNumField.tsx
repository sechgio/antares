interface InlineNumFieldProps {
  prefix: string;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
  step?: number;
  title?: string;
}

export default function InlineNumField({
  prefix,
  value,
  onChange,
  suffix,
  step = 0.5,
  title,
}: InlineNumFieldProps) {
  return (
    <label className="canvas-inline-field" title={title}>
      <span className="canvas-inline-field-prefix">{prefix}</span>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? Math.round(value * 10) / 10 : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        aria-label={title || prefix}
      />
      {suffix ? <span className="canvas-inline-field-suffix">{suffix}</span> : null}
    </label>
  );
}
