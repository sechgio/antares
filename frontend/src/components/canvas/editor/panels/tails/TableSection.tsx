import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function TableSection({ layer, setMeta }: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Tabla (JSON)" />
      <textarea
        className="canvas-input !h-auto py-1.5 font-mono text-[10px]"
        rows={6}
        value={layer.meta?.rowsData || ''}
        onChange={(e) => setMeta({ rowsData: e.target.value })}
      />
    </div>
  );
}
