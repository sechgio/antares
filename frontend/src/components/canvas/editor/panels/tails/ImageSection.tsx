import { registerImageBlob, releaseImageBlob } from '../../../utils/imageBlobStore';
import { fileToDataUrl } from '../../../../../utils/pdfAssets';
import { ImageObjectControls, SectionHeader } from '../shared';
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
                fileToDataUrl(file)
                  .then((dataUrl) => {
                    releaseImageBlob(previous);
                    onChange({ ...layer, value: dataUrl });
                  })
                  .catch(() => {});
              });
          }}
        />
        <ImageObjectControls
          layer={layer}
          setVar={setVar}
          setVarLive={setVarLive}
          onCommitLive={onCommitLive}
          ariaPrefix="imagen"
        />
      </div>
    </div>
  );
}
