import { Link2, Link2Off } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { parseMm } from '../../../types';
import {
  isAspectLocked,
  lineHeightMmFromStrokePx,
  lineStrokeWidthPx,
} from '../../../ops/layerStyle';
import {
  parseResizeAnchor,
  resizeLayerAnchored,
  RESIZE_ANCHORS,
  type ResizeAnchor,
} from '../../../ops/resizeConstraints';
import InlineNumField from '../../InlineNumField';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

export default function DispositionSection({
  layer,
  isLine,
  emitLive,
  setVar,
  onCommitLive,
}: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Disposición" />
      <span className="canvas-sublabel">Dimensiones</span>
      <div className="flex items-center gap-1">
        <InlineNumField
          prefix="W"
          value={parseMm(layer.cssVars['--width'], 10)}
          onChange={(n) => emitLive(resizeLayerAnchored(layer, 'width', n))}
          onCommit={onCommitLive}
        />
        <InlineNumField
          prefix="H"
          value={
            isLine
              ? Math.round(lineHeightMmFromStrokePx(lineStrokeWidthPx(layer)) * 100) / 100
              : parseMm(layer.cssVars['--height'], 10)
          }
          onChange={(n) => emitLive(resizeLayerAnchored(layer, 'height', n))}
          onCommit={onCommitLive}
          title={isLine ? 'Grosor (derivado del trazo)' : undefined}
        />
        <WithHoverTooltip
          label={isAspectLocked(layer.cssVars) ? 'Desbloquear proporciones' : 'Bloquear proporciones'}
          placement="bottom"
          variant="dark"
        >
          <button
            type="button"
            className="canvas-icon-btn !h-7 !w-7 shrink-0"
            data-active={isAspectLocked(layer.cssVars)}
            aria-label="Proporciones"
            onClick={() => setVar('--aspect-locked', isAspectLocked(layer.cssVars) ? '0' : '1')}
          >
            {isAspectLocked(layer.cssVars) ? (
              <Link2 className="h-3.5 w-3.5" />
            ) : (
              <Link2Off className="h-3.5 w-3.5" />
            )}
          </button>
        </WithHoverTooltip>
        <WithHoverTooltip label="Anclaje de redimensión" placement="bottom" variant="dark">
          <div
            className="ml-0.5 grid shrink-0 grid-cols-3 gap-px"
            role="radiogroup"
            aria-label="Anclaje de redimensión"
          >
            {RESIZE_ANCHORS.map((anchor: ResizeAnchor) => {
              const active = parseResizeAnchor(layer.cssVars['--resize-anchor']) === anchor;
              return (
                <button
                  key={anchor}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`Anclar ${anchor}`}
                  className="flex h-3 w-3 items-center justify-center rounded-[2px] border"
                  style={{
                    borderColor: active ? 'var(--cv-accent)' : 'var(--cv-border)',
                    background: active ? 'var(--cv-accent)' : 'transparent',
                  }}
                  onClick={() => setVar('--resize-anchor', anchor)}
                >
                  <span
                    className="h-1 w-1 rounded-full"
                    style={{ background: active ? '#fff' : 'var(--cv-text-muted)' }}
                  />
                </button>
              );
            })}
          </div>
        </WithHoverTooltip>
      </div>
    </div>
  );
}
