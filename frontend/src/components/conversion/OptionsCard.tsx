import Card from '../ui/Card';
import Dropdown from '../ui/Dropdown';
import Slider from '../ui/Slider';
import Toggle from '../ui/Toggle';
import Input from '../ui/Input';

interface OptionsCardProps {
  formato: string;
  formatos: string[];
  onFormatoChange: (f: string) => void;
  calidad: number;
  onCalidadChange: (c: number) => void;
  resizeEnabled: boolean;
  onToggleResize: (v: boolean) => void;
  resizeAncho: string;
  resizeAlto: string;
  onResizeAnchoChange: (v: string) => void;
  onResizeAltoChange: (v: string) => void;
  keepExif: boolean;
  onToggleExif: (v: boolean) => void;
  hasVideos?: boolean;
}

export default function OptionsCard({
  formato, formatos, onFormatoChange,
  calidad, onCalidadChange,
  resizeEnabled, onToggleResize,
  resizeAncho, resizeAlto, onResizeAnchoChange, onResizeAltoChange,
  keepExif, onToggleExif,
  hasVideos = false,
}: OptionsCardProps) {
  return (
    <Card>
      <div className="eyebrow mb-4">CONVERSIÓN</div>
      {hasVideos && (
        <div className="mb-4 p-3 bg-[#5E6AD2]/10 border border-[#5E6AD2]/30 rounded-lg">
          <p className="text-xs text-[#5E6AD2]">
            ⚠️ Los videos se copiarán sin conversión. Solo se aplicará el renombrado.
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-xs text-[#666666] mb-2">Formato</label>
          <Dropdown value={formato} options={formatos} onChange={onFormatoChange} />
        </div>
        <div>
          <Slider
            value={calidad}
            onChange={onCalidadChange}
            label={
              <div className="flex justify-between text-xs text-[#666666] mb-1">
                <span>Calidad</span>
                <span className="text-[#5E6AD2] font-medium">{calidad}%</span>
              </div>
            }
          />
        </div>
      </div>

      <div className="mt-5 pt-5 border-t border-[#1A1A1A] space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-white block">Redimensionar</span>
          </div>
          <Toggle checked={resizeEnabled} onChange={onToggleResize} />
        </div>
        {resizeEnabled && (
          <div className="flex items-center gap-3">
            <Input
              type="number"
              placeholder="Ancho"
              value={resizeAncho}
              onChange={(e) => onResizeAnchoChange(e.target.value)}
              className="w-24 text-center"
            />
            <span className="text-[#666666] font-bold">×</span>
            <Input
              type="number"
              placeholder="Alto"
              value={resizeAlto}
              onChange={(e) => onResizeAltoChange(e.target.value)}
              className="w-24 text-center"
            />
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-white block">Preservar metadatos EXIF</span>
            <span className="text-xs text-[#666666]">Cámara, fecha y GPS</span>
          </div>
          <Toggle checked={keepExif} onChange={onToggleExif} />
        </div>
      </div>
    </Card>
  );
}
