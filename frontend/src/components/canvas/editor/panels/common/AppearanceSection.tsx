import {
  BLEND_MODES,
  BLEND_MODE_LABELS,
  clampOpacity,
  cornerRadiusPx,
  parseBlendMode,
  type CornerId,
} from '../../../ops/layerStyle';
import InlineNumField from '../../InlineNumField';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';
import CanvasSelect from '../../CanvasSelect';

export default function AppearanceSection({
  layer,
  selectedIds = [],
  showRadius,
  setVarLive,
  setVar,
  onChange,
  onCommitLive,
}: SectionProps) {
  const multi = selectedIds.length > 1;
  return (
    <div className="canvas-section">
      <SectionHeader title="Apariencia" />
      <div className="canvas-inspector-stack">
        <div className="flex gap-1.5">
          {multi ? null : (
            <InlineNumField
              prefix=""
              value={Number(layer.cssVars['--opacity'] || 100)}
              onChange={(n) => setVarLive('--opacity', String(clampOpacity(n)))}
              onCommit={onCommitLive}
              suffix="%"
              title="Opacidad"
            />
          )}
          <CanvasSelect
            value={parseBlendMode(layer.cssVars)}
            aria-label="Modo de fusión"
            onChange={(v) => {
              if (v === 'normal') {
                const next = { ...layer.cssVars };
                delete next['--blend-mode'];
                onChange({ ...layer, cssVars: next });
              } else {
                setVar('--blend-mode', v);
              }
            }}
            options={BLEND_MODES.map((mode) => ({
              value: mode,
              label: BLEND_MODE_LABELS[mode],
            }))}
          />
        </div>
        {showRadius && (
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ['tl', 'TL'],
                ['tr', 'TR'],
                ['bl', 'BL'],
                ['br', 'BR'],
              ] as Array<[CornerId, string]>
            ).map(([corner, label]) => (
              <InlineNumField
                key={corner}
                prefix={label}
                value={cornerRadiusPx(layer.cssVars, corner)}
                onChange={(n) => setVarLive(`--radius-${corner}`, `${Math.max(0, n)}px`)}
                onCommit={onCommitLive}
                title={`Radio ${label}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
