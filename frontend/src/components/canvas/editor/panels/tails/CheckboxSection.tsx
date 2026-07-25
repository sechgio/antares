import { CanvasCheckbox } from '../../CanvasControls';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function CheckboxSection({ layer, setMeta }: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Casilla" />
      <input
        className="canvas-input mb-2 uppercase"
        placeholder="Clave Excel"
        value={layer.meta?.key || ''}
        onChange={(e) => setMeta({ key: e.target.value.toUpperCase() })}
      />
      <div className="flex items-center gap-2">
        <CanvasCheckbox
          checked={!!layer.meta?.checked}
          onChange={(v) => setMeta({ checked: v })}
          label="Marcada (preview)"
        />
      </div>
    </div>
  );
}
