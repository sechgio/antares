import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

import CanvasSelect from '../../CanvasSelect';

/** Text inspector — matches `text` and `field`. The textarea only renders for
 *  `text`; `field` shows the color/family/align controls but no editable value
 *  (its value comes from the Excel binding, edited in FieldSection). */
export default function TextSection({
  layer,
  emitLive,
  onCommitLive,
  setVar,
  setVarLive,
}: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Texto" />
      {layer.type === 'text' && (
        <textarea
          className="canvas-input mb-2 !h-auto py-1.5"
          rows={3}
          value={layer.value}
          onChange={(e) => emitLive({ ...layer, value: e.target.value })}
          onBlur={() => onCommitLive?.()}
        />
      )}
      <div className="mb-2 flex items-center gap-2">
        <input
          type="color"
          className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent"
          value={layer.cssVars['--color'] || '#1e1e1e'}
          onChange={(e) => setVarLive('--color', e.target.value)}
          onBlur={() => onCommitLive?.()}
        />
        <input
          className="canvas-input"
          value={layer.cssVars['--font-size'] || '11pt'}
          onChange={(e) => setVarLive('--font-size', e.target.value)}
          onBlur={() => onCommitLive?.()}
          placeholder="11pt"
        />
      </div>
      <CanvasSelect
        className="mb-2"
        value={layer.cssVars['--font-weight'] || '400'}
        onChange={(val) => setVar('--font-weight', val)}
        aria-label="Peso de fuente"
        options={[
          { value: '400', label: 'Regular' },
          { value: '500', label: 'Medium' },
          { value: '600', label: 'Semibold' },
          { value: '700', label: 'Bold' },
        ]}
      />
      <CanvasSelect
        className="mb-2"
        value={layer.cssVars['--font-family'] || 'Segoe UI, Arial, sans-serif'}
        onChange={(val) => setVar('--font-family', val)}
        aria-label="Familia de fuente"
        options={[
          { value: 'Segoe UI, Arial, sans-serif', label: 'Segoe UI' },
          { value: 'Arial, sans-serif', label: 'Arial' },
          { value: 'Georgia, serif', label: 'Georgia' },
          { value: 'Consolas, monospace', label: 'Consolas' },
        ]}
      />
      <div className="mb-2 flex gap-1">
        {[
          { icon: AlignLeft, align: 'left', label: 'Alinear izquierda' },
          { icon: AlignCenter, align: 'center', label: 'Alinear centro' },
          { icon: AlignRight, align: 'right', label: 'Alinear derecha' },
        ].map(({ icon: Icon, align, label }) => (
          <WithHoverTooltip key={align} label={label} placement="bottom" variant="dark">
            <button
              type="button"
              className="canvas-icon-btn"
              aria-label={label}
              data-active={layer.cssVars['--text-align'] === align}
              onClick={() => setVar('--text-align', align)}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          </WithHoverTooltip>
        ))}
      </div>
      <input
        className="canvas-input"
        placeholder="Line height (ej. 1.2)"
        value={layer.cssVars['--line-height'] || ''}
        onChange={(e) => setVarLive('--line-height', e.target.value)}
        onBlur={() => onCommitLive?.()}
      />
    </div>
  );
}
