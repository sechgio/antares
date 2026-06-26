import { CheckCircle2, Crop, Download, Eye, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { BatchSettings, CropRectangle, ImageItem, PreviewTab, PresetId } from './types';
import { BeforeAfterSlider, ItemSummary, ProgressBar } from './ui';
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
}

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
}: PreviewWorkspaceProps) {
  const previewStageClass = 'flex min-h-0 flex-1 items-center justify-center overflow-hidden';
  const previewImageClass = 'block max-h-full max-w-full object-contain';

  if (items.length === 0) {
    return (
      <section className="relative flex h-full flex-col items-center justify-center overflow-hidden rounded-[14px] border border-dashed border-[var(--border-medium)] bg-[var(--bg-surface)] px-6 text-center shadow-sm">
        <div className="relative z-10 mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-medium)] bg-[var(--bg-base)]">
          <Sparkles size={20} className="text-[var(--text-muted)]" />
        </div>
        <p className="relative z-10 font-mono text-[11px] uppercase tracking-widest text-[var(--text-muted)]">Selecciona una imagen</p>
      </section>
    );
  }

  if (viewMode === 'grid') {
    return (
      <section className="relative flex h-full flex-col overflow-hidden rounded-[14px] border border-[var(--border-medium)] bg-[var(--bg-surface)] shadow-sm">
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {items.map((item) => {
              const outputName = downloadNameMap.get(item.id) || item.originalName;
              const statusColor = item.excluded ? '#52525b'
                : item.status === 'error' ? '#ef4444'
                  : item.stale ? '#f59e0b'
                    : item.status === 'completed' ? '#10b981'
                      : item.status === 'processing' ? '#3b82f6'
                        : '#3f3f46';
              const thumb = item.resultPreview || item.preview;

              return (
                <div
                  key={item.id}
                  className="group relative flex cursor-pointer flex-col overflow-hidden rounded-[10px] border border-[var(--border-medium)] bg-[var(--bg-base)] transition-all hover:border-[var(--border-medium)] hover:bg-[var(--bg-surface)]"
                  onClick={() => {
                    onSetActiveItem(item.id);
                    onViewModeChange('single');
                  }}
                >
                  <div className="relative aspect-[3/4] w-full overflow-hidden bg-[var(--bg-surface)]">
                    {thumb ? (
                      <img src={thumb} alt={item.originalName} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Sparkles size={16} className="text-[var(--text-muted)]" />
                      </div>
                    )}

                    <div className="absolute inset-0 flex items-start justify-end p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenCropEditor(item.id);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md bg-black/70 text-[var(--text-primary)] transition-colors hover:bg-emerald-500/80 hover:text-white"
                        title="Ajustar recorte"
                      >
                        <Crop size={11} />
                      </button>
                    </div>

                    {item.status === 'processing' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Loader2 size={16} className="animate-spin text-[var(--text-primary)]" />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-[10px] font-mono leading-tight text-[var(--text-primary)] ${item.excluded ? 'line-through opacity-50' : ''}`}
                        title={outputName !== item.originalName ? item.originalName : undefined}
                      >
                        {outputName}
                      </p>
                      {outputName !== item.originalName && (
                        <p className="truncate text-[9px] font-mono leading-tight text-[var(--text-muted)]">
                          {item.originalName}
                        </p>
                      )}
                      <p className="mt-0.5 text-[9px] font-mono leading-tight text-[var(--text-muted)]">
                        {item.sourceWidth && item.sourceHeight ? `${item.sourceWidth}×${item.sourceHeight} · ` : ''}
                        {/* formatBytes inlined to avoid dependency cycle */}
                        {(() => {
                          const bytes = item.originalSize;
                          if (bytes === 0) return '0 B';
                          const k = 1024;
                          const sizes = ['B', 'KB', 'MB', 'GB'];
                          const i = Math.floor(Math.log(bytes) / Math.log(k));
                          return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
                        })()}
                        {item.resultSize != null ? <span className="text-emerald-500"> → {(() => {
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
    <section className="flex h-full flex-col gap-3 overflow-hidden">
      <div className="relative flex-1 overflow-hidden rounded-[14px] border border-[var(--border-medium)] bg-[var(--bg-surface)] p-3 shadow-sm flex flex-col gap-2">
        {/* Item header */}
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between shrink-0">
          <div className="min-w-0 flex items-center gap-2">
            <div className="min-w-0">
              <p className="truncate font-mono text-[13px] text-[var(--text-primary)]">{activeItemOutputName}</p>
              {activeItemOutputName !== activeItem.originalName && (
                <p className="truncate text-[10px] font-mono text-[var(--text-muted)]/70">{activeItem.originalName}</p>
              )}
            </div>
            {activeItem.status === 'completed' && !activeItem.stale ? <CheckCircle2 size={12} className="text-emerald-400/80 shrink-0" /> : null}
            {activeItem.excluded && <span className="shrink-0 text-[10px] font-mono text-red-400/70">Excluida</span>}
            {activeItem.stale && <span className="shrink-0 text-[10px] font-mono text-amber-400/70">Stale</span>}
            {activeItem.overrides.skipCompression && <span className="shrink-0 text-[10px] font-mono text-[var(--text-muted)]/70">Sin compresión</span>}
            {activeItem.overrides.presetId && <span className="shrink-0 text-[10px] font-mono text-[var(--text-muted)]/70">Preset local</span>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onViewModeChange('grid')}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            >
              ← Grid
            </button>
            <span className="text-[var(--border-medium)]/50">|</span>
            <button
              onClick={() => onDownloadSingle(activeItem)}
              disabled={!activeItemDownloadable}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-30"
            >
              <Download size={11} />
              Descargar
            </button>
            <span className="text-[var(--border-medium)]/50">|</span>
            <button
              onClick={() => onRemoveItem(activeItem.id)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-muted)]/70 transition-colors hover:text-red-400/80"
            >
              <Trash2 size={11} />
              Quitar
            </button>
          </div>
        </div>

        {/* Pill tab nav */}
        <div className="flex items-center gap-3 shrink-0 pb-1">
          <div className="flex items-center gap-0.5">
            {([
              { value: 'original', label: 'Original' },
              { value: 'crop', label: 'Recorte' },
              { value: 'result', label: 'Resultado' },
              { value: 'compare', label: 'Comparar' },
            ] as const).map((tab) => (
              <button
                key={tab.value}
                onClick={() => onChangePreviewTab(tab.value)}
                className={`rounded-md px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.1em] transition-colors ${previewTab === tab.value
                  ? 'bg-[var(--text-primary)] text-[var(--bg-base)]'
                  : 'text-[var(--text-muted)]/70 hover:text-[var(--text-primary)]'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {processing && (
            <div className="min-w-[14rem] flex-1">
              <ProgressBar current={processingProgress.current} total={processingProgress.total} />
              {processingMessage && <p className="mt-1.5 text-[10px] font-mono text-[var(--text-muted)] tracking-widest truncate">{processingMessage}</p>}
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
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <div className={previewStageClass}>
                  <div className="relative inline-block max-h-full max-w-full">
                    <img src={activeItem.preview} alt={activeItem.originalName} className={previewImageClass} />
                    <div className="absolute inset-0 bg-black/60" />
                    <div
                      className="absolute border border-[var(--accent-primary)] shadow-[0_0_15px_rgba(94,106,210,0.2)]"
                      style={{
                        left: `${(activeCropPreview.offsetX / activeItem.sourceWidth!) * 100}%`,
                        top: `${(activeCropPreview.offsetY / activeItem.sourceHeight!) * 100}%`,
                        width: `${(activeCropPreview.width / activeItem.sourceWidth!) * 100}%`,
                        height: `${(activeCropPreview.height / activeItem.sourceHeight!) * 100}%`,
                        boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
                      }}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 py-1">
                  <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-muted)]/70">
                    Recorte {activeCropPreview.width}x{activeCropPreview.height}
                  </p>
                  <button
                    onClick={() => onOpenCropEditor()}
                    className="text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--accent-primary)] transition-colors hover:text-[var(--accent-primary-hover)]"
                  >
                    Ajustar manualmente
                  </button>
                </div>
              </div>
            ) : (
              <div className={`${previewStageClass} flex-col gap-2 text-center`}>
                <Crop size={20} className="text-[var(--text-muted)]/60" />
                <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]/70">Sin recorte activo</p>
                <p className="max-w-[280px] text-[10px] font-mono leading-relaxed text-[var(--text-muted)]/60">Activa recorte y elige una relación para ver la máscara.</p>
              </div>
            )
          ) : null}

          {previewTab === 'result' ? (
            activeItemDownloadable ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <div className={previewStageClass}>
                  <img
                    src={activeIsDirect ? activeItem.preview : activeItem.resultPreview || activeItem.preview}
                    alt={`${activeItem.originalName} resultado`}
                    className={previewImageClass}
                  />
                </div>
                <p className="shrink-0 text-center text-[10px] font-mono text-[var(--text-muted)]/60">
                  {activeIsDirect
                    ? 'Modo directo: se descargará el original con el nombre final.'
                    : 'Artefacto final disponible para descarga.'}
                </p>
              </div>
            ) : (
              <div className={`${previewStageClass} flex-col gap-2 text-center`}>
                <Sparkles size={20} className="text-[var(--text-muted)]/60" />
                <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]/70">Aún no hay resultado</p>
                <p className="max-w-[280px] text-[10px] font-mono leading-relaxed text-[var(--text-muted)]/60">Procesa la imagen para obtener el preview final.</p>
              </div>
            )
          ) : null}

          {previewTab === 'compare' ? (
            activeItem.resultPreview && !activeIsDirect ? (
              <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
                <BeforeAfterSlider before={activeItem.preview} after={activeItem.resultPreview} alt={activeItem.originalName} />
              </div>
            ) : (
              <div className={`${previewStageClass} flex-col gap-2 text-center`}>
                <Eye size={20} className="text-[var(--text-muted)]/60" />
                <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)]/70">Comparación no disponible</p>
                <p className="max-w-[280px] text-[10px] font-mono leading-relaxed text-[var(--text-muted)]/60">Aparece cuando exista un resultado procesado distinto del original.</p>
              </div>
            )
          ) : null}
        </div>

        <div className="shrink-0 border-t border-[var(--border-medium)]/50 pt-1">
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
