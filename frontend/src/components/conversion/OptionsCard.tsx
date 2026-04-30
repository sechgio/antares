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

function ResizeIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

function ExifIcon({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
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
    <Card className="space-y-5">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-1 h-4 rounded-full bg-[var(--accent-primary)]" />
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Opciones de conversión</span>
      </div>

      {hasVideos && (
        <div className="p-3 bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/25 rounded-xl">
          <p className="text-xs text-[var(--accent-primary)] leading-relaxed">
            Los videos se copiarán sin conversión. Solo se aplicará el renombrado.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5">
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

      <div className="pt-4 border-t border-[var(--border-subtle)] space-y-4">
        {/* Resize Toggle */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-muted)]">
                <ResizeIcon className="w-4 h-4" />
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

        {/* EXIF Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-muted)]">
              <ExifIcon className="w-4 h-4" />
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
