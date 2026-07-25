import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function SignatureSection({ layer, onChange, setMeta }: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Firma" />
      <input
        className="canvas-input mb-2 uppercase"
        placeholder="Clave nombre"
        value={layer.meta?.key || ''}
        onChange={(e) => setMeta({ key: e.target.value.toUpperCase() })}
      />
      <input
        className="canvas-input"
        placeholder="Texto placeholder"
        value={layer.value}
        onChange={(e) => onChange({ ...layer, value: e.target.value })}
      />
    </div>
  );
}
