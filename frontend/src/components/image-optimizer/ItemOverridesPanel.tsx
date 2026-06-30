import { useId } from 'react';
import { ImageItem, PresetId } from './types';
import { IMAGE_OPTIMIZER_PRESETS } from './presets';
import { FormField, SettingSwitchRow, formControlClassName } from './ui';

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

  return (
    <div className="space-y-2 border-t border-[var(--border-medium)]/30 pt-2">
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
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
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-muted)]/60">Preset local</span>
            {item.overrides.presetId ? (
              <button
                type="button"
                onClick={() => onClearPresetOverride(item.id)}
                className="text-[10px] font-mono text-[var(--text-muted)]/70 transition-colors hover:text-[var(--text-primary)]"
              >
                Limpiar
              </button>
            ) : null}
          </div>
          <select
            value={item.overrides.presetId || ''}
            onChange={(e) => onUpdatePresetOverride(item.id, (e.target.value || null) as PresetId | null)}
            className={`${formControlClassName} appearance-none`}
          >
            <option value="" className="bg-[var(--bg-base)]">Global</option>
            {IMAGE_OPTIMIZER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id} className="bg-[var(--bg-base)] text-[var(--text-primary)]">
                {preset.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
          labelClassName={item.excluded ? 'text-red-400/80' : 'text-[var(--text-muted)]/80'}
          checked={item.excluded}
          onChange={(value) => onToggleExcluded(item.id, value)}
          accentColor="#EF4444"
        />

        <p className="text-[10px] font-mono text-[var(--text-muted)]/60 sm:ml-auto">
          {primaryActionLabel}
          <span className="mx-1.5 text-[var(--border-medium)]">·</span>
          {isDirect ? 'Directa' : 'Con procesado'}
        </p>
      </div>

      {item.error ? (
        <p className="text-[10px] font-mono leading-relaxed text-red-400/80">{item.error}</p>
      ) : null}
    </div>
  );
}
