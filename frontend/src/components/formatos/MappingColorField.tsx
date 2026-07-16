import { RotateCcw } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import type { VisualMapping } from '../../types';
import { hexToMappingColor, mappingColorCss, mappingColorToHex } from './mappingCoords';

type MappingColors = Pick<VisualMapping, 'color_r' | 'color_g' | 'color_b'>;

interface MappingColorFieldProps {
  mapping: MappingColors;
  originalMapping: MappingColors;
  showReset: boolean;
  onChange: (colors: MappingColors) => void;
}

const PRESETS: { label: string; hex: string }[] = [
  { label: 'Negro', hex: '#000000' },
  { label: 'Azul', hex: '#1e3a8a' },
  { label: 'Rojo', hex: '#b91c1c' },
  { label: 'Verde', hex: '#15803d' },
  { label: 'Gris', hex: '#4b5563' },
];

function colorsEqual(a: MappingColors, b: MappingColors): boolean {
  return a.color_r === b.color_r && a.color_g === b.color_g && a.color_b === b.color_b;
}

export default function MappingColorField({ mapping, originalMapping, showReset, onChange }: MappingColorFieldProps) {
  const currentHex = mappingColorToHex(mapping.color_r, mapping.color_g, mapping.color_b);
  const isOriginal = colorsEqual(mapping, originalMapping);

  return (
    <div>
      <div className="text-center text-[8px] text-[var(--text-muted)] tracking-widest mb-1" style={{ fontFamily: "'Roboto Mono', monospace" }}>
        Color del número
      </div>

      <label
        className="flex h-9 w-full items-center justify-center gap-2.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 hover:border-[var(--border-medium)] transition-colors cursor-pointer"
      >
        <input
          type="color"
          aria-label="Color del número"
          value={currentHex}
          onChange={(event) => onChange(hexToMappingColor(event.target.value))}
          className="h-5 w-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <span
          className="text-[11px] text-[var(--text-secondary)] tracking-wider"
          style={{ fontFamily: "'Roboto Mono', monospace" }}
        >
          Toca para elegir un color
        </span>
        <span
          aria-hidden
          className="h-5 w-8 shrink-0 rounded border border-[var(--border-subtle)]"
          style={{ backgroundColor: mappingColorCss(mapping.color_r, mapping.color_g, mapping.color_b) }}
        />
      </label>

      <div className="mt-2 flex items-center justify-center gap-2">
        {PRESETS.map((preset) => {
          const active = currentHex.toLowerCase() === preset.hex.toLowerCase();
          return (
            <WithHoverTooltip key={preset.hex} label={preset.label} placement="bottom">
              <button
                type="button"
                aria-label={preset.label}
                onClick={() => onChange(hexToMappingColor(preset.hex))}
                className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${
                  active ? 'border-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]/50' : 'border-[var(--border-subtle)]'
                }`}
                style={{ backgroundColor: preset.hex }}
              />
            </WithHoverTooltip>
          );
        })}
      </div>

      <p className="mt-2 text-center text-[9px] leading-relaxed text-[var(--text-muted)]" style={{ fontFamily: "'Roboto Mono', monospace" }}>
        Solo cambia el color del correlativo, no el de la plantilla.
      </p>

      {showReset && !isOriginal && (
        <button
          type="button"
          onClick={() => onChange({ ...originalMapping })}
          className="mt-2 flex w-full items-center justify-center gap-1.5 text-[9px] text-[var(--accent-primary)]/70 hover:text-[var(--accent-primary)] tracking-wider transition-colors"
          style={{ fontFamily: "'Roboto Mono', monospace" }}
        >
          <RotateCcw size={10} />
          Restaurar color original
        </button>
      )}
    </div>
  );
}
