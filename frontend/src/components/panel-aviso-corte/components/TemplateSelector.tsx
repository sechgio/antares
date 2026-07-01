import { ARIA_LABELS, PANEL_TEMPLATE_OPTIONS, type PanelTemplateId } from '../constants';

interface Props {
  value: PanelTemplateId;
  onChange: (id: PanelTemplateId) => void;
}

export default function TemplateSelector({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-[var(--text-secondary)]">Plantilla</label>
      <select
        aria-label={ARIA_LABELS.templateSelector}
        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
        value={value}
        onChange={(e) => onChange(e.target.value as PanelTemplateId)}
      >
        {PANEL_TEMPLATE_OPTIONS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}