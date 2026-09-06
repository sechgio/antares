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
import CanvasSelect from '../../CanvasSelect';
import FontPicker from '../../FontPicker';
import InlineNumField from '../../InlineNumField';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';
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

const TEXT_STYLE_TOGGLES = [
  { icon: Italic, key: '--font-style', on: 'italic', label: 'Cursiva' },
  { icon: Underline, key: '--text-decoration', on: 'underline', label: 'Subrayado' },
  { icon: Strikethrough, key: '--text-decoration', on: 'line-through', label: 'Tachado' },
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
      <div className="canvas-inspector-stack">
        {isText && (
          <textarea
            className="canvas-input !h-auto py-1.5"
            rows={3}
            value={layer.value}
            onChange={(e) => emitLive({ ...layer, value: e.target.value })}
            onBlur={() => onCommitLive?.()}
          />
        )}
        <div className="flex items-center gap-1.5">
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
        <div className="flex min-w-0 items-center gap-1.5">
          <input
            className="canvas-input min-w-0 flex-1"
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
          <div className="canvas-z-order canvas-z-order--compact shrink-0">
            {TEXT_STYLE_TOGGLES.map(({ icon: Icon, key, on, label }) => (
              <WithHoverTooltip key={on} label={label} placement="bottom" variant="dark">
                <button
                  type="button"
                  className="canvas-icon-btn"
                  aria-label={label}
                  data-active={v[key] === on}
                  onClick={() => setVar(key, v[key] === on ? '' : on)}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              </WithHoverTooltip>
            ))}
          </div>
        </div>
        <FontPicker
          value={v['--font-family'] || 'Segoe UI, Arial, sans-serif'}
          onChange={(val) => setVar('--font-family', val)}
          aria-label="Familia de fuente"
        />
        <CanvasSelect
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
        <div className="canvas-text-align-tools">
          <div role="group" aria-label="Alineación horizontal">
            {TEXT_H_ALIGN.map(({ icon: Icon, align, label }) => (
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
          <div className="canvas-text-align-tools-sep" aria-hidden />
          <div role="group" aria-label="Alineación vertical">
            {TEXT_V_ALIGN.map(({ icon: Icon, align, label }) => (
              <WithHoverTooltip key={align} label={label} placement="bottom" variant="dark">
                <button
                  type="button"
                  className="canvas-icon-btn"
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
        <div className="flex items-center gap-1.5">
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
    </div>
  );
}
