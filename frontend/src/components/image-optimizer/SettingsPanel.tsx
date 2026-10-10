import { Crop } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ASPECT_RATIO_OPTIONS, BatchSettings, ImageItem } from './types';
import { OperationSection, SegmentedControl, ThemeSelect, formControlClassName } from './ui';
import Button from '@/components/ui/Button';

interface SettingsPanelProps {
  settings: BatchSettings;
  previewNames: string[];
  activeItem: ImageItem | null;
  renameOnlyMode: boolean;
  onUpdateSettings: (updater: (draft: BatchSettings) => void) => void;
  onOpenCropEditor: () => void;
}

const fieldLabel = 'text-[12px] text-[var(--text-secondary)]';

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
    <aside data-surface-part="settings" className="custom-scrollbar flex h-full flex-col overflow-y-auto rounded-xl bg-[var(--bg-surface)] px-5">

      <OperationSection
        title={t('optimizer.operations.crop')}
        enabled={settings.operations.cropEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.cropEnabled = v; })}
        disabled={renameOnlyMode}
      >
        <label className="block space-y-1.5">
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
          <label className="block space-y-1.5">
            <span className={fieldLabel}>{t('optimizer.fields.direction')}</span>
            <SegmentedControl
              className="inline-flex w-full rounded-lg bg-[var(--bg-input)] p-0.5"
              value={settings.crop.cropOrigin}
              options={[
                { value: 'top', label: t('optimizer.fields.topToBottom') },
                { value: 'bottom', label: t('optimizer.fields.bottomToTop') },
              ]}
              onChange={(value) => onUpdateSettings((draft) => { draft.crop.cropOrigin = value as 'top' | 'bottom'; })}
            />
          </label>
        )}
        <Button variant="none" size="none"
          onClick={onOpenCropEditor}
          disabled={!activeItem || !settings.operations.cropEnabled || settings.crop.aspectRatio === 'original'}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-[var(--bg-input)] px-3 text-[13px] text-[var(--text-primary)] transition-[background-color,transform] duration-150 hover:bg-[var(--border-medium)] active:scale-[0.97] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-40"
        >
          <Crop size={14} />
          {t('optimizer.fields.adjustCrop')}
        </Button>
      </OperationSection>

      <OperationSection
        title={t('optimizer.operations.resize')}
        enabled={settings.operations.resizeEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.resizeEnabled = v; })}
        disabled={renameOnlyMode}
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1.5">
            <span className={fieldLabel}>{t('optimizer.fields.maxWidth')}</span>
            <input
              type="number"
              min="1"
              value={settings.resize.maxWidth}
              onChange={(e) => onUpdateSettings((draft) => { draft.resize.maxWidth = Math.max(1, Number(e.target.value) || 1); })}
              className={`${formControlClassName} tabular-nums`}
            />
          </label>
          <label className="block space-y-1.5">
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
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-[13px] text-[var(--text-secondary)]">{t('optimizer.fields.noUpscale')}</span>
          <input
            type="checkbox"
            checked={settings.resize.noUpscale}
            onChange={(e) => onUpdateSettings((draft) => { draft.resize.noUpscale = e.target.checked; })}
            className="h-4 w-4 cursor-pointer accent-[var(--accent-primary)]"
          />
        </label>
      </OperationSection>

      <OperationSection
        title={t('optimizer.operations.format')}
        enabled={settings.operations.formatEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.formatEnabled = v; })}
        disabled={renameOnlyMode}
      >
        <label className="block space-y-1.5">
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
        enabled={settings.operations.compressionEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.compressionEnabled = v; })}
        disabled={renameOnlyMode}
      >
        <label className="block space-y-1.5">
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
            className="w-full cursor-pointer accent-[var(--accent-primary)]"
          />
        </label>
        <label className="block space-y-1.5">
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
        enabled={settings.operations.renameEnabled}
        onToggle={(v) => onUpdateSettings((d) => { d.operations.renameEnabled = v; })}
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1.5">
            <span className={fieldLabel}>{t('optimizer.fields.prefix')}</span>
            <input
              type="text"
              value={settings.rename.prefix}
              onChange={(e) => onUpdateSettings((draft) => { draft.rename.prefix = e.target.value; })}
              className={formControlClassName}
            />
          </label>
          <label className="block space-y-1.5">
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
        <p className="truncate font-mono text-[12px] text-[var(--text-muted)]">{previewNames.join(', ')}</p>
      </OperationSection>

      <OperationSection
        title={t('optimizer.operations.export')}
        enabled={true}
      >
        <label className="block space-y-1.5">
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
