import { Link2, Minus, Plus, Sparkles, Type } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { SectionHeader } from './panels/shared';
import type { CanvasLayer, CanvasSharedStyle, CanvasStyleKind } from '../types';

const KINDS: Array<{ kind: CanvasStyleKind; label: string }> = [
  { kind: 'color', label: 'Color' },
  { kind: 'text', label: 'Texto' },
  { kind: 'effect', label: 'Efecto' },
];

function linkedId(layer: CanvasLayer | null, kind: CanvasStyleKind): string | undefined {
  if (!layer) return undefined;
  if (kind === 'color') return layer.fillStyleId;
  if (kind === 'text') return layer.textStyleId;
  return layer.effectStyleId;
}

function swatchColor(style: CanvasSharedStyle): string | null {
  if (style.kind === 'color') {
    return style.cssVars['--background-color'] || style.cssVars['--border-color'] || null;
  }
  if (style.kind === 'text') return style.cssVars['--color'] || null;
  return null;
}

function StylePreview({ style }: { style: CanvasSharedStyle }) {
  const color = swatchColor(style);
  if (style.kind === 'color' || color) {
    const fill = color && color !== 'transparent' ? color : 'transparent';
    return (
      <span className="canvas-swatch pointer-events-none" aria-hidden>
        <span className="canvas-swatch-fill" style={{ background: fill }} />
      </span>
    );
  }
  return (
    <span className="canvas-style-kind-icon" aria-hidden>
      {style.kind === 'text' ? <Type className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
    </span>
  );
}

interface StylesSectionProps {
  styles: CanvasSharedStyle[];
  layer: CanvasLayer | null;
  canLink: boolean;
  onCreate: (kind: CanvasStyleKind) => void;
  onApply: (styleId: string) => void;
  onDetach: (kind: CanvasStyleKind) => void;
  onRemove: (styleId: string) => void;
  onRename: (styleId: string, name: string) => void;
}

export default function StylesSection({
  styles,
  layer,
  canLink,
  onCreate,
  onApply,
  onDetach,
  onRemove,
  onRename,
}: StylesSectionProps) {
  return (
    <div className="canvas-section" data-testid="canvas-styles-section">
      <SectionHeader title="Estilos" />
      <div className="canvas-style-groups">
        {KINDS.map(({ kind, label }) => {
          const list = styles.filter((s) => s.kind === kind);
          return (
            <div key={kind} className="canvas-style-group">
              <div className="canvas-style-group-header">
                <span className="canvas-style-group-label">{label}</span>
                {canLink && (
                  <WithHoverTooltip
                    label={`Crear estilo ${label.toLowerCase()} desde selección`}
                    placement="left"
                    variant="dark"
                  >
                    <button
                      type="button"
                      className="canvas-paint-icon"
                      aria-label={`Crear estilo ${label}`}
                      onClick={() => onCreate(kind)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </WithHoverTooltip>
                )}
              </div>
              {list.length > 0 && (
                <ul className="canvas-style-list">
                  {list.map((style) => {
                    const linked = linkedId(layer, kind) === style.id;
                    return (
                      <li
                        key={style.id}
                        className="canvas-style-row"
                        data-linked={linked ? 'true' : undefined}
                      >
                        <StylePreview style={style} />
                        {linked && (
                          <span className="canvas-style-linked-mark" title="Aplicado" aria-hidden>
                            <Link2 className="h-2.5 w-2.5" />
                          </span>
                        )}
                        <input
                          className="canvas-input canvas-input--inline canvas-style-name"
                          value={style.name}
                          aria-label={`Nombre estilo ${style.name}`}
                          onChange={(e) => onRename(style.id, e.target.value)}
                        />
                        <div className="canvas-style-actions">
                          {canLink && (
                            <WithHoverTooltip
                              label={linked ? 'Desvincular' : 'Aplicar a selección'}
                              placement="left"
                              variant="dark"
                            >
                              <button
                                type="button"
                                className="canvas-paint-icon"
                                aria-label={linked ? 'Desvincular estilo' : 'Aplicar estilo'}
                                onClick={() => (linked ? onDetach(kind) : onApply(style.id))}
                              >
                                <Link2 className="h-3 w-3" />
                              </button>
                            </WithHoverTooltip>
                          )}
                          <WithHoverTooltip label="Eliminar estilo" placement="left" variant="dark">
                            <button
                              type="button"
                              className="canvas-paint-icon"
                              aria-label="Eliminar estilo"
                              onClick={() => onRemove(style.id)}
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                          </WithHoverTooltip>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
