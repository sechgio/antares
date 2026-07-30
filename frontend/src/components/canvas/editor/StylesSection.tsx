import { Link2, Link2Off, Plus, Trash2 } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
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
      <div className="canvas-section-title">Estilos</div>
      {KINDS.map(({ kind, label }) => {
        const list = styles.filter((s) => s.kind === kind);
        return (
          <div key={kind} className="mb-3">
            <div className="mb-1 flex items-center justify-between gap-1">
              <span className="canvas-sublabel !mb-0">{label}</span>
              {canLink && (
                <WithHoverTooltip
                  label={`Crear estilo ${label.toLowerCase()} desde selección`}
                  placement="left"
                  variant="dark"
                >
                  <button
                    type="button"
                    className="canvas-icon-btn !h-6 !w-6"
                    aria-label={`Crear estilo ${label}`}
                    onClick={() => onCreate(kind)}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </WithHoverTooltip>
              )}
            </div>
            {list.length > 0 && (
              <ul className="space-y-1">
                {list.map((style) => {
                  const linked = linkedId(layer, kind) === style.id;
                  const color = swatchColor(style);
                  return (
                    <li
                      key={style.id}
                      className="flex items-center gap-1 rounded-md px-1 py-0.5"
                      style={{ background: linked ? 'var(--cv-hover)' : undefined }}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-sm border"
                        style={{
                          background: color || 'transparent',
                          borderColor: 'var(--cv-border)',
                        }}
                        aria-hidden
                      />
                      <input
                        className="canvas-input !h-6 min-w-0 flex-1 !px-1 !text-[11px]"
                        value={style.name}
                        aria-label={`Nombre estilo ${style.name}`}
                        onChange={(e) => onRename(style.id, e.target.value)}
                      />
                      {canLink && (
                        <WithHoverTooltip
                          label={linked ? 'Desvincular' : 'Aplicar a selección'}
                          placement="left"
                          variant="dark"
                        >
                          <button
                            type="button"
                            className="canvas-icon-btn !h-6 !w-6"
                            aria-label={linked ? 'Desvincular estilo' : 'Aplicar estilo'}
                            onClick={() => (linked ? onDetach(kind) : onApply(style.id))}
                          >
                            {linked ? (
                              <Link2Off className="h-3 w-3" />
                            ) : (
                              <Link2 className="h-3 w-3" />
                            )}
                          </button>
                        </WithHoverTooltip>
                      )}
                      <WithHoverTooltip label="Eliminar estilo" placement="left" variant="dark">
                        <button
                          type="button"
                          className="canvas-icon-btn !h-6 !w-6"
                          aria-label="Eliminar estilo"
                          onClick={() => onRemove(style.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </WithHoverTooltip>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
