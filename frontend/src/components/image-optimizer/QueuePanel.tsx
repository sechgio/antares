import { DragEvent, useMemo, useState } from 'react';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { Crop, FileDown, GripVertical, Image as ImageIcon, Loader2, Trash2 } from 'lucide-react';
import { BatchSettings, ImageItem } from './types';
import { glassPanelClass } from './ui';
import { formatBytes, buildExportNameMap, resolveSettingsForItem } from './utils';

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
  onReorderItems: (draggedId: string, targetId: string) => void;
  getResolvedBlob: (item: ImageItem) => Blob | null;
}

const chipBtn =
  'h-6 rounded-md px-2 text-[10px] font-medium text-[var(--text-secondary)] border border-[var(--border-medium)] bg-[var(--bg-input)] transition-[color,background-color,transform] duration-100 hover:text-[var(--text-primary)] active:scale-[0.96] motion-reduce:active:scale-100';

const iconBtn =
  'flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] transition-[color,background-color,transform] duration-100 hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-25';

function statusColor(item: ImageItem): string {
  if (item.excluded) return 'var(--text-secondary)';
  if (item.status === 'error') return 'var(--accent-red)';
  if (item.stale) return 'var(--accent-yellow)';
  if (item.status === 'completed') return 'var(--accent-green)';
  if (item.status === 'processing') return 'var(--accent-blue)';
  return 'var(--text-secondary)';
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
  onReorderItems,
  getResolvedBlob,
}: QueuePanelProps) {
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const downloadNameMap = useMemo(
    () => buildExportNameMap(items, settings),
    [items, settings]
  );
  const pendingCount = items.filter(i => i.status === 'pending' && !i.excluded).length;
  const allSelected = items.length > 0 && items.every((item) => item.selected);

  const handleDragStart = (event: DragEvent<HTMLDivElement>, id: string) => {
    setDraggedItemId(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, id: string) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (draggedItemId && draggedItemId !== id) {
      setDropTargetId(id);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer.getData('text/plain') || draggedItemId;
    if (sourceId && sourceId !== targetId) {
      onReorderItems(sourceId, targetId);
      onSetActiveItem(sourceId);
    }
    setDraggedItemId(null);
    setDropTargetId(null);
  };

  const resetDragState = () => {
    setDraggedItemId(null);
    setDropTargetId(null);
  };

  return (
    <section className={`relative flex h-full flex-col overflow-hidden ${glassPanelClass}`}>
      <header className="flex shrink-0 flex-col gap-1 px-2.5 pb-1.5 pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-[var(--text-primary)]">
            Cola <span className="ml-1 font-mono text-[10px] tabular-nums text-[var(--text-secondary)]">{items.length}</span>
          </p>
          <div className="flex items-center gap-1">
            <button onClick={onSelectAll} className={chipBtn}>
              {allSelected ? 'Deselect' : 'Todo'}
            </button>
            {selectedCount > 0 && (
              <button onClick={onClearSelection} className={chipBtn}>
                Limpiar
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] tabular-nums text-[var(--text-secondary)]">
          <span>{includedCount} incluidas</span>
          {pendingCount > 0 && <span>{pendingCount} pendientes</span>}
          {downloadableItems.length > 0 && (
            <span className="text-[var(--accent-green)]">{downloadableItems.length} listas</span>
          )}
        </div>
        {selectedCount > 0 && (
          <div className="flex flex-wrap gap-1">
            <button onClick={onApplyPresetToSelection} className={chipBtn}>Preset</button>
            <button onClick={onReprocessSelected} className={chipBtn}>Reprocesar</button>
            <button onClick={onToggleExcludeSelected} className={chipBtn}>Excluir</button>
            <button
              onClick={onRemoveSelected}
              className="h-6 rounded-md border border-[var(--accent-red)]/25 px-2 text-[10px] font-medium text-[var(--accent-red)] transition-[background-color,transform] duration-100 hover:bg-[var(--accent-red)]/10 active:scale-[0.96]"
            >
              Quitar
            </button>
          </div>
        )}
      </header>

      <div className="custom-scrollbar relative flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pb-1.5">
        <div className="flex w-full flex-1 flex-col gap-1">
          {items.map((item) => {
            const outputName = downloadNameMap.get(item.id) || item.originalName;
            const isActive = item.id === activeItemId;
            const isReady = !!getResolvedBlob(item);
            const hasResult = item.status === 'completed' && !!item.resultSize;
            const itemSettings = resolveSettingsForItem(settings, item);
            const color = statusColor(item);

            return (
              <WithHoverTooltip
                key={item.id}
                label="Arrastra para cambiar el orden de exportación"
                placement="bottom"
                className="block w-full"
              >
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, item.id)}
                  onDragOver={(e) => handleDragOver(e, item.id)}
                  onDragLeave={() => setDropTargetId((current) => current === item.id ? null : current)}
                  onDrop={(e) => handleDrop(e, item.id)}
                  onDragEnd={resetDragState}
                  className={`group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-[background-color,opacity] duration-100 ${
                    isActive
                      ? 'bg-[var(--bg-input)]'
                      : 'hover:bg-[var(--bg-input)]'
                  } ${dropTargetId === item.id ? 'bg-[var(--accent-primary)]/10' : ''} ${draggedItemId === item.id ? 'opacity-55' : item.excluded ? 'opacity-45' : ''}`}
                  onClick={() => onSetActiveItem(item.id)}
                >
                  <GripVertical size={12} className="shrink-0 text-[var(--text-secondary)] opacity-35 transition-opacity group-hover:opacity-70" />

                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={() => onToggleSelection(item.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-3 w-3 shrink-0 cursor-pointer rounded accent-[var(--accent-primary)]"
                  />

                  <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md bg-[var(--bg-surface)]">
                    {item.preview ? (
                      <img src={item.preview} alt={item.originalName} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <ImageIcon size={11} className="text-[var(--text-secondary)]" />
                      </div>
                    )}
                    {item.status === 'processing' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-base)]/55">
                        <Loader2 size={10} className="animate-spin text-[var(--text-primary)]" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[11px] font-medium leading-tight text-[var(--text-primary)] ${item.excluded ? 'line-through' : ''}`}>
                      {outputName}
                    </p>
                    <p className="mt-px font-mono text-[9px] tabular-nums leading-tight text-[var(--text-secondary)]">
                      {formatBytes(item.originalSize)}
                      {hasResult && item.resultSize != null && (
                        <span className="text-[var(--accent-green)]">{' → '}{formatBytes(item.resultSize)}</span>
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-px opacity-70 transition-opacity group-hover:opacity-100">
                    <WithHoverTooltip label="Editor de recorte" placement="bottom">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpenCropEditor(item.id); }}
                        disabled={!itemSettings.operations.cropEnabled || itemSettings.crop.aspectRatio === 'original'}
                        className={iconBtn}
                      >
                        <Crop size={12} />
                      </button>
                    </WithHoverTooltip>
                    <WithHoverTooltip label="Descargar" placement="bottom">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDownloadSingle(item); }}
                        disabled={!isReady}
                        className={iconBtn}
                      >
                        <FileDown size={12} />
                      </button>
                    </WithHoverTooltip>
                    <WithHoverTooltip label="Quitar" placement="bottom">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRemoveItem(item.id); }}
                        className={`${iconBtn} hover:bg-[var(--accent-red)]/10 hover:text-[var(--accent-red)]`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </WithHoverTooltip>
                    <span
                      className={`ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.status === 'processing' ? 'animate-pulse' : ''}`}
                      style={{ backgroundColor: color }}
                    />
                  </div>
                </div>
              </WithHoverTooltip>
            );
          })}

          {items.length === 0 && (
            <div className="flex h-full min-h-[7rem] w-full flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-medium)] text-center">
              <ImageIcon size={14} className="mb-1.5 text-[var(--text-secondary)]" />
              <p className="text-[10px] font-medium text-[var(--text-secondary)]">Cola vacía</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
