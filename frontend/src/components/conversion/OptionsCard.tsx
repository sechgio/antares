import { useState } from 'react';
import Card from '../ui/Card';
import Toggle from '../ui/Toggle';
import Input from '../ui/Input';
import { Camera, Maximize2, SlidersHorizontal, Info, Zap, Image as ImageIcon, FileImage, Layers } from 'lucide-react';

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
  conversionEnabled: boolean;
  onToggleConversion: (v: boolean) => void;
  hasVideos?: boolean;
}

const QUALITY_PRESETS = [
  { label: 'Ultra', value: 100, desc: 'Máxima calidad', icon: Layers, color: 'var(--accent-green)' },
  { label: 'Alta', value: 95, desc: 'Recomendado', icon: ImageIcon, color: 'var(--accent-primary)' },
  { label: 'Web', value: 80, desc: 'Equilibrado', icon: Zap, color: 'var(--accent-yellow)' },
  { label: 'Ligero', value: 60, desc: 'Menor tamaño', icon: FileImage, color: 'var(--accent-blue)' },
];

const FORMAT_INFO: Record<string, { desc: string; lossless: boolean; supportsAlpha: boolean; bestFor: string }> = {
  JPEG: { desc: 'Compresión con pérdida, ideal para fotos.', lossless: false, supportsAlpha: false, bestFor: 'Fotografía web' },
  JPG: { desc: 'Igual que JPEG.', lossless: false, supportsAlpha: false, bestFor: 'Fotografía web' },
  PNG: { desc: 'Sin pérdida, transparencia soportada.', lossless: true, supportsAlpha: true, bestFor: 'Gráficos, logos' },
  WEBP: { desc: 'Excelente compresión, transparencia.', lossless: true, supportsAlpha: true, bestFor: 'Web moderna' },
  TIFF: { desc: 'Sin compresión, alta fidelidad.', lossless: true, supportsAlpha: true, bestFor: 'Impresión profesional' },
  BMP: { desc: 'Sin compresión, archivos grandes.', lossless: true, supportsAlpha: false, bestFor: 'Compatibilidad legacy' },
  GIF: { desc: 'Animaciones y transparencia simple.', lossless: false, supportsAlpha: true, bestFor: 'Animaciones simples' },
  ICO: { desc: 'Iconos de Windows.', lossless: true, supportsAlpha: true, bestFor: 'Favicons' },
  PDF: { desc: 'Documento portable con imágenes.', lossless: true, supportsAlpha: false, bestFor: 'Documentos' },
};

export default function OptionsCard({
  formato, formatos, onFormatoChange,
  calidad, onCalidadChange,
  resizeEnabled, onToggleResize,
  resizeAncho, resizeAlto, onResizeAnchoChange, onResizeAltoChange,
  keepExif, onToggleExif,
  conversionEnabled, onToggleConversion,
  hasVideos = false,
}: OptionsCardProps) {
  const [showFormatInfo, setShowFormatInfo] = useState(false);
  const formatInfo = FORMAT_INFO[formato] || FORMAT_INFO['JPEG'];

  return (
    <Card className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <div>
            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Conversión</span>
            <span className="text-xs text-[var(--text-secondary)]">
              {conversionEnabled ? `${formato} · ${calidad}%` : 'Desactivada · solo renombrar'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {hasVideos && conversionEnabled && (
            <div className="rounded-lg border border-[var(--accent-yellow)]/25 bg-[var(--accent-yellow)]/10 px-2.5 py-1">
              <p className="text-[11px] font-medium text-[var(--accent-yellow)]">Videos: copia directa</p>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5">
            <span className="text-[11px] font-semibold text-[var(--text-secondary)]">
              {conversionEnabled ? 'Activa' : 'Solo renombrar'}
            </span>
            <Toggle checked={conversionEnabled} onChange={onToggleConversion} />
          </div>
        </div>
      </div>

      {!conversionEnabled && (
        <div className="rounded-xl border border-[var(--accent-secondary)]/25 bg-[var(--accent-secondary)]/10 px-3 py-2.5">
          <p className="text-xs font-medium text-[var(--accent-secondary)]">
            La conversión está desactivada. Los archivos se copiarán al destino con el nuevo nombre y conservarán su formato original.
          </p>
        </div>
      )}

      {conversionEnabled && (
        <>
          {/* Format Selector */}
          <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[var(--text-secondary)]">Formato de salida</label>
          <button
            onClick={() => setShowFormatInfo((v) => !v)}
            className="text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-colors"
            title="Información del formato"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {formatos.map((f) => {
            const active = f === formato;
            const info = FORMAT_INFO[f];
            return (
              <button
                key={f}
                onClick={() => onFormatoChange(f)}
                className={`relative flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border text-center transition-all duration-200 ${
                  active
                    ? 'bg-[var(--accent-primary)]/10 border-[var(--accent-primary)]/40 text-[var(--accent-primary)]'
                    : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]'
                }`}
                title={info?.desc || f}
              >
                <span className="text-[10px] font-bold">{f}</span>
                {active && (
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--accent-primary)]">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {showFormatInfo && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 px-3 py-2.5 space-y-1 animate-fade-in">
            <p className="text-[11px] text-[var(--text-secondary)]">{formatInfo.desc}</p>
            <div className="flex flex-wrap gap-2">
              {formatInfo.lossless && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--accent-green)]/10 text-[var(--accent-green)] border border-[var(--accent-green)]/20">Sin pérdida</span>
              )}
              {formatInfo.supportsAlpha && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border border-[var(--accent-blue)]/20">Transparencia</span>
              )}
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border-subtle)]">{formatInfo.bestFor}</span>
            </div>
          </div>
        )}
          </div>

          {/* Quality Section */}
          <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[var(--text-secondary)]">Calidad de compresión</label>
          <span className="text-sm font-bold text-[var(--accent-primary)]">{calidad}%</span>
        </div>

        {/* Quality Presets */}
        <div className="grid grid-cols-4 gap-1.5">
          {QUALITY_PRESETS.map((preset) => {
            const Icon = preset.icon;
            const active = calidad === preset.value;
            return (
              <button
                key={preset.label}
                onClick={() => onCalidadChange(preset.value)}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-xl border text-center transition-all duration-200 ${
                  active
                    ? 'border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/10'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-medium)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" style={{ color: active ? 'var(--accent-primary)' : preset.color }} />
                <span className={`text-[10px] font-bold ${active ? 'text-[var(--accent-primary)]' : 'text-[var(--text-secondary)]'}`}>{preset.label}</span>
                <span className="text-[9px] text-[var(--text-muted)]">{preset.desc}</span>
              </button>
            );
          })}
        </div>

        {/* Fine-tune Slider */}
        <div className="pt-1">
          <input
            type="range"
            min={1}
            max={100}
            value={calidad}
            onChange={(e) => onCalidadChange(parseInt(e.target.value))}
            className="w-full h-1.5 bg-[var(--bg-elevated)] rounded-full appearance-none cursor-pointer accent-[var(--accent-primary)]"
            style={{
              background: `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${calidad}%, var(--bg-elevated) ${calidad}%, var(--bg-elevated) 100%)`,
            }}
          />
          <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1.5">
            <span>1%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>
          </div>

          <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
            {/* Resize Toggle */}
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
            <div className="flex items-center gap-3 pl-[42px] animate-fade-in">
              <div className="flex-1">
                <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 block">Ancho (px)</label>
                <Input
                  type="number"
                  placeholder="1920"
                  value={resizeAncho}
                  onChange={(e) => onResizeAnchoChange(e.target.value)}
                  className="text-center"
                />
              </div>
              <span className="text-[var(--text-muted)] font-bold mt-5">×</span>
              <div className="flex-1">
                <label className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 block">Alto (px)</label>
                <Input
                  type="number"
                  placeholder="1080"
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
        </>
      )}
    </Card>
  );
}
