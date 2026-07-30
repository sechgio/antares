import { FlipHorizontal2, FlipVertical2, RotateCcw } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { mm, parseMm } from '../../../types';
import { parseScale, toggleFlip } from '../../../ops/layerStyle';
import InlineNumField from '../../InlineNumField';
import { ALIGN_ITEMS, SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function PositionSection({
  layer,
  setVarLive,
  setVars,
  onChange,
  onCommitLive,
  onAlign,
}: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Posición" />
      <span className="canvas-sublabel">Alineación</span>
      <div className="mb-3 flex flex-wrap gap-1">
        {ALIGN_ITEMS.map(({ align, icon: Icon, label }) => (
          <WithHoverTooltip key={align} label={label} placement="bottom" variant="dark">
            <button
              type="button"
              className="canvas-icon-btn !h-7 !w-7"
              aria-label={label}
              onClick={() => onAlign(align)}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          </WithHoverTooltip>
        ))}
      </div>
      <div className="flex gap-2">
        <InlineNumField
          prefix="X"
          value={parseMm(layer.cssVars['--translate-x'])}
          onChange={(n) => setVarLive('--translate-x', mm(n))}
          onCommit={onCommitLive}
          step={0.1}
          suffix="mm"
        />
        <InlineNumField
          prefix="Y"
          value={parseMm(layer.cssVars['--translate-y'])}
          onChange={(n) => setVarLive('--translate-y', mm(n))}
          onCommit={onCommitLive}
          step={0.1}
          suffix="mm"
        />
      </div>
      <div className="mt-3 flex items-center gap-1">
        <InlineNumField
          prefix=""
          value={parseFloat(layer.cssVars['--rotate'] || '0') || 0}
          onChange={(n) => setVarLive('--rotate', `${n}deg`)}
          onCommit={onCommitLive}
          suffix="°"
          title="Rotación"
        />
        <WithHoverTooltip label="Voltear horizontal" placement="bottom" variant="dark">
          <button
            type="button"
            className="canvas-icon-btn !h-7 !w-7"
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
            className="canvas-icon-btn !h-7 !w-7"
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
            className="canvas-icon-btn !h-7 !w-7"
            aria-label="Restablecer rotación"
            onClick={() => setVars({ '--rotate': '0deg', '--scale-x': '1', '--scale-y': '1' })}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </WithHoverTooltip>
      </div>
    </div>
  );
}
