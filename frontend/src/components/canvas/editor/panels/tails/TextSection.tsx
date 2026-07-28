import { AlignCenter, AlignLeft, AlignRight, Italic, Strikethrough, Underline } from 'lucide-react';
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
  const isText = layer.type === 'text';
  const v = layer.cssVars;
  return (
    <div className="canvas-section">
      <SectionHeader title="Texto" />
      {isText && (
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
          value={v['--color'] || '#1e1e1e'}
          onChange={(e) => setVarLive('--color', e.target.value)}
          onBlur={() => onCommitLive?.()}
        />
        <input
          className="canvas-input"
          value={v['--font-size'] || '11pt'}
          onChange={(e) => setVarLive('--font-size', e.target.value)}
          onBlur={() => onCommitLive?.()}
          placeholder="11pt"
        />
      </div>
      <div className="mb-2 flex items-center gap-2">
        <input
          className="canvas-input"
          type="number"
          min={100}
          max={900}
          step={100}
          value={v['--font-weight'] || '400'}
          onChange={(e) => setVarLive('--font-weight', e.target.value)}
          onBlur={() => onCommitLive?.()}
          aria-label="Peso de fuente"
          placeholder="400"
        />
        <WithHoverTooltip label="Cursiva" placement="bottom" variant="dark">
          <button
            type="button"
            className="canvas-icon-btn"
            aria-label="Cursiva"
            data-active={v['--font-style'] === 'italic'}
            onClick={() => setVar('--font-style', v['--font-style'] === 'italic' ? '' : 'italic')}
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
        </WithHoverTooltip>
        <WithHoverTooltip label="Subrayado" placement="bottom" variant="dark">
          <button
            type="button"
            className="canvas-icon-btn"
            aria-label="Subrayado"
            data-active={v['--text-decoration'] === 'underline'}
            onClick={() =>
              setVar('--text-decoration', v['--text-decoration'] === 'underline' ? '' : 'underline')
            }
          >
            <Underline className="h-3.5 w-3.5" />
          </button>
        </WithHoverTooltip>
        <WithHoverTooltip label="Tachado" placement="bottom" variant="dark">
          <button
            type="button"
            className="canvas-icon-btn"
            aria-label="Tachado"
            data-active={v['--text-decoration'] === 'line-through'}
            onClick={() =>
              setVar(
                '--text-decoration',
                v['--text-decoration'] === 'line-through' ? '' : 'line-through',
              )
            }
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </button>
        </WithHoverTooltip>
      </div>
      <CanvasSelect
        className="mb-2"
        value={v['--font-family'] || 'Segoe UI, Arial, sans-serif'}
        onChange={(val) => setVar('--font-family', val)}
        aria-label="Familia de fuente"
        options={[
          { value: 'Segoe UI, Arial, sans-serif', label: 'Segoe UI' },
          { value: 'Arial, sans-serif', label: 'Arial' },
          { value: 'Georgia, serif', label: 'Georgia' },
          { value: 'Consolas, monospace', label: 'Consolas' },
        ]}
      />
      <CanvasSelect
        className="mb-2"
        value={v['--text-transform'] || 'none'}
        onChange={(val) => setVar('--text-transform', val)}
        aria-label="Transformación de texto"
        options={[
          { value: 'none', label: 'Sin transformar' },
          { value: 'uppercase', label: 'Mayúsculas' },
          { value: 'lowercase', label: 'Minúsculas' },
          { value: 'capitalize', label: 'Capitalizar' },
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
              data-active={v['--text-align'] === align}
              onClick={() => setVar('--text-align', align)}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          </WithHoverTooltip>
        ))}
      </div>
      <div className="mb-2 flex gap-1">
        {[
          { align: 'flex-start', label: 'Alinear arriba' },
          { align: 'center', label: 'Alinear al centro vertical' },
          { align: 'flex-end', label: 'Alinear abajo' },
        ].map(({ align, label }) => (
          <WithHoverTooltip key={align} label={label} placement="bottom" variant="dark">
            <button
              type="button"
              className="canvas-icon-btn flex-1"
              aria-label={label}
              data-active={(v['--text-valign'] || 'center') === align}
              onClick={() => setVar('--text-valign', align)}
            >
              <span className="text-[10px] font-medium">
                {align === 'flex-start' ? 'Sup' : align === 'center' ? 'Med' : 'Inf'}
              </span>
            </button>
          </WithHoverTooltip>
        ))}
      </div>
      <div className="mb-2 flex items-center gap-2">
        <input
          className="canvas-input"
          placeholder="Interletra (ej. 0.5px)"
          value={v['--letter-spacing'] || ''}
          onChange={(e) => setVarLive('--letter-spacing', e.target.value)}
          onBlur={() => onCommitLive?.()}
        />
        <input
          className="canvas-input"
          placeholder="Line height (ej. 1.2)"
          value={v['--line-height'] || ''}
          onChange={(e) => setVarLive('--line-height', e.target.value)}
          onBlur={() => onCommitLive?.()}
        />
      </div>
    </div>
  );
}
