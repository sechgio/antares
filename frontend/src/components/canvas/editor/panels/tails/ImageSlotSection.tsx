import { clampImageZoom, parseImageZoom } from '../../../ops/layerStyle';
import { CanvasCheckbox } from '../../CanvasControls';
import CanvasSelect from '../../CanvasSelect';
import InlineNumField from '../../InlineNumField';
import { IMAGE_FIT_OPTIONS, IMAGE_POSITION_OPTIONS, PropRow, SectionHeader } from '../shared';
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
        <PropRow label="Ajuste">
          <CanvasSelect
            value={layer.cssVars['--object-fit'] || 'cover'}
            aria-label="Ajuste de foto"
            onChange={(val) => setVar('--object-fit', val)}
            options={IMAGE_FIT_OPTIONS}
          />
        </PropRow>
        <PropRow label="Zoom">
          <InlineNumField
            prefix="Z"
            value={parseImageZoom(layer.cssVars)}
            step={0.05}
            title="Zoom de recorte"
            onChange={(n) => setVarLive('--image-zoom', String(clampImageZoom(n)))}
            onCommit={onCommitLive}
          />
        </PropRow>
        <PropRow label="Posición">
          <CanvasSelect
            value={layer.cssVars['--object-position'] || '50% 50%'}
            aria-label="Posición de foto"
            onChange={(val) => setVar('--object-position', val)}
            options={IMAGE_POSITION_OPTIONS}
          />
        </PropRow>
        <div className="canvas-check-list">
          <CanvasCheckbox
            checked={!!layer.meta?.showDate}
            onChange={(v) => setMeta({ showDate: v })}
            label="Mostrar fecha"
          />
          <CanvasCheckbox
            checked={!!layer.meta?.showCoords}
            onChange={(v) => setMeta({ showCoords: v })}
            label="Mostrar coords"
          />
          <CanvasCheckbox
            checked={!!layer.meta?.showFilename}
            onChange={(v) => setMeta({ showFilename: v })}
            label="Mostrar nombre archivo"
          />
        </div>
      </div>
    </div>
  );
}
