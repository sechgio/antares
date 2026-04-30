import { Crop, FileDown, Image as ImageIcon, Loader2, Trash2 } from 'lucide-react';
import { BatchSettings, ImageItem } from './types';
import { formatBytes, buildDownloadNameMap, resolveSettingsForItem } from './utils';

interface QueuePanelProps {
  items: ImageItem[];
  settings: BatchSettings;
  activeItemId: string | null;
  selectedCount: number;
  includedCount: number;
  downloadableItems: ImageItem[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  onApplyPresetToSelection: () => void;
  onReprocessSelected: () => void;
  onToggleExcludeSelected: () => void;
  onRemoveSelected: () => void;
  onToggleSelection: (id: string) => void;
  onSetActiveItem: (id: string) => void;
  onOpenCropEditor: (id: string) => void;
  onDownloadSingle: (item: ImageItem) => void;
  onRemoveItem: (id: string) => void;
  getResolvedBlob: (item: ImageItem) => Blob | null;
}

export default function QueuePanel({
  items,
  settings,
  activeItemId,
  selectedCount,
  includedCount,
  downloadableItems,
  onSelectAll,
  onClearSelection,
  onApplyPresetToSelection,
  onReprocessSelected,
  onToggleExcludeSelected,
  onRemoveSelected,
  onToggleSelection,
  onSetActiveItem,
  onOpenCropEditor,
  onDownloadSingle,
  onRemoveItem,
  getResolvedBlob,
}: QueuePanelProps) {
  const downloadNameMap = buildDownloadNameMap(items.filter((item) => !item.excluded), settings);
  const pendingCount = items.filter(i => i.status === 'pending' && !i.excluded).length;
  const allSelected = items.length > 0 && items.every((item) => item.selected);

  return (
    <section className="relative flex h-full flex-col overflow-hidden rounded-[14px] border border-[var(--border-medium)] bg-[var(--bg-surface)] shadow-sm">
      {/* Header */}
      <header className="shrink-0 flex flex-col gap-2.5 p-4 border-b border-[var(--border-medium)]">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
            Cola <span className="text-[var(--text-primary)] ml-1">{items.length}</span>
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onSelectAll}
              className="rounded-md px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] border border-[var(--border-medium)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] transition-colors"
            >
              {allSelected ? 'Deselect' : 'Todo'}
            </button>
            {selectedCount > 0 && (
              <button
                onClick={onClearSelection}
                className="rounded-md px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] border border-[var(--border-medium)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] transition-colors"
              >
                Limpiar
              </button>
            )}
          </div>
        </div>
        {/* Stats row */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-[var(--text-muted)]">
          <span>{includedCount} incluidas</span>
          {pendingCount > 0 && <span>{pendingCount} pendientes</span>}
          {downloadableItems.length > 0 && (
            <span className="text-emerald-400">{downloadableItems.length} listas</span>
          )}
        </div>
        {/* Batch actions - compact */}
        {selectedCount > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button onClick={onApplyPresetToSelection} className="rounded-md border border-[var(--border-medium)] px-2 py-1 text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] transition-colors">Preset</button>
            <button onClick={onReprocessSelected} className="rounded-md border border-[var(--border-medium)] px-2 py-1 text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] transition-colors">Reprocesar</button>
            <button onClick={onToggleExcludeSelected} className="rounded-md border border-[var(--border-medium)] px-2 py-1 text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-medium)] transition-colors">Excluir</button>
            <button onClick={onRemoveSelected} className="rounded-md border border-red-500/25 px-2 py-1 text-[10px] font-mono text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors">Quitar</button>
          </div>
        )}
      </header>

      {/* Item list */}
      <div className="custom-scrollbar relative min-h-0 flex-1 overflow-y-auto px-3 py-3 flex flex-col">
        <div className="space-y-1 flex-1">
          {items.map((item) => {
            const outputName = downloadNameMap.get(item.id) || item.originalName;
            const isActive = item.id === activeItemId;
            const isReady = !!getResolvedBlob(item);
            const hasResult = item.status === 'completed' && !!item.resultSize;
            const itemSettings = resolveSettingsForItem(settings, item);

            const statusColor = item.excluded ? '#52525b'
              : item.status === 'error' ? '#ef4444'
                : item.stale ? '#f59e0b'
                  : item.status === 'completed' ? '#10b981'
                    : item.status === 'processing' ? '#3b82f6'
                      : '#3f3f46';

            return (
              <div
                key={item.id}
                className={`group relative flex items-center gap-2.5 rounded-[10px] p-2 cursor-pointer transition-all duration-150 ${
                  isActive
                    ? 'bg-[var(--bg-elevated)] border border-[var(--border-medium)]'
                    : 'border border-transparent hover:bg-[var(--bg-surface)] hover:border-[var(--border-medium)]'
                } ${item.excluded ? 'opacity-40' : ''}`}
                onClick={() => onSetActiveItem(item.id)}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={() => onToggleSelection(item.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 h-3.5 w-3.5 rounded accent-[var(--accent-primary)] cursor-pointer"
                />
                {/* Thumbnail */}
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-[8px] bg-[var(--bg-surface)] border border-[var(--border-medium)] relative">
                  {item.preview ? (
                    <img src={item.preview} alt={item.originalName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <ImageIcon size={14} className="text-[var(--text-muted)]" />
                    </div>
                  )}
                  {item.status === 'processing' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <Loader2 size={12} className="animate-spin text-[var(--text-primary)]" />
                    </div>
                  )}
                </div>
                {/* Name + size */}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className={`truncate text-[11px] font-mono text-[var(--text-primary)] leading-tight ${item.excluded ? 'line-through' : ''}`}>
                    {outputName}
                  </p>
                  <p className="text-[10px] font-mono text-[var(--text-muted)] leading-tight">
                    {formatBytes(item.originalSize)}
                    {hasResult && item.resultSize && (
                      <span className="text-emerald-500">{' -> '}{formatBytes(item.resultSize)}</span>
                    )}
                  </p>
                </div>
                {/* Actions (hover) + status dot */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="hidden group-hover:flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); onOpenCropEditor(item.id); }}
                      disabled={!itemSettings.operations.cropEnabled || itemSettings.crop.aspectRatio === 'original'}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] disabled:opacity-20 disabled:pointer-events-none transition-colors"
                      title="Editor de recorte"
                    >
                      <Crop size={11} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDownloadSingle(item); }}
                      disabled={!isReady}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] disabled:opacity-20 disabled:pointer-events-none transition-colors"
                      title="Descargar"
                    >
                      <FileDown size={11} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemoveItem(item.id); }}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-400 transition-colors"
                      title="Quitar"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.status === 'processing' ? 'animate-pulse' : ''}`}
                    style={{ backgroundColor: statusColor }}
                  />
                </div>
              </div>
            );
          })}

          {items.length === 0 && (
            <div className="flex flex-1 h-full min-h-[10rem] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-medium)] text-center">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)]">
                <ImageIcon size={16} />
              </div>
              <p className="font-mono text-[9px] uppercase tracking-widest text-[var(--text-muted)]">Cola vacia</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
