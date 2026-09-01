import { Crop, Download, FileImage, Gauge, Maximize2, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ASPECT_RATIO_OPTIONS, BatchSettings, ImageItem } from './types';
import { OperationSection, SegmentedControl, ThemeSelect, formControlClassName } from './ui';

interface SettingsPanelProps {
  settings: BatchSettings;
  previewNames: string[];
  activeItem: ImageItem | null;
  renameOnlyMode: boolean;
  onUpdateSettings: (updater: (draft: BatchSettings) => void) => void;
  onOpenCropEditor: () => void;
}

const fieldLabel = 'text-[10px] font-medium text-[var(--text-secondary)]';

const FORMAT_OPTIONS = [
  { value: 'original', label: 'Original' },
  { value: 'jpeg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WEBP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'bmp', label: 'BMP' },
] as const;

export default function SettingsPanel({
  settings,
  previewNames,
  activeItem,
  renameOnlyMode,
  onUpdateSettings,
  onOpenCropEditor,
}: SettingsPanelProps) {
  const { t } = useTranslation();
  return (
    <aside data-surface-part="settings" className="custom-scrollbar flex h-full flex-col gap-1.5 overflow-y-auto xl:pr-0.5">

      <OperationSection
        title={t('optimizer.operations.crop')}
        icon={<Crop size={13} />}
        accentColor="#8B5CF6"
        enabled={settings.operations.cropEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.cropEnabled = v; })}
        disabled={renameOnlyMode}
      >
        <label className="block space-y-1">
          <span className={fieldLabel}>{t('optimizer.fields.aspectRatio')}</span>
          <ThemeSelect
            aria-label={t('optimizer.fields.aspectRatio')}
            value={settings.crop.aspectRatio}
            options={ASPECT_RATIO_OPTIONS.map((o) => ({
              value: o.value,
              label: o.value === 'original' ? t('optimizer.preview.original') : o.label,
            }))}
            onChange={(value) => onUpdateSettings((draft) => {
              draft.crop.aspectRatio = value as BatchSettings['crop']['aspectRatio'];
            })}
          />
        </label>
        {settings.crop.aspectRatio !== 'original' && (
          <label className="block space-y-1">
            <span className={fieldLabel}>{t('optimizer.fields.direction')}</span>
            <SegmentedControl
              value={settings.crop.cropOrigin}
              options={[
                { value: 'top', label: t('optimizer.fields.topToBottom') },
                { value: 'bottom', label: t('optimizer.fields.bottomToTop') },
              ]}
              onChange={(value) => onUpdateSettings((draft) => { draft.crop.cropOrigin = value as 'top' | 'bottom'; })}
            />
          </label>
        )}
        <button
          type="button"
          onClick={onOpenCropEditor}
          disabled={!activeItem || !settings.operations.cropEnabled || settings.crop.aspectRatio === 'original'}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-input)] px-2 text-[11px] font-medium text-[var(--text-primary)] transition-[background-color,transform] duration-100 hover:border-[var(--accent-primary)]/40 active:scale-[0.96] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-40"
        >
          <Crop size={12} />
          {t('optimizer.fields.adjustCrop')}
        </button>
      </OperationSection>

      <OperationSection
        title={t('optimizer.operations.resize')}
        icon={<Maximize2 size={13} />}
        accentColor="#3B82F6"
        enabled={settings.operations.resizeEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.resizeEnabled = v; })}
        disabled={renameOnlyMode}
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className={fieldLabel}>{t('optimizer.fields.maxWidth')}</span>
            <input
              type="number"
              min="1"
              value={settings.resize.maxWidth}
              onChange={(e) => onUpdateSettings((draft) => { draft.resize.maxWidth = Math.max(1, Number(e.target.value) || 1); })}
              className={`${formControlClassName} tabular-nums`}
            />
          </label>
          <label className="block space-y-1">
            <span className={fieldLabel}>{t('optimizer.fields.maxHeight')}</span>
            <input
              type="number"
              min="1"
              value={settings.resize.maxHeight}
              onChange={(e) => onUpdateSettings((draft) => { draft.resize.maxHeight = Math.max(1, Number(e.target.value) || 1); })}
              className={`${formControlClassName} tabular-nums`}
            />
          </label>
        </div>
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[var(--border-medium)] bg-[var(--bg-input)] px-2.5 py-1.5 transition-colors hover:border-[var(--accent-primary)]/35">
          <span className="text-[11px] font-medium text-[var(--text-primary)]">{t('optimizer.fields.noUpscale')}</span>
          <input
            type="checkbox"
            checked={settings.resize.noUpscale}
            onChange={(e) => onUpdateSettings((draft) => { draft.resize.noUpscale = e.target.checked; })}
            className="h-3.5 w-3.5 rounded border-[var(--border-medium)] bg-[var(--bg-elevated)] text-[var(--accent-primary)] focus:ring-[var(--accent-primary)] focus:ring-offset-0"
          />
        </label>
      </OperationSection>

      <OperationSection
        title={t('optimizer.operations.format')}
        icon={<FileImage size={13} />}
        accentColor="#10B981"
        enabled={settings.operations.formatEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.formatEnabled = v; })}
        disabled={renameOnlyMode}
      >
        <label className="block space-y-1">
          <span className={fieldLabel}>{t('optimizer.fields.output')}</span>
          <ThemeSelect
            aria-label={t('optimizer.fields.outputFormat')}
            value={settings.format.outputFormat}
            options={FORMAT_OPTIONS.map((option) => ({
              ...option,
              label: option.value === 'original' ? t('optimizer.preview.original') : option.label,
            }))}
            onChange={(value) => onUpdateSettings((draft) => {
              draft.format.outputFormat = value as BatchSettings['format']['outputFormat'];
            })}
          />
        </label>
      </OperationSection>

      <OperationSection
        title={t('optimizer.operations.compression')}
        icon={<Gauge size={13} />}
        accentColor="#F59E0B"
        enabled={settings.operations.compressionEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.compressionEnabled = v; })}
        disabled={renameOnlyMode}
      >
        <label className="block space-y-1">
          <span className={`flex items-center justify-between ${fieldLabel}`}>
            <span>{t('optimizer.fields.quality')}</span>
            <span className="font-mono tabular-nums text-[var(--text-primary)]">{Math.round(settings.compression.quality * 100)}%</span>
          </span>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={settings.compression.quality}
            onChange={(e) => onUpdateSettings((draft) => { draft.compression.quality = Number(e.target.value); })}
            className="w-full accent-[var(--accent-primary)]"
          />
        </label>
        <label className="block space-y-1">
          <span className={fieldLabel}>{t('optimizer.fields.maxSizeMb')}</span>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={settings.compression.maxSizeMB}
            onChange={(e) => onUpdateSettings((draft) => { draft.compression.maxSizeMB = Math.max(0.1, Number(e.target.value) || 0.1); })}
            className={`${formControlClassName} tabular-nums`}
          />
        </label>
      </OperationSection>

      <OperationSection
        title={t('optimizer.operations.rename')}
        icon={<Tag size={13} />}
        accentColor="#06B6D4"
        enabled={settings.operations.renameEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.renameEnabled = v; })}
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className={fieldLabel}>{t('optimizer.fields.prefix')}</span>
            <input
              type="text"
              value={settings.rename.prefix}
              onChange={(e) => onUpdateSettings((draft) => { draft.rename.prefix = e.target.value; })}
              className={formControlClassName}
            />
          </label>
          <label className="block space-y-1">
            <span className={fieldLabel}>{t('optimizer.fields.start')}</span>
            <input
              type="number"
              min="0"
              value={settings.rename.startAt}
              onChange={(e) => onUpdateSettings((draft) => { draft.rename.startAt = Math.max(0, Number(e.target.value) || 0); })}
              className={`${formControlClassName} tabular-nums`}
            />
          </label>
        </div>
      </OperationSection>

      <div
        className={`shrink-0 overflow-hidden rounded-xl border border-[var(--border-medium)] bg-[var(--bg-elevated)] px-3 py-2 ${settings.operations.renameEnabled ? '' : 'opacity-60'}`}
        style={{ borderLeftWidth: 3, borderLeftColor: '#06B6D4' }}
      >
        <p className={fieldLabel}>
          {t('optimizer.fields.preview')} {settings.operations.renameEnabled ? '' : `(${t('optimizer.fields.enableRename')})`}
        </p>
        <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-primary)]">{previewNames.join(', ')}</p>
      </div>

      <OperationSection
        title={t('optimizer.operations.export')}
        icon={<Download size={13} />}
        accentColor="#6366F1"
        enabled={true}
      >
        <label className="block space-y-1">
          <span className={fieldLabel}>{t('optimizer.fields.zipFolder')}</span>
          <input
            type="text"
            value={settings.export.zipName}
            onChange={(e) => onUpdateSettings((draft) => {
              draft.export.mode = 'zip';
              draft.export.zipName = e.target.value;
            })}
            className={formControlClassName}
          />
        </label>
      </OperationSection>
    </aside>
  );
}
