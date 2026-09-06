import { clampImageZoom, parseImageZoom } from '../../../ops/layerStyle';
import { registerImageBlob, releaseImageBlob } from '../../../utils/imageBlobStore';
import CanvasSelect from '../../CanvasSelect';
import InlineNumField from '../../InlineNumField';
import { IMAGE_FIT_OPTIONS, IMAGE_POSITION_OPTIONS, PropRow, SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function ImageSection({ layer, onChange, setVar, setVarLive, onCommitLive }: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Imagen estática" />
      <div className="canvas-inspector-stack">
        <input
          type="file"
          accept="image/*"
          className="canvas-input text-[11px]"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const previous = layer.value;
            registerImageBlob(file)
              .then((registered) => {
                releaseImageBlob(previous);
                onChange({ ...layer, value: registered.url });
              })
              .catch(() => {
                const reader = new FileReader();
                reader.onload = () => {
                  releaseImageBlob(previous);
                  onChange({ ...layer, value: String(reader.result || '') });
                };
                reader.readAsDataURL(file);
              });
          }}
        />
        <PropRow label="Ajuste">
          <CanvasSelect
            value={layer.cssVars['--object-fit'] || 'cover'}
            aria-label="Ajuste de imagen"
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
            aria-label="Posición de imagen"
            onChange={(val) => setVar('--object-position', val)}
            options={IMAGE_POSITION_OPTIONS}
          />
        </PropRow>
      </div>
    </div>
  );
}
