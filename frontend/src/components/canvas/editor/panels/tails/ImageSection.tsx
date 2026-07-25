import { parseImageZoom } from '../../../ops/layerStyle';
import InlineNumField from '../../InlineNumField';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

import CanvasSelect from '../../CanvasSelect';

export default function ImageSection({ layer, onChange, setVar, setVarLive, onCommitLive }: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Imagen estática" />
      <input
        type="file"
        accept="image/*"
        className="canvas-input text-[11px]"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => onChange({ ...layer, value: String(reader.result || '') });
          reader.readAsDataURL(file);
        }}
      />
      <label className="mt-2 block text-[11px]" style={{ color: 'var(--cv-text-secondary)' }}>
        Ajuste
      </label>
      <CanvasSelect
        className="mt-1 text-[11px]"
        value={layer.cssVars['--object-fit'] || 'cover'}
        aria-label="Ajuste de imagen"
        onChange={(val) =>
          onChange({
            ...layer,
            cssVars: { ...layer.cssVars, '--object-fit': val },
          })
        }
        options={[
          { value: 'cover', label: 'Cubrir' },
          { value: 'contain', label: 'Contener' },
          { value: 'fill', label: 'Estirar' },
        ]}
      />
      <div className="mt-2 flex gap-1">
        <InlineNumField
          prefix="Z"
          value={parseImageZoom(layer.cssVars)}
          step={0.05}
          title="Zoom de recorte"
          onChange={(n) =>
            setVarLive('--image-zoom', String(Math.min(3, Math.max(1, Math.round(n * 100) / 100))))
          }
          onCommit={onCommitLive}
        />
      </div>
      <label className="mt-2 block text-[11px]" style={{ color: 'var(--cv-text-secondary)' }}>
        Posición
      </label>
      <CanvasSelect
        className="mt-1 text-[11px]"
        value={layer.cssVars['--object-position'] || '50% 50%'}
        aria-label="Posición de imagen"
        onChange={(val) => setVar('--object-position', val)}
        options={[
          { value: '50% 50%', label: 'Centro' },
          { value: '0% 0%', label: 'Arriba izq.' },
          { value: '50% 0%', label: 'Arriba' },
          { value: '100% 0%', label: 'Arriba der.' },
          { value: '0% 50%', label: 'Izquierda' },
          { value: '100% 50%', label: 'Derecha' },
          { value: '0% 100%', label: 'Abajo izq.' },
          { value: '50% 100%', label: 'Abajo' },
          { value: '100% 100%', label: 'Abajo der.' },
        ]}
      />
    </div>
  );
}
