import { FlipHorizontal2, FlipVertical2, RotateCcw } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { mm } from '../../../types';
import { cornerRadiusPx, parseScale, toggleFlip } from '../../../ops/layerStyle';
import { applyCssVarToLayerIds, mixedNumeric, mixedNumericMm } from '../../../ops/mixedSelection';
import InlineNumField from '../../InlineNumField';
import { ALIGN_ITEMS } from '../shared';
import type { SectionProps } from '../types';

export default function PositionSection({
  layer,
  layers = [],
  selectedIds = [],
  setVarLive,
  setVars,
  onChange,
  onReplaceLayers,
  onCommitLive,
  onAlign,
  showRadius,
  emitLive,
}: SectionProps) {
  const selectedLayers = selectedIds.length
    ? layers.filter((item) => selectedIds.includes(item.id))
    : [layer];
  const x = mixedNumericMm(selectedLayers, '--translate-x');
  const y = mixedNumericMm(selectedLayers, '--translate-y');
  const rotation = mixedNumeric(selectedLayers, '--rotate', 0);

  const applyVar = (key: string, value: string) => {
    if (selectedIds.length > 1 && onReplaceLayers) {
      onReplaceLayers(applyCssVarToLayerIds(layers, selectedIds, key, value));
      onCommitLive?.();
      return;
    }
    setVarLive(key, value);
  };

  return (
    <>
      <div className="canvas-alignment-tools" role="group" aria-label="Alinear capa">
        {ALIGN_ITEMS.map(({ align, icon: Icon, label }) => (
          <WithHoverTooltip key={align} label={label} placement="bottom" variant="dark">
            <button
              type="button"
              className="canvas-icon-btn"
              aria-label={label}
              onClick={() => onAlign(align)}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          </WithHoverTooltip>
        ))}
      </div>
      <div className="flex gap-1.5">
        <InlineNumField
          prefix="X"
          value={x.mixed ? 0 : x.value}
          mixed={x.mixed}
          onChange={(n) => applyVar('--translate-x', mm(n))}
          onCommit={x.mixed ? undefined : onCommitLive}
          step={0.1}
          suffix="mm"
        />
        <InlineNumField
          prefix="Y"
          value={y.mixed ? 0 : y.value}
          mixed={y.mixed}
          onChange={(n) => applyVar('--translate-y', mm(n))}
          onCommit={y.mixed ? undefined : onCommitLive}
          step={0.1}
          suffix="mm"
        />
      </div>
      <div className="flex min-w-0 gap-1.5">
        <InlineNumField
          prefix=""
          value={rotation.mixed ? 0 : rotation.value}
          mixed={rotation.mixed}
          onChange={(n) => applyVar('--rotate', `${n}deg`)}
          onCommit={rotation.mixed ? undefined : onCommitLive}
          suffix="°"
          title="Rotación"
        />
        {showRadius && (
          <InlineNumField
            prefix=""
            value={cornerRadiusPx(layer.cssVars, 'tl')}
            onChange={(n) => {
              const v = `${Math.max(0, n)}px`;
              const next = { ...layer.cssVars, '--border-radius': v };
              delete next['--radius-tl'];
              delete next['--radius-tr'];
              delete next['--radius-br'];
              delete next['--radius-bl'];
              emitLive({ ...layer, cssVars: next });
            }}
            onCommit={onCommitLive}
            title="Radio uniforme"
          />
        )}
      </div>
      <div className="canvas-z-order canvas-z-order--compact">
        <WithHoverTooltip label="Voltear horizontal" placement="bottom" variant="dark">
          <button
            type="button"
            className="canvas-icon-btn"
            data-active={parseScale(layer.cssVars['--scale-x']) === -1}
            aria-label="Voltear horizontal"
            onClick={() => onChange(toggleFlip(layer, 'x'))}
          >
            <FlipHorizontal2 className="h-3.5 w-3.5" />
          </button>
        </WithHoverTooltip>
        <WithHoverTooltip label="Voltear vertical" placement="bottom" variant="dark">
          <button
            type="button"
            className="canvas-icon-btn"
            data-active={parseScale(layer.cssVars['--scale-y']) === -1}
            aria-label="Voltear vertical"
            onClick={() => onChange(toggleFlip(layer, 'y'))}
          >
            <FlipVertical2 className="h-3.5 w-3.5" />
          </button>
        </WithHoverTooltip>
        <WithHoverTooltip label="Restablecer rotación" placement="bottom" variant="dark">
          <button
            type="button"
            className="canvas-icon-btn"
            aria-label="Restablecer rotación"
            onClick={() => setVars({ '--rotate': '0deg', '--scale-x': '1', '--scale-y': '1' })}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </WithHoverTooltip>
      </div>
    </>
  );
}
