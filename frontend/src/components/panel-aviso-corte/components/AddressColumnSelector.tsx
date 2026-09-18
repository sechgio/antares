import ThemedSelect from '../../ui/ThemedSelect';
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
      <ThemedSelect
        aria-label={ARIA_LABELS.addressColumn}
        triggerClassName="rounded-lg border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
        value={value}
        onChange={onChange}
        options={[
          { value: '', label: '(Sin columna — usar texto por defecto)' },
          ...columns.map((c) => ({ value: c, label: c })),
        ]}
      />
    </div>
  );
}
