import { Plus } from 'lucide-react';
import PaintRow from '../../PaintRow';
import InlineNumField from '../../InlineNumField';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';
import CanvasSelect from '../../CanvasSelect';

export default function FillSection({
  layer,
  pageColors,
  hasFill,
  setVars,
  setVarsLive,
  setVar,
  onCommitLive,
}: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Relleno">
        <button
          type="button"
          className="canvas-paint-icon"
          aria-label="Añadir relleno"
          disabled={hasFill}
          onClick={() =>
            setVars({
              '--background-color': '#D9D9D9',
              '--fill-opacity': '100',
              '--fill-visible': '1',
            })
          }
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </SectionHeader>
      {hasFill ? (
        <div className="space-y-2">
          <PaintRow
            color={layer.cssVars['--background-color'] || '#FFFFFF'}
            opacity={Number(layer.cssVars['--fill-opacity'] ?? 100)}
            visible={layer.cssVars['--fill-visible'] !== '0'}
            pageColors={pageColors}
            onPaintChange={(c, o) =>
              setVarsLive({
                '--background-color': c,
                '--fill-opacity': String(o),
                '--fill-visible': '1',
              })
            }
            onPaintCommit={onCommitLive}
            onVisibleChange={(v) => setVar('--fill-visible', v ? '1' : '0')}
            onRemove={() =>
              setVars({
                '--background-color': 'transparent',
                '--fill-visible': '0',
                '--fill-type': 'solid',
              })
            }
          />
          <label className="block text-[11px]" style={{ color: 'var(--cv-text-secondary)' }}>
            Tipo
            <CanvasSelect
              className="mt-1 w-full text-[11px]"
              value={layer.cssVars['--fill-type'] || 'solid'}
              aria-label="Tipo de relleno"
              onChange={(next) => {
                if (next === 'linear' || next === 'radial') {
                  setVars({
                    '--fill-type': next,
                    '--fill-color-2': layer.cssVars['--fill-color-2'] || '#000000',
                    '--fill-angle': layer.cssVars['--fill-angle'] || '180',
                  });
                } else {
                  setVar('--fill-type', 'solid');
                }
              }}
              options={[
                { value: 'solid', label: 'Sólido' },
                { value: 'linear', label: 'Lineal' },
                { value: 'radial', label: 'Radial' },
              ]}
            />
          </label>
          {(layer.cssVars['--fill-type'] === 'linear' ||
            layer.cssVars['--fill-type'] === 'radial') && (
            <>
              <PaintRow
                color={layer.cssVars['--fill-color-2'] || '#000000'}
                opacity={Number(layer.cssVars['--fill-opacity'] ?? 100)}
                visible
                pageColors={pageColors}
                onPaintChange={(c, o) =>
                  setVarsLive({
                    '--fill-color-2': c,
                    '--fill-opacity': String(o),
                  })
                }
                onPaintCommit={onCommitLive}
                onRemove={() => setVar('--fill-type', 'solid')}
              />
              {layer.cssVars['--fill-type'] === 'linear' && (
                <InlineNumField
                  prefix="∠"
                  value={Number.parseFloat(layer.cssVars['--fill-angle'] || '180') || 180}
                  step={1}
                  title="Ángulo del degradado"
                  onChange={(n) => setVarsLive({ '--fill-angle': String(Math.round(n)) })}
                  onCommit={onCommitLive}
                  suffix="°"
                />
              )}
            </>
          )}
        </div>
      ) : (
        <p className="text-[11px]" style={{ color: 'var(--cv-text-muted)' }}>
          Sin relleno
        </p>
      )}
    </div>
  );
}
