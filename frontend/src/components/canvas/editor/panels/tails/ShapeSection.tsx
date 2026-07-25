import { ZOrderButtons } from '../shared';
import type { SectionProps } from '../types';

/** Name + z-order block for shapes. The non-shape variant is kept inline in the
 *  orchestrator because it uses `emitLive`/`onCommitLive` (live name editing),
 *  while the shape variant commits via `onChange` directly — Cirugía de
 *  Precisión: don't unify the two subtle variants into one component. */
export default function ShapeSection({ layer, onChange, zOrder }: SectionProps) {
  return (
    <div className="canvas-section">
      <label className="block">
        <span className="canvas-label">Nombre</span>
        <input
          className="canvas-input"
          value={layer.name}
          onChange={(e) => onChange({ ...layer, name: e.target.value })}
        />
      </label>
      <div className="mt-2 flex gap-1">
        <ZOrderButtons
          onBringFront={zOrder.onBringFront}
          onBringForward={zOrder.onBringForward}
          onSendBackward={zOrder.onSendBackward}
          onSendBack={zOrder.onSendBack}
        />
      </div>
    </div>
  );
}
