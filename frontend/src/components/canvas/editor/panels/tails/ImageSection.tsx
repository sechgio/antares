import { parseImageZoom } from '../../../ops/layerStyle';
import InlineNumField from '../../InlineNumField';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

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
      <select
        className="canvas-input mt-1 text-[11px]"
        value={layer.cssVars['--object-fit'] || 'cover'}
        onChange={(e) =>
          onChange({
            ...layer,
            cssVars: { ...layer.cssVars, '--object-fit': e.target.value },
          })
        }
      >
        <option value="cover">Cubrir</option>
        <option value="contain">Contener</option>
        <option value="fill">Estirar</option>
      </select>
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
      <select
        className="canvas-input mt-1 text-[11px]"
        value={layer.cssVars['--object-position'] || '50% 50%'}
        aria-label="Posición de imagen"
        onChange={(e) => setVar('--object-position', e.target.value)}
      >
        <option value="50% 50%">Centro</option>
        <option value="0% 0%">Arriba izq.</option>
        <option value="50% 0%">Arriba</option>
        <option value="100% 0%">Arriba der.</option>
        <option value="0% 50%">Izquierda</option>
        <option value="100% 50%">Derecha</option>
        <option value="0% 100%">Abajo izq.</option>
        <option value="50% 100%">Abajo</option>
        <option value="100% 100%">Abajo der.</option>
      </select>
    </div>
  );
}
