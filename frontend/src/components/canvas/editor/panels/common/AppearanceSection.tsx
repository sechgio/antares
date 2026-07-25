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

export default function AppearanceSection({
  layer,
  showRadius,
  setVarLive,
  setVar,
  emitLive,
  onChange,
  onCommitLive,
}: SectionProps) {
  return (
    <div className="canvas-section">
      <SectionHeader title="Apariencia" />
      <div className="flex gap-2">
        <InlineNumField
          prefix=""
          value={Number(layer.cssVars['--opacity'] || 100)}
          onChange={(n) => setVarLive('--opacity', String(clampOpacity(n)))}
          onCommit={onCommitLive}
          suffix="%"
          title="Opacidad"
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
      <label className="mt-2 block">
        <span className="canvas-sublabel">Modo de fusión</span>
        <select
          className="canvas-input mt-1"
          value={parseBlendMode(layer.cssVars)}
          aria-label="Modo de fusión"
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'normal') {
              const next = { ...layer.cssVars };
              delete next['--blend-mode'];
              onChange({ ...layer, cssVars: next });
            } else {
              setVar('--blend-mode', v);
            }
          }}
        >
          {BLEND_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {BLEND_MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>
      {showRadius && (
        <div className="mt-2 grid grid-cols-2 gap-1">
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
  );
}
