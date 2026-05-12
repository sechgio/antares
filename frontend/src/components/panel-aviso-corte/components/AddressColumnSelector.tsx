import { ARIA_LABELS } from '../constants';

interface Props {
  value: string;
  columns: string[];
  onChange: (col: string) => void;
}

export default function AddressColumnSelector({ value, columns, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-[var(--text-secondary)]">Columna de dirección (caption)</label>
      <select
        aria-label={ARIA_LABELS.addressColumn}
        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">(Sin columna — usar texto por defecto)</option>
        {columns.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
    </div>
  );
}
