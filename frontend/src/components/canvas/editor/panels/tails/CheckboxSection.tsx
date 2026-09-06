import { CanvasCheckbox } from '../../CanvasControls';
import { PropRow, SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function CheckboxSection({ layer, setMeta }: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Casilla" />
      <div className="canvas-inspector-stack">
        <PropRow label="Clave">
          <input
            className="canvas-input uppercase"
            placeholder="Clave Excel"
            value={layer.meta?.key || ''}
            onChange={(e) => setMeta({ key: e.target.value.toUpperCase() })}
          />
        </PropRow>
        <div className="canvas-check-list">
          <CanvasCheckbox
            checked={!!layer.meta?.checked}
            onChange={(v) => setMeta({ checked: v })}
            label="Marcada (preview)"
          />
        </div>
      </div>
    </div>
  );
}
