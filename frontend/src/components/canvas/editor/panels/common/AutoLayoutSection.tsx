import CanvasSelect from '../../CanvasSelect';
import { defaultAutoLayout } from '../../../ops/autoLayout';
import type {
  AutoLayoutAlign,
  AutoLayoutDirection,
  AutoLayoutSizing,
  FrameConstraint,
  LayerAutoLayout,
} from '../../../types';
import { NumField, SectionHeader } from '../shared';
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

/** Auto-layout controls for frame/group containers. */
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
    // Commit path so applyContainerLayoutPanelEffects can relayout children.
    onChange({ ...layer, meta: { ...layer.meta, autoLayout: next } });
  };

  const patchLive = (patch: Partial<LayerAutoLayout>) => {
    // Use mapLive so rapid gap/pad edits merge against the latest live layer,
    // not stale React props.
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
      <label className="mb-2 flex items-center gap-2 text-[12px]" style={{ color: 'var(--cv-text)' }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => writeLayout(e.target.checked ? defaultAutoLayout() : undefined)}
        />
        Apilar hijos
      </label>
      {enabled && layout && (
        <>
          <div className="mb-2">
            <span className="canvas-sublabel">Dirección</span>
            <CanvasSelect
              aria-label="Dirección auto-layout"
              value={layout.direction}
              onChange={(val) =>
                writeLayout(patchAutoLayout(layout, { direction: val as AutoLayoutDirection }))
              }
              options={DIRECTION_OPTS}
            />
          </div>
          <div className="mb-2 flex gap-2">
            <NumField
              label="Gap"
              value={layout.gapMm}
              onChange={(n) => patchLive({ gapMm: Math.max(0, n) })}
              onCommit={onCommitLive}
              suffix="mm"
            />
            <NumField
              label="Pad"
              value={layout.padMm}
              onChange={(n) => patchLive({ padMm: Math.max(0, n) })}
              onCommit={onCommitLive}
              suffix="mm"
            />
          </div>
          <div className="mb-2">
            <span className="canvas-sublabel">Alineación principal</span>
            <CanvasSelect
              aria-label="Alineación principal"
              value={layout.alignMain}
              onChange={(val) =>
                writeLayout(patchAutoLayout(layout, { alignMain: val as AutoLayoutAlign }))
              }
              options={ALIGN_MAIN_OPTS}
            />
          </div>
          <div className="mb-2">
            <span className="canvas-sublabel">Alineación cruzada</span>
            <CanvasSelect
              aria-label="Alineación cruzada"
              value={layout.alignCross}
              onChange={(val) =>
                writeLayout(patchAutoLayout(layout, { alignCross: val as AutoLayoutAlign }))
              }
              options={ALIGN_OPTS}
            />
          </div>
          <div>
            <span className="canvas-sublabel">Tamaño</span>
            <CanvasSelect
              aria-label="Tamaño auto-layout"
              value={layout.sizing}
              onChange={(val) =>
                writeLayout(patchAutoLayout(layout, { sizing: val as AutoLayoutSizing }))
              }
              options={SIZING_OPTS}
            />
          </div>
        </>
      )}
    </div>
  );
}

/** Parent-relative constraints for children nested under a frame/group. */
export function ConstraintsSection({ layer, layers, setMeta }: SectionProps) {
  const parent = layers?.find((l) => l.id === layer.parentId);
  if (parent && parent.type !== 'frame' && parent.type !== 'group' && parent.type !== 'component') {
    return null;
  }

  return (
    <div className="canvas-section" data-testid="canvas-constraints-section">
      <SectionHeader title="Constraints" />
      <div className="mb-2">
        <span className="canvas-sublabel">Horizontal</span>
        <CanvasSelect
          aria-label="Constraint horizontal"
          value={layer.meta?.constraintH ?? 'start'}
          onChange={(val) => setMeta({ constraintH: val as FrameConstraint })}
          options={CONSTRAINT_OPTS}
        />
      </div>
      <div>
        <span className="canvas-sublabel">Vertical</span>
        <CanvasSelect
          aria-label="Constraint vertical"
          value={layer.meta?.constraintV ?? 'start'}
          onChange={(val) => setMeta({ constraintV: val as FrameConstraint })}
          options={CONSTRAINT_OPTS}
        />
      </div>
    </div>
  );
}
