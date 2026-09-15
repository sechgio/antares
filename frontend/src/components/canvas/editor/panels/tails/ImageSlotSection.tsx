import { Calendar, FileText, MapPin } from 'lucide-react';
import { CanvasToggleRow } from '../../CanvasControls';
import InlineNumField from '../../InlineNumField';
import { ImageObjectControls, PropRow, SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function ImageSlotSection({
  layer,
  setVar,
  setVarLive,
  setMeta,
  setMetaLive,
  onCommitLive,
}: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Slot de foto" />
      <div className="canvas-inspector-stack">
        <PropRow label="Índice">
          <InlineNumField
            prefix=""
            value={layer.meta?.index ?? 0}
            title="Índice"
            onChange={(n) => setMetaLive({ index: Math.max(0, Math.floor(n)) })}
            onCommit={onCommitLive}
          />
        </PropRow>
        <ImageObjectControls
          layer={layer}
          setVar={setVar}
          setVarLive={setVarLive}
          onCommitLive={onCommitLive}
          ariaPrefix="foto"
        />
        <div className="canvas-toggle-list">
          <CanvasToggleRow
            checked={!!layer.meta?.showDate}
            onChange={(v) => setMeta({ showDate: v })}
            label="Mostrar fecha"
            icon={<Calendar className="h-3 w-3 canvas-toggle-row-icon" aria-hidden />}
          />
          <CanvasToggleRow
            checked={!!layer.meta?.showCoords}
            onChange={(v) => setMeta({ showCoords: v })}
            label="Mostrar coords"
            icon={<MapPin className="h-3 w-3 canvas-toggle-row-icon" aria-hidden />}
          />
          <CanvasToggleRow
            checked={!!layer.meta?.showFilename}
            onChange={(v) => setMeta({ showFilename: v })}
            label="Mostrar nombre archivo"
            icon={<FileText className="h-3 w-3 canvas-toggle-row-icon" aria-hidden />}
          />
        </div>
      </div>
    </div>
  );
}
