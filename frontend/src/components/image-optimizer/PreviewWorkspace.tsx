import type { DragEvent, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { CheckCircle2, Crop, Download, Eye, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { BatchSettings, CropRectangle, ImageItem, PreviewTab, PresetId } from './types';
import { BeforeAfterSlider, ItemSummary, ProgressBar, previewStageShellClass } from './ui';
import ItemOverridesPanel from './ItemOverridesPanel';

interface PreviewWorkspaceProps {
  items: ImageItem[];
  downloadNameMap: Map<string, string>;
  activeItem: ImageItem | null;
  activeItemSettings: BatchSettings;
  activeItemOutputName: string;
  activeItemDownloadable: boolean;
  activeIsDirect: boolean;
  activeCropPreview: CropRectangle | null;
  previewTab: PreviewTab;
  processing: boolean;
  processingProgress: { current: number; total: number };
  processingMessage: string;
  primaryActionLabel: string;
  viewMode: 'grid' | 'single';
  onChangePreviewTab: (tab: PreviewTab) => void;
  onViewModeChange: (mode: 'grid' | 'single') => void;
  onSetActiveItem: (id: string) => void;
  onDownloadSingle: (item: ImageItem) => void;
  onRemoveItem: (id: string) => void;
  onOpenCropEditor: (id?: string) => void;
  onUpdateCustomFilename: (id: string, value: string) => void;
  onUpdatePresetOverride: (id: string, value: PresetId | null) => void;
  onToggleSkipCompression: (id: string, value: boolean) => void;
  onToggleExcluded: (id: string, value: boolean) => void;
  onClearPresetOverride: (id: string) => void;
  onAddClick: () => void;
  isDragActive: boolean;
  onDragEnter: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

const chromeBtn =
  'inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-[var(--text-secondary)] transition-[color,background-color,transform] duration-100 hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)] active:scale-[0.96] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-40';

export default function PreviewWorkspace({
  items,
  downloadNameMap,
  activeItem,
  activeItemSettings,
  activeItemOutputName,
  activeItemDownloadable,
  activeIsDirect,
  activeCropPreview,
  previewTab,
  processing,
  processingProgress,
  processingMessage,
  primaryActionLabel,
  viewMode,
  onChangePreviewTab,
  onViewModeChange,
  onSetActiveItem,
  onDownloadSingle,
  onRemoveItem,
  onOpenCropEditor,
  onUpdateCustomFilename,
  onUpdatePresetOverride,
  onToggleSkipCompression,
  onToggleExcluded,
  onClearPresetOverride,
  onAddClick,
  isDragActive,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
}: PreviewWorkspaceProps) {
  const { t } = useTranslation();
  const previewStageClass = 'flex min-h-0 flex-1 items-center justify-center overflow-hidden';
  const previewImageClass = 'block max-h-full max-w-full object-contain';

  if (items.length === 0) {
    return (
      <section
        data-surface-part="preview"
        className={`relative flex h-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl px-6 text-center transition-[border-color,background-color,box-shadow] duration-150 ${
          isDragActive
            ? 'border border-dashed border-[var(--accent-blue)] bg-[var(--bg-elevated)]'
            : previewStageShellClass
        }`}
        onClick={onAddClick}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') onAddClick();
        }}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        aria-label={t('optimizer.preview.addImages')}
      >
        <div
          className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl border bg-[var(--bg-input)] transition-colors ${
            isDragActive ? 'border-[var(--accent-blue)]' : 'border-[var(--border-medium)]'
          }`}
        >
          <Sparkles
            size={18}
            className={isDragActive ? 'text-[var(--accent-blue)]' : 'text-[var(--text-secondary)]'}
          />
        </div>
        <p className="text-[13px] font-semibold tracking-tight text-[var(--text-primary)] text-balance">
          {isDragActive ? t('optimizer.preview.dropHere') : t('optimizer.preview.selectImage')}
        </p>
        <p className="mt-1 max-w-[16rem] text-[11px] leading-snug text-[var(--text-secondary)] text-pretty">
          {isDragActive ? t('optimizer.preview.dropHint') : t('optimizer.preview.clickOrDrop')}
        </p>
      </section>
    );
  }

  if (viewMode === 'grid') {
    return (
      <section data-surface-part="preview" className={`relative flex h-full flex-col overflow-hidden ${previewStageShellClass}`}>
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2.5">
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {items.map((item) => {
              const outputName = downloadNameMap.get(item.id) || item.originalName;
              const statusColor = item.excluded ? 'var(--text-muted)'
                : item.status === 'error' ? 'var(--accent-red)'
                  : item.stale ? 'var(--accent-yellow)'
                    : item.status === 'completed' ? 'var(--accent-green)'
                      : item.status === 'processing' ? 'var(--accent-blue)'
                        : 'var(--text-muted)';
              const thumb = item.resultPreview || item.preview;

              return (
                <div
                  key={item.id}
                  className="group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] transition-[transform,background-color,border-color] duration-100 hover:bg-[var(--bg-elevated)] active:scale-[0.98] motion-reduce:active:scale-100"
                  onClick={() => {
                    onSetActiveItem(item.id);
                    onViewModeChange('single');
                  }}
                >
                  <div className="relative aspect-[3/4] w-full overflow-hidden bg-[var(--bg-surface)]">
                    {thumb ? (
                      <img src={thumb} alt={item.originalName} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Sparkles size={14} className="text-[var(--text-muted)]" />
                      </div>
                    )}

                    <div className="absolute inset-0 flex items-start justify-end p-1.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
                      <WithHoverTooltip label={t('optimizer.preview.adjustCrop')} placement="bottom">
                        <button
                          type="button"
                          aria-label={t('optimizer.preview.adjustCrop')}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenCropEditor(item.id);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-primary)] backdrop-blur-md transition-[transform,background-color] duration-100 hover:bg-[var(--accent-green)] hover:text-[var(--text-on-accent)] active:scale-[0.96]"
                          style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 70%, transparent)' }}
                        >
                          <Crop size={12} />
                        </button>
                      </WithHoverTooltip>
                    </div>

                    {item.status === 'processing' && (
                      <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 50%, transparent)' }}>
                        <Loader2 size={14} className="animate-spin text-[var(--text-primary)]" />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-[10px] font-medium leading-tight text-[var(--text-primary)] ${item.excluded ? 'line-through opacity-50' : ''}`}
                        title={outputName !== item.originalName ? item.originalName : undefined}
                      >
                        {outputName}
                      </p>
                      <p className="mt-0.5 font-mono text-[9px] tabular-nums leading-tight text-[var(--text-secondary)]">
                        {item.sourceWidth && item.sourceHeight ? `${item.sourceWidth}×${item.sourceHeight} · ` : ''}
                        {(() => {
                          const bytes = item.originalSize;
                          if (bytes === 0) return '0 B';
                          const k = 1024;
                          const sizes = ['B', 'KB', 'MB', 'GB'];
                          const i = Math.floor(Math.log(bytes) / Math.log(k));
                          return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
                        })()}
                        {item.resultSize != null ? <span className="text-[var(--accent-green)]"> → {(() => {
                          const bytes = item.resultSize;
                          if (bytes === 0) return '0 B';
                          const k = 1024;
                          const sizes = ['B', 'KB', 'MB', 'GB'];
                          const i = Math.floor(Math.log(bytes) / Math.log(k));
                          return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
                        })()}</span> : null}
                      </p>
                    </div>
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.status === 'processing' ? 'animate-pulse' : ''}`}
                      style={{ backgroundColor: statusColor }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  if (!activeItem) {
    return null;
  }

  return (
    <section data-surface-part="preview" className="flex h-full flex-col overflow-hidden">
      <div className={`relative flex flex-1 flex-col gap-1.5 overflow-hidden p-2 ${previewStageShellClass}`}>
        <div className="flex shrink-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold tracking-tight text-[var(--text-primary)]">{activeItemOutputName}</p>
              {activeItemOutputName !== activeItem.originalName && (
                <p className="truncate text-[9px] text-[var(--text-secondary)]">{activeItem.originalName}</p>
              )}
            </div>
            {activeItem.status === 'completed' && !activeItem.stale ? <CheckCircle2 size={11} className="shrink-0 text-[var(--accent-green)]" /> : null}
            {activeItem.excluded && <span className="shrink-0 text-[9px] font-medium text-[var(--accent-red)]">{t('optimizer.status.excluded')}</span>}
            {activeItem.stale && <span className="shrink-0 text-[9px] font-medium text-[var(--accent-yellow)]">{t('optimizer.status.stale')}</span>}
            {activeItem.overrides.skipCompression && <span className="shrink-0 text-[9px] font-medium text-[var(--text-secondary)]">{t('optimizer.item.skipCompression')}</span>}
            {activeItem.overrides.presetId && <span className="shrink-0 text-[9px] font-medium text-[var(--text-secondary)]">{t('optimizer.item.localPreset')}</span>}
          </div>
          <div className="flex shrink-0 items-center">
            <button type="button" onClick={() => onViewModeChange('grid')} className={chromeBtn}>{t('optimizer.preview.backToGrid')}</button>
            <button type="button" onClick={() => onDownloadSingle(activeItem)} disabled={!activeItemDownloadable} className={chromeBtn}>
              <Download size={11} />
              {t('optimizer.preview.download')}
            </button>
            <button type="button" onClick={() => onRemoveItem(activeItem.id)} className={`${chromeBtn} hover:text-[var(--accent-red)]`}>
              <Trash2 size={11} />
              {t('optimizer.preview.remove')}
            </button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-input)] p-0.5">
            {([
              { value: 'original', label: t('optimizer.preview.original') },
              { value: 'crop', label: t('optimizer.preview.crop') },
              { value: 'result', label: t('optimizer.preview.result') },
              { value: 'compare', label: t('optimizer.preview.compareShort') },
            ] as const).map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => onChangePreviewTab(tab.value)}
                className={`h-6 rounded-md px-2 text-[10px] font-medium transition-[color,background-color,transform] duration-100 active:scale-[0.96] motion-reduce:active:scale-100 ${previewTab === tab.value
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {processing && (
            <div className="min-w-[10rem] flex-1">
              <ProgressBar current={processingProgress.current} total={processingProgress.total} />
              {processingMessage && (
                <p className="mt-0.5 truncate font-mono text-[9px] tabular-nums text-[var(--text-secondary)]">{processingMessage}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {previewTab === 'original' ? (
            <div className={previewStageClass}>
              <img src={activeItem.preview} alt={activeItem.originalName} className={previewImageClass} />
            </div>
          ) : null}

          {previewTab === 'crop' ? (
            activeCropPreview && activeItemSettings.operations.cropEnabled && activeItemSettings.crop.aspectRatio !== 'original' ? (
              <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                <div className={previewStageClass}>
                  <div className="relative inline-block max-h-full max-w-full">
                    <img src={activeItem.preview} alt={activeItem.originalName} className={previewImageClass} />
                    <div className="absolute inset-0" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-base) 60%, transparent)' }} />
                    <div
                      className="absolute border border-[var(--accent-primary)]"
                      style={{
                        left: `${(activeCropPreview.offsetX / activeItem.sourceWidth!) * 100}%`,
                        top: `${(activeCropPreview.offsetY / activeItem.sourceHeight!) * 100}%`,
                        width: `${(activeCropPreview.width / activeItem.sourceWidth!) * 100}%`,
                        height: `${(activeCropPreview.height / activeItem.sourceHeight!) * 100}%`,
                        boxShadow: '0 0 0 9999px color-mix(in srgb, var(--bg-base) 60%, transparent)',
                      }}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <p className="font-mono text-[9px] tabular-nums text-[var(--text-secondary)]">
                    {t('optimizer.preview.cropSize', { width: activeCropPreview.width, height: activeCropPreview.height })}
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpenCropEditor()}
                    className="text-[10px] font-medium text-[var(--accent-primary)] transition-colors hover:text-[var(--accent-primary-hover)]"
                  >
                    {t('optimizer.preview.adjust')}
                  </button>
                </div>
              </div>
            ) : (
              <div className={`${previewStageClass} flex-col gap-1.5 text-center`}>
                <Crop size={16} className="text-[var(--text-secondary)]" />
                <p className="text-[11px] font-medium text-[var(--text-primary)]">{t('optimizer.preview.noActiveCrop')}</p>
                <p className="max-w-[240px] text-[10px] leading-snug text-[var(--text-secondary)] text-pretty">
                  {t('optimizer.preview.enableCrop')}
                </p>
              </div>
            )
          ) : null}

          {previewTab === 'result' ? (
            activeItemDownloadable ? (
              <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                <div className={previewStageClass}>
                  <img
                    src={activeIsDirect ? activeItem.preview : activeItem.resultPreview || activeItem.preview}
                    alt={`${activeItem.originalName} ${t('optimizer.preview.result')}`}
                    className={previewImageClass}
                  />
                </div>
                <p className="shrink-0 text-center text-[10px] text-[var(--text-secondary)]">
                  {activeIsDirect
                    ? t('optimizer.preview.directMode')
                    : t('optimizer.preview.readyForDownload')}
                </p>
              </div>
            ) : (
              <div className={`${previewStageClass} flex-col gap-1.5 text-center`}>
                <Sparkles size={16} className="text-[var(--text-secondary)]" />
                <p className="text-[11px] font-medium text-[var(--text-primary)]">{t('optimizer.preview.noResult')}</p>
                <p className="max-w-[240px] text-[10px] leading-snug text-[var(--text-secondary)] text-pretty">
                  {t('optimizer.preview.processToPreview')}
                </p>
              </div>
            )
          ) : null}

          {previewTab === 'compare' ? (
            activeItem.resultPreview && !activeIsDirect ? (
              <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
                <BeforeAfterSlider before={activeItem.preview} after={activeItem.resultPreview} alt={activeItem.originalName} />
              </div>
            ) : (
              <div className={`${previewStageClass} flex-col gap-1.5 text-center`}>
                <Eye size={16} className="text-[var(--text-secondary)]" />
                <p className="text-[11px] font-medium text-[var(--text-primary)]">{t('optimizer.preview.compareUnavailable')}</p>
                <p className="max-w-[240px] text-[10px] leading-snug text-[var(--text-secondary)] text-pretty">
                  {t('optimizer.preview.compareHint')}
                </p>
              </div>
            )
          ) : null}
        </div>

        <div className="shrink-0 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-2">
          <ItemSummary item={activeItem} />
          <ItemOverridesPanel
            item={activeItem}
            primaryActionLabel={primaryActionLabel}
            isDirect={activeIsDirect}
            onUpdateCustomFilename={onUpdateCustomFilename}
            onUpdatePresetOverride={onUpdatePresetOverride}
            onToggleSkipCompression={onToggleSkipCompression}
            onToggleExcluded={onToggleExcluded}
            onClearPresetOverride={onClearPresetOverride}
          />
        </div>
      </div>
    </section>
  );
}
