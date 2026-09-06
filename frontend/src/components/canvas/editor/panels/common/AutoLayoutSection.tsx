import CanvasSelect from '../../CanvasSelect';
import { defaultAutoLayout } from '../../../ops/autoLayout';
import type {
  AutoLayoutAlign,
  AutoLayoutDirection,
  AutoLayoutSizing,
  FrameConstraint,
  LayerAutoLayout,
} from '../../../types';
import InlineNumField from '../../InlineNumField';
import { PropRow, SectionHeader } from '../shared';
import type { SectionProps } from '../types';

const DIRECTION_OPTS: { value: AutoLayoutDirection; label: string }[] = [
  { value: 'row', label: 'Fila' },
  { value: 'col', label: 'Columna' },
];

const ALIGN_OPTS: { value: AutoLayoutAlign; label: string }[] = [
  { value: 'start', label: 'Inicio' },
  { value: 'center', label: 'Centro' },
  { value: 'end', label: 'Final' },
  { value: 'stretch', label: 'Estirar' },
];

const ALIGN_MAIN_OPTS = ALIGN_OPTS.filter((o) => o.value !== 'stretch');

const SIZING_OPTS: { value: AutoLayoutSizing; label: string }[] = [
  { value: 'hug', label: 'Ajustar' },
  { value: 'fixed', label: 'Fijo' },
];

const CONSTRAINT_OPTS: { value: FrameConstraint; label: string }[] = [
  { value: 'start', label: 'Inicio' },
  { value: 'end', label: 'Final' },
  { value: 'center', label: 'Centro' },
  { value: 'scale', label: 'Escala' },
];

function patchAutoLayout(
  current: LayerAutoLayout | undefined,
  patch: Partial<LayerAutoLayout>,
): LayerAutoLayout {
  return { ...(current ?? defaultAutoLayout()), ...patch };
}

export default function AutoLayoutSection({
  layer,
  onChange,
  mapLive,
  onCommitLive,
}: SectionProps) {
  const layout = layer.meta?.autoLayout;
  const enabled = Boolean(layout);

  const writeLayout = (next: LayerAutoLayout | undefined) => {
    if (!next) {
      const rest = { ...(layer.meta ?? {}) };
      delete rest.autoLayout;
      onChange({
        ...layer,
        meta: Object.keys(rest).length ? rest : undefined,
      });
      return;
    }
    onChange({ ...layer, meta: { ...layer.meta, autoLayout: next } });
  };

  const patchLive = (patch: Partial<LayerAutoLayout>) => {
    mapLive((l) => ({
      ...l,
      meta: {
        ...l.meta,
        autoLayout: patchAutoLayout(l.meta?.autoLayout, patch),
      },
    }));
  };

  return (
    <div className="canvas-section" data-testid="canvas-auto-layout-section">
      <SectionHeader title="Auto-layout" />
      <div className="canvas-inspector-stack">
        <div className="canvas-check-list">
          <label className="inline-flex items-center gap-2 select-none text-[11px]" style={{ color: 'var(--cv-text)' }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => writeLayout(e.target.checked ? defaultAutoLayout() : undefined)}
            />
            Apilar hijos
          </label>
        </div>
        {enabled && layout && (
          <>
            <PropRow label="Dirección">
              <CanvasSelect
                aria-label="Dirección auto-layout"
                value={layout.direction}
                onChange={(val) =>
                  writeLayout(patchAutoLayout(layout, { direction: val as AutoLayoutDirection }))
                }
                options={DIRECTION_OPTS}
              />
            </PropRow>
            <div className="flex gap-1.5">
              <InlineNumField
                prefix="Gap"
                value={layout.gapMm}
                title="Gap"
                onChange={(n) => patchLive({ gapMm: Math.max(0, n) })}
                onCommit={onCommitLive}
                suffix="mm"
              />
              <InlineNumField
                prefix="Pad"
                value={layout.padMm}
                title="Pad"
                onChange={(n) => patchLive({ padMm: Math.max(0, n) })}
                onCommit={onCommitLive}
                suffix="mm"
              />
            </div>
            <PropRow label="Principal">
              <CanvasSelect
                aria-label="Alineación principal"
                value={layout.alignMain}
                onChange={(val) =>
                  writeLayout(patchAutoLayout(layout, { alignMain: val as AutoLayoutAlign }))
                }
                options={ALIGN_MAIN_OPTS}
              />
            </PropRow>
            <PropRow label="Cruzada">
              <CanvasSelect
                aria-label="Alineación cruzada"
                value={layout.alignCross}
                onChange={(val) =>
                  writeLayout(patchAutoLayout(layout, { alignCross: val as AutoLayoutAlign }))
                }
                options={ALIGN_OPTS}
              />
            </PropRow>
            <PropRow label="Tamaño">
              <CanvasSelect
                aria-label="Tamaño auto-layout"
                value={layout.sizing}
                onChange={(val) =>
                  writeLayout(patchAutoLayout(layout, { sizing: val as AutoLayoutSizing }))
                }
                options={SIZING_OPTS}
              />
            </PropRow>
          </>
        )}
      </div>
    </div>
  );
}

export function ConstraintsSection({ layer, layers, setMeta }: SectionProps) {
  const parent = layers?.find((l) => l.id === layer.parentId);
  if (parent && parent.type !== 'frame' && parent.type !== 'group' && parent.type !== 'component') {
    return null;
  }

  return (
    <div className="canvas-section" data-testid="canvas-constraints-section">
      <SectionHeader title="Constraints" />
      <div className="canvas-inspector-stack">
        <PropRow label="Horizontal">
          <CanvasSelect
            aria-label="Constraint horizontal"
            value={layer.meta?.constraintH ?? 'start'}
            onChange={(val) => setMeta({ constraintH: val as FrameConstraint })}
            options={CONSTRAINT_OPTS}
          />
        </PropRow>
        <PropRow label="Vertical">
          <CanvasSelect
            aria-label="Constraint vertical"
            value={layer.meta?.constraintV ?? 'start'}
            onChange={(val) => setMeta({ constraintV: val as FrameConstraint })}
            options={CONSTRAINT_OPTS}
          />
        </PropRow>
      </div>
    </div>
  );
}
