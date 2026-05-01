import Card from '../ui/Card';
import Dropdown from '../ui/Dropdown';
import Slider from '../ui/Slider';
import Toggle from '../ui/Toggle';
import Input from '../ui/Input';
import { Camera, Maximize2, SlidersHorizontal } from 'lucide-react';

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
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <div>
            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Conversión</span>
            <span className="text-xs text-[var(--text-secondary)]">{formato} · {calidad}%</span>
          </div>
        </div>
      </div>

      {hasVideos && (
        <div className="rounded-lg border border-[var(--accent-primary)]/25 bg-[var(--accent-primary)]/10 px-3 py-2">
          <p className="text-xs leading-relaxed text-[var(--accent-primary)]">Videos: copia directa + renombrado.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">Formato de salida</label>
          <Dropdown value={formato} options={formatos} onChange={onFormatoChange} />
        </div>

        <div>
          <Slider
            value={calidad}
            onChange={onCalidadChange}
            label={
              <div className="flex justify-between text-xs text-[var(--text-secondary)] mb-1.5 font-medium">
                <span>Calidad de compresión</span>
                <span className="text-[var(--accent-primary)] font-semibold">{calidad}%</span>
              </div>
            }
          />
        </div>
      </div>

      <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                <Maximize2 className="h-4 w-4" />
              </div>
              <div>
                <span className="text-sm font-medium text-[var(--text-primary)] block">Redimensionar</span>
                <span className="text-[11px] text-[var(--text-muted)]">Ajustar dimensiones de salida</span>
              </div>
            </div>
            <Toggle checked={resizeEnabled} onChange={onToggleResize} />
          </div>

          {resizeEnabled && (
            <div className="flex items-center gap-3 pl-[42px]">
              <div className="flex-1">
                <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 block">Ancho</label>
                <Input
                  type="number"
                  placeholder="px"
                  value={resizeAncho}
                  onChange={(e) => onResizeAnchoChange(e.target.value)}
                  className="text-center"
                />
              </div>
              <span className="text-[var(--text-muted)] font-bold mt-5">×</span>
              <div className="flex-1">
                <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 block">Alto</label>
                <Input
                  type="number"
                  placeholder="px"
                  value={resizeAlto}
                  onChange={(e) => onResizeAltoChange(e.target.value)}
                  className="text-center"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--text-muted)]">
              <Camera className="h-4 w-4" />
            </div>
            <div>
              <span className="text-sm font-medium text-[var(--text-primary)] block">Preservar metadatos</span>
              <span className="text-[11px] text-[var(--text-muted)]">Cámara, fecha y GPS (EXIF)</span>
            </div>
          </div>
          <Toggle checked={keepExif} onChange={onToggleExif} />
        </div>
      </div>
    </Card>
  );
}
