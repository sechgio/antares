import { useMemo, useState } from 'react';
import CanvasSelect from '../../CanvasSelect';
import { composeBoolean, type BooleanOpKind } from '../../../ops/booleanOps';
import { isShapeLayer } from '../../../ops/layerStyle';
import type { CanvasLayer } from '../../../types';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

const OP_OPTS: { value: BooleanOpKind; label: string }[] = [
  { value: 'union', label: 'Unión' },
  { value: 'subtract', label: 'Restar' },
  { value: 'intersect', label: 'Intersección' },
  { value: 'exclude', label: 'Excluir' },
];

function clearMetaKey(layer: CanvasLayer, key: 'maskLayerId' | 'ops'): CanvasLayer {
  const meta = { ...(layer.meta ?? {}) };
  delete meta[key];
  return { ...layer, meta: Object.keys(meta).length ? meta : undefined };
}

/**
 * Mask + boolean composition controls.
 * Boolean ops are CSS visual composition (clip/blend/stack), not a geometric solver.
 */
export default function BooleanMaskSection({
  layer,
  layers = [],
  selectedIds = [],
  onChange,
  setMeta,
}: SectionProps) {
  const [combineTargetId, setCombineTargetId] = useState('');
  const [combineOp, setCombineOp] = useState<BooleanOpKind>('union');

  const maskCandidates = useMemo(
    () => layers.filter((l) => l.id !== layer.id && l.visible !== false),
    [layers, layer.id],
  );

  const selectedOthers = useMemo(
    () =>
      selectedIds
        .filter((id) => id !== layer.id)
        .map((id) => layers.find((l) => l.id === id))
        .filter((l): l is CanvasLayer => Boolean(l)),
    [selectedIds, layer.id, layers],
  );

  const ops = layer.meta?.ops ?? [];
  const isBoolean = layer.type === 'boolean';
  const maskId = layer.meta?.maskLayerId ?? '';

  const applyMask = (maskLayerId: string) => {
    if (!maskLayerId) {
      onChange(clearMetaKey(layer, 'maskLayerId'));
      return;
    }
    setMeta({ maskLayerId });
  };

  const combineWith = (operands: CanvasLayer[], op: BooleanOpKind) => {
    if (!operands.length) return;
    const next = composeBoolean(
      layer,
      operands.map((operand) => ({ layer: operand, op })),
    );
    onChange(next);
  };

  const setOpAt = (index: number, op: BooleanOpKind) => {
    const nextOps = ops.map((entry, i) => (i === index ? { ...entry, op } : entry));
    setMeta({ ops: nextOps });
  };

  return (
    <div className="canvas-section" data-testid="canvas-boolean-mask-section">
      <SectionHeader title="Máscara / Booleana" />
      <p className="canvas-sublabel mb-2">
        Composición CSS (recorte/combinación visual). No es un solver geométrico exacto.
      </p>

      <div className="mb-2">
        <span className="canvas-sublabel">Usar como máscara</span>
        <CanvasSelect
          aria-label="Capa máscara"
          value={maskId}
          onChange={(val) => applyMask(val)}
          options={[
            { value: '', label: 'Ninguna' },
            ...maskCandidates.map((l) => ({
              value: l.id,
              label: l.name || l.type,
            })),
          ]}
        />
      </div>

      {!isBoolean && (
        <div className="mb-2">
          <span className="canvas-sublabel">Combinar con</span>
          {selectedOthers.length > 0 ? (
            <button
              type="button"
              className="canvas-btn mb-2 w-full rounded-md px-3 py-2 text-[12px]"
              onClick={() => combineWith(selectedOthers, combineOp)}
            >
              Combinar selección ({selectedOthers.length})
            </button>
          ) : null}
          <div className="mb-1 flex gap-1">
            <div className="min-w-0 flex-1">
              <CanvasSelect
                aria-label="Capa a combinar"
                value={combineTargetId}
                onChange={setCombineTargetId}
                options={[
                  { value: '', label: 'Elegir capa…' },
                  ...maskCandidates.map((l) => ({
                    value: l.id,
                    label: l.name || l.type,
                  })),
                ]}
              />
            </div>
            <div className="w-[110px] shrink-0">
              <CanvasSelect
                aria-label="Operación booleana"
                value={combineOp}
                onChange={(val) => setCombineOp(val as BooleanOpKind)}
                options={OP_OPTS}
              />
            </div>
          </div>
          <button
            type="button"
            className="canvas-btn w-full rounded-md px-3 py-2 text-[12px]"
            disabled={!combineTargetId}
            onClick={() => {
              const other = layers.find((l) => l.id === combineTargetId);
              if (!other) return;
              combineWith([other], combineOp);
              setCombineTargetId('');
            }}
          >
            Combinar
          </button>
        </div>
      )}

      {isBoolean && ops.length > 0 && (
        <div className="mb-1">
          <span className="canvas-sublabel">Operandos</span>
          <ul className="mt-1 space-y-1">
            {ops.map((entry, index) => {
              const src = layers.find((l) => l.id === entry.layerId);
              return (
                <li key={`${entry.layerId}-${index}`} className="flex items-center gap-1">
                  <span
                    className="min-w-0 flex-1 truncate text-[11px]"
                    style={{ color: 'var(--cv-text)' }}
                    title={entry.layerId}
                  >
                    {src?.name || entry.layerId.slice(0, 8)}
                  </span>
                  <div className="w-[110px] shrink-0">
                    <CanvasSelect
                      aria-label={`Operación ${index + 1}`}
                      value={entry.op}
                      onChange={(val) => setOpAt(index, val as BooleanOpKind)}
                      options={OP_OPTS}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Shapes, images, and boolean layers can participate in mask/boolean composition. */
export function showBooleanMaskSection(layer: CanvasLayer): boolean {
  return (
    layer.type === 'boolean' ||
    layer.type === 'image' ||
    layer.type === 'imageSlot' ||
    isShapeLayer(layer) ||
    Boolean(layer.meta?.maskLayerId) ||
    Boolean(layer.meta?.ops?.length)
  );
}
