import { useMemo, useState, type ComponentType } from 'react';
import { Ban, CircleDot, Combine, SquareMinus } from 'lucide-react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import CanvasSelect from '../../CanvasSelect';
import { applyBooleanCompose, composeBoolean, type BooleanOpKind } from '../../../ops/booleanOps';
import { isShapeLayer } from '../../../ops/layerStyle';
import type { CanvasLayer } from '../../../types';
import { PropRow, SectionHeader } from '../shared';
import type { SectionProps } from '../types';

const OP_OPTS: { value: BooleanOpKind; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { value: 'union', label: 'Unión', icon: Combine },
  { value: 'subtract', label: 'Restar', icon: SquareMinus },
  { value: 'intersect', label: 'Intersección', icon: CircleDot },
  { value: 'exclude', label: 'Excluir', icon: Ban },
];

function clearMetaKey(layer: CanvasLayer, key: 'maskLayerId' | 'ops'): CanvasLayer {
  const meta = { ...(layer.meta ?? {}) };
  delete meta[key];
  return { ...layer, meta: Object.keys(meta).length ? meta : undefined };
}

export default function BooleanMaskSection({
  layer,
  layers = [],
  selectedIds = [],
  onChange,
  onReplaceLayers,
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
    if (onReplaceLayers) {
      const nextTarget = { ...layer, meta: { ...layer.meta, maskLayerId } };
      onReplaceLayers(
        layers.map((l) => {
          if (l.id === nextTarget.id) return nextTarget;
          if (l.id === maskLayerId) return { ...l, visible: false };
          return l;
        }),
      );
      return;
    }
    setMeta({ maskLayerId });
  };

  const combineWith = (operands: CanvasLayer[], op: BooleanOpKind) => {
    if (!operands.length) return;
    const entries = operands.map((operand) => ({ layer: operand, op }));
    if (onReplaceLayers) {
      onReplaceLayers(applyBooleanCompose(layers, layer, entries));
      return;
    }
    onChange(composeBoolean(layer, entries));
  };

  const setOpAt = (index: number, op: BooleanOpKind) => {
    const nextOps = ops.map((entry, i) => (i === index ? { ...entry, op } : entry));
    setMeta({ ops: nextOps });
  };

  const canCombine = selectedOthers.length > 0 || Boolean(combineTargetId);

  const applyOp = (op: BooleanOpKind) => {
    setCombineOp(op);
    if (selectedOthers.length > 0) {
      combineWith(selectedOthers, op);
      return;
    }
    const other = layers.find((item) => item.id === combineTargetId);
    if (!other) return;
    combineWith([other], op);
    setCombineTargetId('');
  };

  return (
    <div className="canvas-section" data-testid="canvas-boolean-mask-section">
      <SectionHeader title="Booleana" />
      <div className="canvas-inspector-stack">
        <PropRow label="Máscara">
          <CanvasSelect
            aria-label="Capa máscara"
            value={maskId}
            onChange={(val) => applyMask(val)}
            options={[
              { value: '', label: 'Ninguna' },
              ...maskCandidates.map((item) => ({
                value: item.id,
                label: item.name || item.type,
              })),
            ]}
          />
        </PropRow>

        {!isBoolean && (
          <>
            <PropRow label="Con">
              {selectedOthers.length > 0 ? (
                <span className="canvas-boolean-count">{selectedOthers.length} capas</span>
              ) : (
                <CanvasSelect
                  aria-label="Capa a combinar"
                  value={combineTargetId}
                  onChange={setCombineTargetId}
                  options={[
                    { value: '', label: 'Elegir…' },
                    ...maskCandidates.map((item) => ({
                      value: item.id,
                      label: item.name || item.type,
                    })),
                  ]}
                />
              )}
            </PropRow>
            <div className="canvas-boolean-ops" role="group" aria-label="Operación booleana">
              {OP_OPTS.map(({ value, label, icon: Icon }) => (
                <WithHoverTooltip key={value} label={label} placement="bottom" variant="dark">
                  <button
                    type="button"
                    className="canvas-icon-btn"
                    aria-label={label}
                    data-active={combineOp === value}
                    disabled={!canCombine}
                    onClick={() => applyOp(value)}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                </WithHoverTooltip>
              ))}
            </div>
          </>
        )}

        {isBoolean &&
          ops.map((entry, index) => {
            const src = layers.find((item) => item.id === entry.layerId);
            return (
              <PropRow key={`${entry.layerId}-${index}`} label={src?.name || 'Capa'}>
                <CanvasSelect
                  aria-label={`Operación ${index + 1}`}
                  value={entry.op}
                  onChange={(val) => setOpAt(index, val as BooleanOpKind)}
                  options={OP_OPTS.map(({ value, label }) => ({ value, label }))}
                />
              </PropRow>
            );
          })}
      </div>
    </div>
  );
}

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
