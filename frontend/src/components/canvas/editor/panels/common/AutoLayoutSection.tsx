import { useEffect, useState } from 'react';
import CanvasSelect from '../../CanvasSelect';
import { defaultAutoLayout } from '../../../ops/autoLayout';
import type {
  AutoLayoutAlign,
  AutoLayoutDirection,
  AutoLayoutSizing,
  ChildLayoutSizing,
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

const CHILD_SIZING_OPTS: { value: ChildLayoutSizing; label: string }[] = [
  { value: 'fixed', label: 'Fijo' },
  { value: 'hug', label: 'Ajustar' },
  { value: 'fill', label: 'Llenar (Fill)' },
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

  const hasAsymmetricPads = Boolean(
    layout &&
      (layout.padTopMm != null ||
        layout.padRightMm != null ||
        layout.padBottomMm != null ||
        layout.padLeftMm != null),
  );
  const [independentPad, setIndependentPad] = useState(hasAsymmetricPads);

  useEffect(() => {
    setIndependentPad(hasAsymmetricPads);
  }, [layer.id, hasAsymmetricPads]);

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

  const toggleIndependentPad = () => {
    const next = !independentPad;
    setIndependentPad(next);
    if (!next && layout) {
      const uniform = layout.padMm ?? 4;
      writeLayout({
        ...layout,
        padMm: uniform,
        padTopMm: undefined,
        padRightMm: undefined,
        padBottomMm: undefined,
        padLeftMm: undefined,
      });
    }
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
            <div className="canvas-check-list">
              <label className="inline-flex items-center gap-2 select-none text-[11px]" style={{ color: 'var(--cv-text)' }}>
                <input
                  type="checkbox"
                  checked={Boolean(layout.wrap)}
                  onChange={(e) => writeLayout(patchAutoLayout(layout, { wrap: e.target.checked }))}
                />
                Salto de línea (Wrap)
              </label>
            </div>
            <div className="flex items-center gap-1.5">
              <InlineNumField
                prefix="Gap"
                value={layout.gapMm}
                title="Espaciado principal"
                onChange={(n) => patchLive({ gapMm: Math.max(0, n) })}
                onCommit={onCommitLive}
                suffix="mm"
              />
              {!independentPad ? (
                <InlineNumField
                  prefix="Pad"
                  value={layout.padMm}
                  title="Padding uniforme"
                  onChange={(n) => patchLive({ padMm: Math.max(0, n) })}
                  onCommit={onCommitLive}
                  suffix="mm"
                />
              ) : null}
              <button
                type="button"
                className="inline-flex items-center justify-center p-1 rounded hover:bg-[var(--cv-hover)] select-none text-[11px] text-[var(--cv-text-muted)] hover:text-[var(--cv-text)]"
                title={independentPad ? 'Usar padding uniforme' : 'Configurar padding por lados independientes'}
                onClick={toggleIndependentPad}
                style={{ height: 24, minWidth: 24 }}
              >
                {independentPad ? '⊟' : '⛶'}
              </button>
            </div>
            {independentPad && (
              <div className="grid grid-cols-4 gap-1">
                <InlineNumField
                  prefix="T"
                  value={layout.padTopMm ?? layout.padMm}
                  title="Padding superior"
                  onChange={(n) => patchLive({ padTopMm: Math.max(0, n) })}
                  onCommit={onCommitLive}
                  suffix="mm"
                />
                <InlineNumField
                  prefix="R"
                  value={layout.padRightMm ?? layout.padMm}
                  title="Padding derecho"
                  onChange={(n) => patchLive({ padRightMm: Math.max(0, n) })}
                  onCommit={onCommitLive}
                  suffix="mm"
                />
                <InlineNumField
                  prefix="B"
                  value={layout.padBottomMm ?? layout.padMm}
                  title="Padding inferior"
                  onChange={(n) => patchLive({ padBottomMm: Math.max(0, n) })}
                  onCommit={onCommitLive}
                  suffix="mm"
                />
                <InlineNumField
                  prefix="L"
                  value={layout.padLeftMm ?? layout.padMm}
                  title="Padding izquierdo"
                  onChange={(n) => patchLive({ padLeftMm: Math.max(0, n) })}
                  onCommit={onCommitLive}
                  suffix="mm"
                />
              </div>
            )}
            {layout.wrap && (
              <PropRow label="Gap cruzado">
                <InlineNumField
                  prefix="Cross"
                  value={layout.crossGapMm ?? layout.gapMm}
                  title="Espaciado transversal entre líneas"
                  onChange={(n) => patchLive({ crossGapMm: Math.max(0, n) })}
                  onCommit={onCommitLive}
                  suffix="mm"
                />
              </PropRow>
            )}
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

  if (parent?.meta?.autoLayout) {
    const isRow = parent.meta.autoLayout.direction === 'row';
    const mainLabel = isRow ? 'Ancho (Principal)' : 'Alto (Principal)';
    const crossLabel = isRow ? 'Alto (Cruzado)' : 'Ancho (Cruzado)';
    return (
      <div className="canvas-section" data-testid="canvas-constraints-section">
        <SectionHeader title="Resizing (Auto-layout)" />
        <div className="canvas-inspector-stack">
          <PropRow label={mainLabel}>
            <CanvasSelect
              aria-label="Dimensionamiento principal"
              value={layer.meta?.layoutSizingMain ?? 'fixed'}
              onChange={(val) => setMeta({ layoutSizingMain: val as ChildLayoutSizing })}
              options={CHILD_SIZING_OPTS}
            />
          </PropRow>
          <PropRow label={crossLabel}>
            <CanvasSelect
              aria-label="Dimensionamiento cruzado"
              value={layer.meta?.layoutSizingCross ?? 'fixed'}
              onChange={(val) => setMeta({ layoutSizingCross: val as ChildLayoutSizing })}
              options={CHILD_SIZING_OPTS}
            />
          </PropRow>
        </div>
      </div>
    );
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
