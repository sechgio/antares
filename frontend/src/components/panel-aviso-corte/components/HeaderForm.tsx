import DatePicker from '../../ui/DatePicker';
import { ARIA_LABELS } from '../constants';
import type { HeaderFormState } from '../types';

interface Props {
  value: HeaderFormState;
  onChange: (v: HeaderFormState) => void;
  disabled?: boolean;
}

export default function HeaderForm({ value, onChange, disabled }: Props) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">Cuadrante *</label>
        <input
          aria-label={ARIA_LABELS.cuadranteInput}
          type="text"
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] disabled:opacity-50"
          value={value.cuadrante}
          onChange={(e) => onChange({ ...value, cuadrante: e.target.value })}
          disabled={disabled}
          placeholder="Ej: Cuadrante 12A"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">Fecha de Corte</label>
        <DatePicker
          aria-label={ARIA_LABELS.fechaInput}
          value={value.fechaCorte}
          onChange={(fechaCorte) => onChange({ ...value, fechaCorte })}
          disabled={disabled}
          size="md"
        />
      </div>
      <div className="flex flex-col gap-1 col-span-2">
        <label className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">Motivo</label>
        <input
          aria-label={ARIA_LABELS.motivoInput}
          type="text"
          className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] disabled:opacity-50"
          value={value.motivo}
          onChange={(e) => onChange({ ...value, motivo: e.target.value })}
          disabled={disabled}
          placeholder="Motivo del corte..."
        />
      </div>
    </div>
  );
}
