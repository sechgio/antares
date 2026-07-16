import { useId } from 'react';
import { ImageItem, PresetId } from './types';
import { IMAGE_OPTIMIZER_PRESETS } from './presets';
import { FormField, SettingSwitchRow, ThemeSelect, formControlClassName } from './ui';

interface ItemOverridesPanelProps {
  item: ImageItem;
  primaryActionLabel: string;
  isDirect: boolean;
  onUpdateCustomFilename: (id: string, value: string) => void;
  onUpdatePresetOverride: (id: string, value: PresetId | null) => void;
  onToggleSkipCompression: (id: string, value: boolean) => void;
  onToggleExcluded: (id: string, value: boolean) => void;
  onClearPresetOverride: (id: string) => void;
}

export default function ItemOverridesPanel({
  item,
  primaryActionLabel,
  isDirect,
  onUpdateCustomFilename,
  onUpdatePresetOverride,
  onToggleSkipCompression,
  onToggleExcluded,
  onClearPresetOverride,
}: ItemOverridesPanelProps) {
  const skipCompressionId = useId();
  const excludeId = useId();

  const presetOptions = [
    { value: '', label: 'Global' },
    ...IMAGE_OPTIMIZER_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
  ];

  return (
    <div className="space-y-1.5 border-t border-[var(--border-medium)] pt-1.5 pb-1.5">
      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        <FormField label="Nombre final">
          <input
            type="text"
            value={item.overrides.customFilename}
            onChange={(e) => onUpdateCustomFilename(item.id, e.target.value)}
            placeholder="Opcional"
            className={formControlClassName}
          />
        </FormField>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium text-[var(--text-secondary)]">Preset local</span>
            {item.overrides.presetId ? (
              <button
                type="button"
                onClick={() => onClearPresetOverride(item.id)}
                className="text-[10px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                Limpiar
              </button>
            ) : null}
          </div>
          <ThemeSelect
            aria-label="Preset local"
            value={item.overrides.presetId || ''}
            options={presetOptions}
            onChange={(value) => onUpdatePresetOverride(item.id, (value || null) as PresetId | null)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <SettingSwitchRow
          switchId={skipCompressionId}
          label="Omitir compresión"
          checked={item.overrides.skipCompression}
          onChange={(value) => onToggleSkipCompression(item.id, value)}
          accentColor="var(--accent-primary)"
        />

        <SettingSwitchRow
          switchId={excludeId}
          label="Excluir del lote"
          labelClassName={item.excluded ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}
          checked={item.excluded}
          onChange={(value) => onToggleExcluded(item.id, value)}
          accentColor="var(--accent-red)"
        />

        <p className="text-[10px] text-[var(--text-secondary)] sm:ml-auto">
          {primaryActionLabel}
          <span className="mx-1 text-[var(--border-medium)]">·</span>
          {isDirect ? 'Directa' : 'Con procesado'}
        </p>
      </div>

      {item.error ? (
        <p className="text-[10px] leading-snug text-[var(--accent-red)]">{item.error}</p>
      ) : null}
    </div>
  );
}
