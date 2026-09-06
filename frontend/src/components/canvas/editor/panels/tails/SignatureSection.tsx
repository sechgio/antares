import { PropRow, SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function SignatureSection({ layer, onChange, setMeta }: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Firma" />
      <div className="canvas-inspector-stack">
        <PropRow label="Clave">
          <input
            className="canvas-input uppercase"
            placeholder="Clave nombre"
            value={layer.meta?.key || ''}
            onChange={(e) => setMeta({ key: e.target.value.toUpperCase() })}
          />
        </PropRow>
        <PropRow label="Texto">
          <input
            className="canvas-input"
            placeholder="Texto placeholder"
            value={layer.value}
            onChange={(e) => onChange({ ...layer, value: e.target.value })}
          />
        </PropRow>
      </div>
    </div>
  );
}
