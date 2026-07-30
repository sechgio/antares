import { clampGridDim } from '../../../ops/gridLayout';
import { NumField, SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function GridSection({ layer, setMetaLive, onCommitLive }: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Cuadrícula" />
      <div className="flex gap-2">
        <NumField
          label="Cols"
          value={layer.meta?.cols ?? 2}
          onChange={(n) => setMetaLive({ cols: clampGridDim(n) })}
          onCommit={onCommitLive}
        />
        <NumField
          label="Rows"
          value={layer.meta?.rows ?? 2}
          onChange={(n) => setMetaLive({ rows: clampGridDim(n) })}
          onCommit={onCommitLive}
        />
      </div>
      <div className="mt-2">
        <NumField
          label="Gap"
          value={layer.meta?.gapMm ?? 2}
          onChange={(n) => setMetaLive({ gapMm: Math.max(0, Math.min(n, 50)) })}
          onCommit={onCommitLive}
          suffix="mm"
        />
      </div>
    </div>
  );
}
