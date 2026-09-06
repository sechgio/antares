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
import type { SectionProps } from '../types';

export default function DispositionSection({
  layer,
  isLine,
  mapLive,
  setVar,
  onCommitLive,
}: SectionProps) {
  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5">
        <InlineNumField
          prefix="W"
          value={parseMm(layer.cssVars['--width'], 10)}
          onChange={(n) => mapLive((l) => resizeLayerAnchored(l, 'width', n))}
          onCommit={onCommitLive}
          step={0.1}
          suffix="mm"
        />
        <InlineNumField
          prefix="H"
          value={
            isLine
              ? Math.round(lineHeightMmFromStrokePx(lineStrokeWidthPx(layer)) * 100) / 100
              : parseMm(layer.cssVars['--height'], 10)
          }
          onChange={(n) => mapLive((l) => resizeLayerAnchored(l, 'height', n))}
          onCommit={onCommitLive}
          step={0.1}
          suffix={isLine ? undefined : 'mm'}
          title={isLine ? 'Grosor (derivado del trazo)' : undefined}
        />
        <WithHoverTooltip
          label={isAspectLocked(layer.cssVars) ? 'Desbloquear proporciones' : 'Bloquear proporciones'}
          placement="bottom"
          variant="dark"
        >
          <button
            type="button"
            className="canvas-icon-btn shrink-0"
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
      </div>
      <div className="canvas-resize-anchor-row">
        <span className="canvas-sublabel">Anclaje</span>
        <WithHoverTooltip label="Anclaje de redimensión" placement="bottom" variant="dark">
          <div
            className="canvas-resize-anchor"
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
                  data-active={active}
                  className="canvas-resize-anchor-cell"
                  onClick={() => setVar('--resize-anchor', anchor)}
                />
              );
            })}
          </div>
        </WithHoverTooltip>
      </div>
    </>
  );
}
