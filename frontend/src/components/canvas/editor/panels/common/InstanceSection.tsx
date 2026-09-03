import CanvasSelect from '../../CanvasSelect';
import InlineNumField from '../../InlineNumField';
import {
  applyInstanceOverrides,
  createComponentFromLayer,
  findComponentMaster,
} from '../../../ops/components';
import {
  createEmptyDocument,
  mm,
  parseMm,
  type CanvasLayer,
  type LayerCssVars,
} from '../../../types';
import { SectionHeader } from '../shared';
import type { SectionProps } from '../types';

const OVERRIDE_KEYS = [
  { key: '--translate-x', label: 'X', suffix: 'mm' },
  { key: '--translate-y', label: 'Y', suffix: 'mm' },
  { key: '--width', label: 'W', suffix: 'mm' },
  { key: '--height', label: 'H', suffix: 'mm' },
] as const;

const COLOR_KEYS = [
  { key: '--background-color', label: 'Fill' },
  { key: '--border-color', label: 'Stroke' },
] as const;

function setOverride(
  layer: NonNullable<SectionProps['layer']>,
  key: string,
  value: string,
  master: ReturnType<typeof findComponentMaster>,
  onChange: SectionProps['onChange'],
) {
  const overrideVars: Partial<LayerCssVars> = {
    ...layer.meta?.overrideVars,
    [key]: value,
  };
  const next = {
    ...layer,
    meta: { ...layer.meta, overrideVars },
    cssVars: applyInstanceOverrides(
      { ...layer, meta: { ...layer.meta, overrideVars } },
      master,
    ),
  };
  onChange(next);
}

function clearOverride(
  layer: NonNullable<SectionProps['layer']>,
  key: string,
  master: ReturnType<typeof findComponentMaster>,
  onChange: SectionProps['onChange'],
) {
  const nextOverrides = { ...layer.meta?.overrideVars };
  delete nextOverrides[key];
  const meta: NonNullable<CanvasLayer['meta']> = { ...layer.meta };
  if (Object.keys(nextOverrides).length > 0) {
    meta.overrideVars = nextOverrides;
  } else {
    meta.overrideVars = undefined;
  }
  const next = {
    ...layer,
    meta,
    cssVars: applyInstanceOverrides({ ...layer, meta }, master),
  };
  onChange(next);
}

export default function InstanceSection({
  layer,
  layers = [],
  onChange,
  onInstantiateComponent,
}: SectionProps) {
  const isInstance = Boolean(layer.meta?.instanceOf);
  const isMaster = layer.type === 'component' && Boolean(layer.meta?.componentId) && !isInstance;
  const canCreate =
    (layer.type === 'frame' || layer.type === 'component' || layer.type === 'group' || layer.type === 'rect') &&
    !isInstance &&
    !isMaster;

  if (canCreate) {
    return (
      <div className="canvas-section">
        <SectionHeader title="Componente" />
        <button
          type="button"
          className="canvas-btn w-full rounded-md px-3 py-2 text-[12px]"
          onClick={() => {
            const stub = layers.length
              ? { ...createEmptyDocument(), layers }
              : createEmptyDocument();
            onChange(createComponentFromLayer(layer, stub));
          }}
        >
          Crear componente
        </button>
      </div>
    );
  }

  if (isMaster) {
    const variantKeys = Object.keys(layer.meta?.variants ?? {});
    return (
      <div className="canvas-section">
        <SectionHeader title="Componente" />
        <p className="canvas-sublabel mb-2">Maestro · {layer.meta?.componentId}</p>
        {variantKeys.length > 0 && (
          <p className="canvas-sublabel mb-2">Variantes: {variantKeys.join(', ')}</p>
        )}
        {onInstantiateComponent && (
          <button
            type="button"
            className="canvas-btn w-full rounded-md px-3 py-2 text-[12px]"
            onClick={() => onInstantiateComponent()}
          >
            Crear instancia
          </button>
        )}
      </div>
    );
  }

  if (!isInstance) return null;

  const master = findComponentMaster(layers, layer.meta!.instanceOf!);
  const variantKeys = Object.keys(master?.meta?.variants ?? {});
  const overrides = layer.meta?.overrideVars ?? {};

  return (
    <div className="canvas-section">
      <SectionHeader title="Instancia" />
      <p className="canvas-sublabel mb-2">De · {layer.meta?.instanceOf}</p>

      {variantKeys.length > 0 && (
        <label className="mb-3 block">
          <span className="canvas-sublabel">Variante</span>
          <CanvasSelect
            className="mt-0.5"
            value={layer.meta?.variant ?? ''}
            aria-label="Variante"
            onChange={(v) => {
              const variant = v || undefined;
              const meta = { ...layer.meta, variant };
              if (!variant) delete meta.variant;
              onChange({
                ...layer,
                meta,
                cssVars: applyInstanceOverrides({ ...layer, meta }, master),
              });
            }}
            options={[
              { value: '', label: 'Por defecto' },
              ...variantKeys.map((k) => ({ value: k, label: k })),
            ]}
          />
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        {OVERRIDE_KEYS.map(({ key, label, suffix }) => {
          const raw = overrides[key] ?? layer.cssVars[key] ?? mm(0);
          const n = parseMm(raw, 0);
          const isOverridden = overrides[key] != null;
          return (
            <div key={key} className="relative">
              <InlineNumField
                prefix={label}
                value={n}
                onChange={(v) => setOverride(layer, key, mm(v), master, onChange)}
                suffix={suffix}
                title={isOverridden ? `${label} (override)` : label}
              />
              {isOverridden && (
                <button
                  type="button"
                  className="absolute right-0 top-0 text-[10px] text-[var(--cv-accent)]"
                  title="Quitar override"
                  onClick={() => clearOverride(layer, key, master, onChange)}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 space-y-2">
        {COLOR_KEYS.map(({ key, label }) => {
          const value = overrides[key] ?? layer.cssVars[key] ?? '';
          const isOverridden = overrides[key] != null;
          return (
            <label key={key} className="block">
              <span className="canvas-sublabel">
                {label}
                {isOverridden ? ' · override' : ''}
              </span>
              <div className="mt-0.5 flex gap-1">
                <input
                  type="color"
                  className="canvas-input h-8 w-10 p-0.5"
                  value={/^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#000000'}
                  onChange={(e) => setOverride(layer, key, e.target.value, master, onChange)}
                  aria-label={label}
                />
                <input
                  className="canvas-input flex-1"
                  value={value}
                  onChange={(e) => setOverride(layer, key, e.target.value, master, onChange)}
                />
                {isOverridden && (
                  <button
                    type="button"
                    className="canvas-btn px-2 text-[11px]"
                    title="Quitar override"
                    onClick={() => clearOverride(layer, key, master, onChange)}
                  >
                    ✕
                  </button>
                )}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
