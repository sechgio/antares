import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { DEFAULT_FIELD_KEYS } from '../../../constants';
import { PropRow, SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function FieldSection({ layer, onChange, emitLive, onCommitLive }: SectionProps) {
  const fieldKey = layer.meta?.key || '';

  return (
    <div className="canvas-section canvas-field-section">
      <SectionHeader title="Campo Excel" />
      <div className="canvas-field-presets" role="group" aria-label="Campos sugeridos">
        <div className="canvas-field-chips">
          {DEFAULT_FIELD_KEYS.map((f) => {
            const active = fieldKey === f.key;
            return (
              <WithHoverTooltip
                key={f.key}
                label={f.label}
                shortcut={f.key}
                placement="top"
                variant="dark"
              >
                <button
                  type="button"
                  className="canvas-chip canvas-field-chip"
                  data-active={active}
                  aria-pressed={active}
                  aria-label={`${f.label} (${f.key})`}
                  title={`Usar ${f.label}`}
                  onClick={() =>
                    onChange({
                      ...layer,
                      name: f.label,
                      meta: { ...layer.meta, key: f.key },
                    })
                  }
                >
                  {f.key}
                </button>
              </WithHoverTooltip>
            );
          })}
        </div>
      </div>
      <div className="canvas-field-controls canvas-inspector-stack">
        <PropRow label="Clave">
          <input
            data-testid="canvas-field-key-input"
            className="canvas-input uppercase"
            placeholder="NIS, DIRECCION"
            value={fieldKey}
            spellCheck={false}
            onChange={(e) => {
              const key = e.target.value.toUpperCase().replace(/\s+/g, '_');
              emitLive({
                ...layer,
                meta: { ...layer.meta, key },
                name: key || layer.name,
              });
            }}
            onBlur={() => onCommitLive?.()}
          />
        </PropRow>
        <PropRow label="Vacío">
          <input
            data-testid="canvas-field-fallback-input"
            className="canvas-input"
            placeholder="-"
            value={layer.meta?.fallback ?? '-'}
            onChange={(e) => emitLive({ ...layer, meta: { ...layer.meta, fallback: e.target.value } })}
            onBlur={() => onCommitLive?.()}
          />
        </PropRow>
      </div>
    </div>
  );
}
