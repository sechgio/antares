import { Plus } from 'lucide-react';
import PaintRow from '../../PaintRow';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';
import CanvasSelect from '../../CanvasSelect';
import {
  applyLineStrokeWeight,
  parseStrokeAlign,
  parseStrokeDash,
  STROKE_WEIGHT_MAX_PX,
  STROKE_WEIGHT_MIN_PX,
  STROKE_WEIGHT_STEP_PX,
  type StrokeAlign,
  type StrokeDash,
} from '../../../ops/layerStyle';
import { parseStrokeCap } from '../../../ops/pathGeometry';
import type { StrokeCap } from '../../../types';

export default function StrokeSection({
  layer,
  pageColors,
  isLine,
  hasStroke,
  strokeWeightPx,
  strokeWeightPct,
  setStrokeWeight,
  setVars,
  setVar,
  setVarsLive,
  onChange,
  onCommitLive,
}: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Trazo">
        <button
          type="button"
          className="canvas-paint-icon"
          aria-label="Añadir trazo"
          disabled={hasStroke}
          onClick={() => {
            if (layer.type === 'line') {
              onChange(
                applyLineStrokeWeight(
                  {
                    ...layer,
                    cssVars: {
                      ...layer.cssVars,
                      '--border-color': layer.cssVars['--border-color'] || '#000000',
                      '--stroke-opacity': '100',
                      '--stroke-align': 'center',
                    },
                  },
                  1,
                ),
              );
              return;
            }
            setVars({
              '--border-color': '#000000',
              '--border-width': '1px',
              '--stroke-opacity': '100',
              '--stroke-visible': '1',
              '--stroke-align': 'inside',
            });
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </SectionHeader>
      {hasStroke ? (
        <>
          <PaintRow
            color={layer.cssVars['--border-color'] || '#000000'}
            opacity={Number(layer.cssVars['--stroke-opacity'] ?? 100)}
            visible={layer.cssVars['--stroke-visible'] !== '0'}
            pageColors={pageColors}
            onPaintChange={(c, o) =>
              setVarsLive({
                '--border-color': c,
                '--stroke-opacity': String(o),
                '--stroke-visible': '1',
              })
            }
            onPaintCommit={onCommitLive}
            onVisibleChange={(v) => setVar('--stroke-visible', v ? '1' : '0')}
            onRemove={() => {
              if (layer.type === 'line') {
                onChange(applyLineStrokeWeight(layer, 0));
                return;
              }
              setVars({
                '--border-width': '0px',
                '--stroke-visible': '0',
              });
            }}
          />
          <div className="mt-2 space-y-2">
            <label className="block">
              <span className="canvas-sublabel">Posición</span>
              <CanvasSelect
                value={isLine ? 'center' : parseStrokeAlign(layer.cssVars['--stroke-align'])}
                disabled={isLine}
                aria-label="Posición de trazo"
                onChange={(val) => setVar('--stroke-align', val as StrokeAlign)}
                options={[
                  ...(!isLine ? [{ value: 'inside', label: 'Interior' }] : []),
                  { value: 'center', label: 'Centro' },
                  ...(!isLine ? [{ value: 'outside', label: 'Exterior' }] : []),
                ]}
              />
            </label>
            <label className="block">
              <span className="canvas-sublabel">Estilo</span>
              <CanvasSelect
                value={parseStrokeDash(layer.cssVars['--stroke-dash'])}
                aria-label="Estilo de trazo"
                onChange={(val) => setVar('--stroke-dash', val as StrokeDash)}
                options={[
                  { value: 'solid', label: 'Continuo' },
                  { value: 'dashed', label: 'Discontinuo' },
                  { value: 'dotted', label: 'Punteado' },
                ]}
              />
            </label>
            <div>
              <span className="canvas-sublabel">Peso</span>
              <div className="mt-0.5 flex items-center gap-2">
                <input
                  type="range"
                  className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-black/20 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-black/20 [&::-moz-range-thumb]:bg-white [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent"
                  style={{
                    background: `linear-gradient(to right, var(--cv-accent) 0%, var(--cv-accent) ${strokeWeightPct}%, var(--cv-border) ${strokeWeightPct}%, var(--cv-border) 100%)`,
                  }}
                  min={STROKE_WEIGHT_MIN_PX}
                  max={STROKE_WEIGHT_MAX_PX}
                  step={STROKE_WEIGHT_STEP_PX}
                  value={strokeWeightPx}
                  aria-label="Peso del trazo"
                  onChange={(e) => setStrokeWeight(Number(e.target.value))}
                  onPointerUp={() => onCommitLive?.()}
                  onKeyUp={() => onCommitLive?.()}
                />
                <input
                  type="number"
                  className="canvas-input w-[4.25rem] shrink-0"
                  min={STROKE_WEIGHT_MIN_PX}
                  max={STROKE_WEIGHT_MAX_PX}
                  step={STROKE_WEIGHT_STEP_PX}
                  value={strokeWeightPx}
                  aria-label="Peso del trazo (px)"
                  title={`Grosor en px (${STROKE_WEIGHT_MIN_PX}–${STROKE_WEIGHT_MAX_PX})`}
                  onChange={(e) => setStrokeWeight(Number(e.target.value))}
                  onBlur={() => onCommitLive?.()}
                />
              </div>
            </div>
            {isLine && (
              <div className="flex gap-2">
                <label className="min-w-0 flex-1">
                  <span className="canvas-sublabel">Punto de partida</span>
                  <CanvasSelect
                    value={parseStrokeCap(layer.cssVars['--stroke-start'])}
                    aria-label="Punto de partida"
                    onChange={(val) => setVar('--stroke-start', val as StrokeCap)}
                    options={[
                      { value: 'none', label: 'Ninguno' },
                      { value: 'round', label: 'Redondo' },
                      { value: 'square', label: 'Cuadrado' },
                      { value: 'arrow', label: 'Flecha' },
                    ]}
                  />
                </label>
                <label className="min-w-0 flex-1">
                  <span className="canvas-sublabel">Punto final</span>
                  <CanvasSelect
                    value={parseStrokeCap(layer.cssVars['--stroke-end'])}
                    aria-label="Punto final"
                    onChange={(val) => setVar('--stroke-end', val as StrokeCap)}
                    options={[
                      { value: 'none', label: 'Ninguno' },
                      { value: 'round', label: 'Redondo' },
                      { value: 'square', label: 'Cuadrado' },
                      { value: 'arrow', label: 'Flecha' },
                    ]}
                  />
                </label>
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="text-[11px]" style={{ color: 'var(--cv-text-muted)' }}>
          Sin trazo
        </p>
      )}
    </div>
  );
}
