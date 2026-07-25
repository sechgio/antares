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
          onChange={(n) => setMetaLive({ cols: Math.max(1, Math.floor(n)) })}
          onCommit={onCommitLive}
        />
        <NumField
          label="Rows"
          value={layer.meta?.rows ?? 2}
          onChange={(n) => setMetaLive({ rows: Math.max(1, Math.floor(n)) })}
          onCommit={onCommitLive}
        />
      </div>
      <div className="mt-2">
        <NumField
          label="Gap"
          value={layer.meta?.gapMm ?? 2}
          onChange={(n) => setMetaLive({ gapMm: Math.max(0, n) })}
          onCommit={onCommitLive}
          suffix="mm"
        />
      </div>
    </div>
  );
}
