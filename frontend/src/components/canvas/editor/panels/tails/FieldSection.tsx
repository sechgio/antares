import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { DEFAULT_FIELD_KEYS } from '../../../constants';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function FieldSection({ layer, onChange, emitLive, onCommitLive }: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Campo Excel" />
      <p className="mb-2 text-[11px] leading-snug" style={{ color: 'var(--cv-text-muted)' }}>
        La clave se mapea a una columna en <strong>Generar</strong>. En el lienzo se previsualiza el
        fallback (o{' '}
        <code className="canvas-inline-code">{`{{ ${layer.meta?.key || 'CLAVE'} }}`}</code> si está
        vacío). Doble clic enfoca la clave.
      </p>
      <div className="mb-2 flex flex-wrap gap-1">
        {DEFAULT_FIELD_KEYS.map((f) => {
          const active = (layer.meta?.key || '') === f.key;
          return (
            <WithHoverTooltip key={f.key} label={f.label} shortcut={f.key} placement="top" variant="dark">
              <button
                type="button"
                className="canvas-chip"
                data-active={active}
                aria-label={`${f.label} (${f.key})`}
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
      <label className="mb-2 block">
        <span className="canvas-label">Clave</span>
        <input
          data-testid="canvas-field-key-input"
          className="canvas-input uppercase"
          placeholder="ej. NIS, DIRECCION"
          value={layer.meta?.key || ''}
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
      </label>
      <label className="block">
        <span className="canvas-label">Si vacío mostrar</span>
        <input
          data-testid="canvas-field-fallback-input"
          className="canvas-input"
          placeholder="-"
          value={layer.meta?.fallback ?? '-'}
          onChange={(e) => emitLive({ ...layer, meta: { ...layer.meta, fallback: e.target.value } })}
          onBlur={() => onCommitLive?.()}
        />
      </label>
    </div>
  );
}
