import { CheckCircle2, Crop, Download, Eye, Loader2, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { BatchSettings, CropRectangle, ImageItem, PreviewTab, PresetId } from './types';
import { BeforeAfterSlider, ItemSummary, ProgressBar } from './ui';
import { IMAGE_OPTIMIZER_PRESETS } from './presets';

interface PreviewWorkspaceProps {
  items: ImageItem[];
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
                      <p className={`truncate text-[10px] font-mono leading-tight text-[var(--text-primary)] ${item.excluded ? 'line-through opacity-50' : ''}`}>
                        {item.originalName}
                      </p>
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
      <div className="relative flex-1 overflow-hidden rounded-[14px] border border-[var(--border-medium)] bg-[var(--bg-surface)] p-4 shadow-sm flex flex-col gap-3">
        {/* Item header */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between shrink-0">
          <div className="min-w-0 flex items-center gap-2">
            <p className="truncate font-mono text-sm tracking-wide text-[var(--text-primary)]">{activeItem.originalName}</p>
            {activeItem.status === 'completed' && !activeItem.stale ? <CheckCircle2 size={13} className="text-emerald-400 shrink-0" /> : null}
            {activeItem.excluded && <span className="shrink-0 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-mono text-red-400">Excluida</span>}
            {activeItem.stale && <span className="shrink-0 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono text-amber-400">Stale</span>}
            {activeItem.overrides.skipCompression && <span className="shrink-0 rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-[10px] font-mono text-sky-400">Skip Comp</span>}
            {activeItem.overrides.presetId && <span className="shrink-0 rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-mono text-violet-400">Preset local</span>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onViewModeChange('grid')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              ← Grid
            </button>
            <button
              onClick={() => onDownloadSingle(activeItem)}
              disabled={!activeItemDownloadable}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-zinc-400 transition-colors hover:bg-white/[0.07] hover:text-white disabled:pointer-events-none disabled:opacity-30"
            >
              <Download size={12} />
              Descargar
            </button>
            <button
              onClick={() => onRemoveItem(activeItem.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider text-red-500/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 size={12} />
              Quitar
            </button>
          </div>
        </div>

        {/* Pill tab nav */}
        <div className="flex items-center gap-3 shrink-0 border-b border-[var(--border-medium)] pb-3">
          <div className="flex items-center gap-0.5 rounded-full border border-[var(--border-medium)] bg-[var(--bg-base)] p-1">
            {([
              { value: 'original', label: 'Original' },
              { value: 'crop', label: 'Recorte' },
              { value: 'result', label: 'Resultado' },
              { value: 'compare', label: 'Comparar' },
            ] as const).map((tab) => (
              <button
                key={tab.value}
                onClick={() => onChangePreviewTab(tab.value)}
                className={`rounded-full px-3.5 py-1.5 text-[10px] font-mono uppercase tracking-[0.15em] transition-all ${previewTab === tab.value
                  ? 'bg-[var(--text-primary)] text-[var(--bg-base)] font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
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

        <div className="custom-scrollbar min-h-0 flex-1 overflow-auto flex flex-col gap-4">
          {previewTab === 'original' ? (
            <div className="flex flex-col gap-3">
              <div className="relative flex min-h-[200px] items-center justify-center overflow-hidden rounded-[12px] border border-[var(--border-medium)] bg-[var(--bg-base)]">
                <img src={activeItem.preview} alt={activeItem.originalName} className="max-h-[30rem] w-auto object-contain" />
              </div>
              <div className="shrink-0">
                <ItemSummary item={activeItem} />
              </div>
            </div>
          ) : null}

          {previewTab === 'crop' ? (
            activeCropPreview && activeItemSettings.operations.cropEnabled && activeItemSettings.crop.aspectRatio !== 'original' ? (
              <div className="flex flex-col gap-3">
                <div className="relative flex min-h-[200px] items-center justify-center overflow-hidden rounded-[12px] border border-[var(--border-medium)] bg-[var(--bg-base)]">
                  <div className="relative inline-block">
                    <img src={activeItem.preview} alt={activeItem.originalName} className="max-h-[30rem] w-auto object-contain" />
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
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--border-medium)] bg-[var(--bg-base)] p-3">
                  <div className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2">
                    Recorte efectivo <span className="text-[var(--text-primary)] bg-[var(--bg-surface)] px-1.5 py-0.5 rounded border border-[var(--border-medium)]">{activeCropPreview.width}x{activeCropPreview.height}</span>
                  </div>
                  <button
                    onClick={() => onOpenCropEditor()}
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--accent-primary)]/20 bg-[var(--accent-primary)]/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-widest text-[var(--accent-primary)] transition-colors hover:bg-[var(--accent-primary)]/10"
                  >
                    <Wand2 size={13} />
                    Ajustar manualmente
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center rounded-[12px] border border-dashed border-[var(--border-medium)] text-center">
                <Crop size={22} className="mb-3 text-[var(--text-muted)]" />
                <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--text-muted)]">Sin recorte activo</p>
                <p className="mt-2 max-w-[280px] text-[11px] font-mono leading-relaxed text-[var(--text-muted)]">Activa la operación de recorte y elige una relación para ver la máscara.</p>
              </div>
            )
          ) : null}

          {previewTab === 'result' ? (
            activeItemDownloadable ? (
              <div className="flex flex-col gap-3">
                <div className="relative flex min-h-[200px] items-center justify-center overflow-hidden rounded-[12px] border border-[var(--border-medium)] bg-[var(--bg-base)]">
                  <img
                    src={activeIsDirect ? activeItem.preview : activeItem.resultPreview || activeItem.preview}
                    alt={`${activeItem.originalName} resultado`}
                    className="max-h-[30rem] w-auto object-contain"
                  />
                </div>
                <div className="shrink-0 rounded-[12px] border border-[var(--border-medium)] bg-[var(--bg-base)] p-3 text-[11px] font-mono text-[var(--text-muted)] text-center tracking-wide">
                  {activeIsDirect
                    ? 'Modo directo: se descargará el original con el nombre final.'
                    : 'Artefacto final disponible para descarga.'}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center rounded-[12px] border border-dashed border-[var(--border-medium)] text-center">
                <Sparkles size={22} className="mb-3 text-[var(--text-muted)]" />
                <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--text-muted)]">Aún no hay resultado</p>
                <p className="mt-2 max-w-[280px] text-[11px] font-mono leading-relaxed text-[var(--text-muted)]">Procesa la imagen para obtener el preview final.</p>
              </div>
            )
          ) : null}

          {previewTab === 'compare' ? (
            activeItem.resultPreview && !activeIsDirect ? (
              <div className="relative flex h-full min-h-[200px] items-center justify-center overflow-hidden rounded-[12px] border border-[var(--border-medium)] bg-[var(--bg-base)]">
                <BeforeAfterSlider before={activeItem.preview} after={activeItem.resultPreview} alt={activeItem.originalName} />
              </div>
            ) : (
              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center rounded-[12px] border border-dashed border-[var(--border-medium)] text-center">
                <Eye size={22} className="mb-3 text-[var(--text-muted)]" />
                <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--text-muted)]">Comparación no disponible</p>
                <p className="mt-2 max-w-[280px] text-[11px] font-mono leading-relaxed text-[var(--text-muted)]">Aparece cuando exista un resultado procesado distinto del original.</p>
              </div>
            )
          ) : null}

          {/* Overrides & Summary — compact grid */}
          <div className="grid gap-4 border-t border-[var(--border-medium)] pt-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
            <div className="rounded-[14px] border border-[var(--border-medium)] bg-[var(--bg-base)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">Ajustes de imagen</p>
                {activeItem.overrides.presetId && (
                  <button
                    onClick={() => onClearPresetOverride(activeItem.id)}
                    className="rounded-md border border-[var(--border-medium)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                  >
                    Limpiar
                  </button>
                )}
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">Nombre final</span>
                  <input
                    type="text"
                    value={activeItem.overrides.customFilename}
                    onChange={(e) => onUpdateCustomFilename(activeItem.id, e.target.value)}
                    placeholder="Opcional"
                    className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] font-mono text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-primary)]"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">Preset local</span>
                  <select
                    value={activeItem.overrides.presetId || ''}
                    onChange={(e) => onUpdatePresetOverride(activeItem.id, (e.target.value || null) as PresetId | null)}
                    className="w-full appearance-none rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] font-mono text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-primary)]"
                  >
                    <option value="" className="bg-[var(--bg-base)]">Global (sin override)</option>
                    {IMAGE_OPTIMIZER_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id} className="bg-[var(--bg-base)] text-[var(--text-primary)]">{preset.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2.5 transition-colors hover:bg-[var(--bg-elevated)]">
                  <span className="text-[11px] font-mono text-[var(--text-primary)]">Omitir compresión</span>
                  <input
                    type="checkbox"
                    checked={activeItem.overrides.skipCompression}
                    onChange={(e) => onToggleSkipCompression(activeItem.id, e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[var(--border-medium)] bg-[var(--bg-base)] text-[var(--accent-primary)] focus:ring-[var(--accent-primary)] focus:ring-offset-0"
                  />
                </label>
                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2.5 transition-colors hover:bg-[var(--bg-elevated)]">
                  <span className="text-[11px] font-mono text-red-400">Excluir del lote</span>
                  <input
                    type="checkbox"
                    checked={activeItem.excluded}
                    onChange={(e) => onToggleExcluded(activeItem.id, e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[var(--border-medium)] bg-[var(--bg-base)] text-red-500 focus:ring-red-500 focus:ring-offset-0"
                  />
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 rounded-[14px] border border-[var(--border-medium)] bg-[var(--bg-base)] p-4 text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
              <p className="text-[11px] text-[var(--text-primary)]">Salida estimada</p>
              <p className="break-all rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] p-2 font-mono text-[11px] normal-case tracking-normal text-[var(--text-primary)]">{activeItemOutputName}</p>
              <div className="space-y-1.5 pt-1">
                <p className="flex items-center justify-between gap-2">Modo: <span className="text-right text-[var(--text-primary)] normal-case tracking-normal">{primaryActionLabel}</span></p>
                <p className="flex items-center justify-between gap-2">Directa: <span className="text-right text-[var(--text-primary)] normal-case tracking-normal">{activeIsDirect ? 'Sí' : 'No'}</span></p>
              </div>
              {activeItem.error && (
                <p className="rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-2 text-[10px] font-mono normal-case tracking-normal text-red-400">{activeItem.error}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
