import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Italic,
  Strikethrough,
  Underline,
} from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

import CanvasSelect from '../../CanvasSelect';
import FontPicker from '../../FontPicker';
import InlineNumField from '../../InlineNumField';
import {
  formatFontSizePt,
  formatLetterSpacingPx,
  formatLineHeight,
  parseFontSizePt,
  parseLetterSpacingPx,
  parseLineHeight,
} from '../../../ops/textTypography';

const TEXT_H_ALIGN = [
  { icon: AlignLeft, align: 'left', label: 'Alinear izquierda' },
  { icon: AlignCenter, align: 'center', label: 'Alinear centro' },
  { icon: AlignRight, align: 'right', label: 'Alinear derecha' },
] as const;

const TEXT_V_ALIGN = [
  { icon: AlignVerticalJustifyStart, align: 'flex-start', label: 'Alinear arriba' },
  { icon: AlignVerticalJustifyCenter, align: 'center', label: 'Alinear al centro vertical' },
  { icon: AlignVerticalJustifyEnd, align: 'flex-end', label: 'Alinear abajo' },
] as const;

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
          className="h-7 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent"
          value={v['--color'] || '#1e1e1e'}
          onChange={(e) => setVarLive('--color', e.target.value)}
          onBlur={() => onCommitLive?.()}
        />
        <InlineNumField
          prefix="Aa"
          value={parseFontSizePt(v['--font-size'])}
          onChange={(n) => setVarLive('--font-size', formatFontSizePt(Math.max(1, n)))}
          onCommit={onCommitLive}
          step={1}
          title="Tamaño de fuente"
          suffix="pt"
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
      <FontPicker
        className="mb-2"
        value={v['--font-family'] || 'Segoe UI, Arial, sans-serif'}
        onChange={(val) => setVar('--font-family', val)}
        aria-label="Familia de fuente"
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
      <span className="canvas-sublabel">Alineación</span>
      <div className="mb-2 flex items-stretch gap-1">
        <div className="flex min-w-0 flex-1 gap-0.5" role="group" aria-label="Alineación horizontal">
          {TEXT_H_ALIGN.map(({ icon: Icon, align, label }) => (
            <WithHoverTooltip key={align} label={label} placement="bottom" variant="dark">
              <button
                type="button"
                className="canvas-icon-btn !h-8 !w-auto min-w-0 flex-1"
                aria-label={label}
                data-active={v['--text-align'] === align}
                onClick={() => setVar('--text-align', align)}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            </WithHoverTooltip>
          ))}
        </div>
        <div
          className="mx-0.5 w-px shrink-0 self-stretch"
          style={{ background: 'var(--cv-border)' }}
          aria-hidden
        />
        <div className="flex min-w-0 flex-1 gap-0.5" role="group" aria-label="Alineación vertical">
          {TEXT_V_ALIGN.map(({ icon: Icon, align, label }) => (
            <WithHoverTooltip key={align} label={label} placement="bottom" variant="dark">
              <button
                type="button"
                className="canvas-icon-btn !h-8 !w-auto min-w-0 flex-1"
                aria-label={label}
                data-active={(v['--text-valign'] || 'center') === align}
                onClick={() => setVar('--text-valign', align)}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            </WithHoverTooltip>
          ))}
        </div>
      </div>
      <div className="mb-2 flex items-center gap-2">
        <InlineNumField
          prefix="LS"
          value={parseLetterSpacingPx(v['--letter-spacing'])}
          onChange={(n) => setVarLive('--letter-spacing', formatLetterSpacingPx(n))}
          onCommit={onCommitLive}
          step={0.1}
          title="Interletra"
          suffix="px"
        />
        <InlineNumField
          prefix="↕"
          value={parseLineHeight(v['--line-height'])}
          onChange={(n) => setVarLive('--line-height', formatLineHeight(Math.max(0.5, n)))}
          onCommit={onCommitLive}
          step={0.05}
          title="Interlineado"
        />
      </div>
    </div>
  );
}
