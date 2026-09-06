import { clampGridDim } from '../../../ops/gridLayout';
import InlineNumField from '../../InlineNumField';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function GridSection({ layer, setMetaLive, onCommitLive }: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Cuadrícula" />
      <div className="canvas-inspector-stack">
        <div className="flex gap-1.5">
          <InlineNumField
            prefix="C"
            value={layer.meta?.cols ?? 2}
            title="Columnas"
            onChange={(n) => setMetaLive({ cols: clampGridDim(n) })}
            onCommit={onCommitLive}
          />
          <InlineNumField
            prefix="R"
            value={layer.meta?.rows ?? 2}
            title="Filas"
            onChange={(n) => setMetaLive({ rows: clampGridDim(n) })}
            onCommit={onCommitLive}
          />
        </div>
        <InlineNumField
          prefix="Gap"
          value={layer.meta?.gapMm ?? 2}
          title="Separación"
          onChange={(n) => setMetaLive({ gapMm: Math.max(0, Math.min(n, 50)) })}
          onCommit={onCommitLive}
          suffix="mm"
        />
      </div>
    </div>
  );
}
