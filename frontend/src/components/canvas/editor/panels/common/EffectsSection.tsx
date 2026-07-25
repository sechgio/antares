import { Minus, Plus } from 'lucide-react';
import {
  addBoxShadow,
  clampOpacity,
  DEFAULT_SHADOW,
  DEFAULT_SHADOW_2,
  parseBoxShadows,
  parseFilterBlurPx,
  removeBoxShadowAt,
  updateBoxShadowAt,
} from '../../../ops/layerStyle';
import InlineNumField from '../../InlineNumField';
import { HexField, SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function EffectsSection({
  layer,
  setVar,
  setVarLive,
  onCommitLive,
}: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Efectos">
        <button
          type="button"
          className="canvas-paint-icon"
          aria-label="Añadir sombra"
          onClick={() => {
            const raw = layer.cssVars['--box-shadow'];
            const preset = parseBoxShadows(raw).length === 0 ? DEFAULT_SHADOW : DEFAULT_SHADOW_2;
            setVar('--box-shadow', addBoxShadow(raw, preset));
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </SectionHeader>
      <div className="space-y-2">
        <InlineNumField
          prefix="Blur"
          value={parseFilterBlurPx(layer.cssVars)}
          step={1}
          title="Desenfoque de capa"
          onChange={(n) => {
            const blur = Math.max(0, Math.min(40, Math.round(n)));
            setVarLive('--filter-blur', blur > 0 ? `${blur}px` : '0px');
          }}
          onCommit={onCommitLive}
          suffix="px"
        />
        {parseBoxShadows(layer.cssVars['--box-shadow']).map((shadow, shadowIndex) => (
          <div className="space-y-2" data-testid="canvas-effect-shadow" key={shadowIndex}>
            <div className="flex items-center gap-2">
              <span
                className="canvas-swatch !cursor-default"
                style={{ backgroundImage: 'none' }}
              >
                <span className="canvas-swatch-fill" style={{ background: shadow.color }} />
              </span>
              <HexField
                color={shadow.color}
                ariaLabel={`Color sombra ${shadowIndex + 1}`}
                onCommit={(hex) =>
                  setVar(
                    '--box-shadow',
                    updateBoxShadowAt(layer.cssVars['--box-shadow'], shadowIndex, {
                      color: hex,
                    }),
                  )
                }
              />
              <button
                type="button"
                className="canvas-paint-icon"
                aria-label="Quitar sombra"
                onClick={() =>
                  setVar(
                    '--box-shadow',
                    removeBoxShadowAt(layer.cssVars['--box-shadow'], shadowIndex),
                  )
                }
              >
                <Minus className="h-3 w-3" />
              </button>
            </div>
            <div className="flex gap-1">
              <InlineNumField
                prefix="X"
                value={shadow.x}
                step={1}
                onChange={(n) =>
                  setVarLive(
                    '--box-shadow',
                    updateBoxShadowAt(layer.cssVars['--box-shadow'], shadowIndex, { x: n }),
                  )
                }
                onCommit={onCommitLive}
              />
              <InlineNumField
                prefix="Y"
                value={shadow.y}
                step={1}
                onChange={(n) =>
                  setVarLive(
                    '--box-shadow',
                    updateBoxShadowAt(layer.cssVars['--box-shadow'], shadowIndex, { y: n }),
                  )
                }
                onCommit={onCommitLive}
              />
            </div>
            <div className="flex gap-1">
              <InlineNumField
                prefix="B"
                value={shadow.blur}
                step={1}
                title="Difuminado"
                onChange={(n) =>
                  setVarLive(
                    '--box-shadow',
                    updateBoxShadowAt(layer.cssVars['--box-shadow'], shadowIndex, {
                      blur: Math.max(0, n),
                    }),
                  )
                }
                onCommit={onCommitLive}
              />
              <InlineNumField
                prefix=""
                value={shadow.opacity}
                suffix="%"
                title="Opacidad sombra"
                onChange={(n) =>
                  setVarLive(
                    '--box-shadow',
                    updateBoxShadowAt(layer.cssVars['--box-shadow'], shadowIndex, {
                      opacity: clampOpacity(n),
                    }),
                  )
                }
                onCommit={onCommitLive}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
