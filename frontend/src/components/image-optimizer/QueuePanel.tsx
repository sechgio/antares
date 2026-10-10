import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { WithHoverTooltip } from '@/components/ui/HoverTooltip';
import { Crop, FileDown, GripVertical, Image as ImageIcon, Loader2, Trash2 } from 'lucide-react';
import { BatchSettings, ImageItem } from './types';
import { glassPanelClass } from './ui';
import { buildExportNameMap, resolveSettingsForItem } from './utils';
import { formatBytes } from '../../utils/format';
import Button from '@/components/ui/Button';

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
  'h-7 rounded-md bg-[var(--bg-input)] px-2.5 text-[12px] font-medium text-[var(--text-secondary)] transition-[color,background-color,transform] duration-150 hover:text-[var(--text-primary)] active:scale-[0.97] motion-reduce:active:scale-100';

const iconBtn =
  'flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-[color,background-color,transform] duration-150 hover:bg-[var(--border-medium)] hover:text-[var(--text-primary)] active:scale-[0.97] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-25';

const QUEUE_VIRTUALIZATION_THRESHOLD = 100;
const QUEUE_ITEM_HEIGHT = 52;
const QUEUE_GAP = 2;
const QUEUE_ROW_HEIGHT = QUEUE_ITEM_HEIGHT + QUEUE_GAP;
const QUEUE_OVERSCAN = 6;

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
  const { t } = useTranslation();
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [queueScrollTop, setQueueScrollTop] = useState(0);
  const [queueViewportHeight, setQueueViewportHeight] = useState(480);
  const queueScrollRef = useRef<HTMLDivElement>(null);
  const queueScrollTopRef = useRef(0);
  const isVirtualized = items.length >= QUEUE_VIRTUALIZATION_THRESHOLD;
  const downloadNameMap = useMemo(
    () => buildExportNameMap(items, settings),
    [items, settings]
  );
  const pendingCount = items.filter(i => i.status === 'pending' && !i.excluded).length;
  const allSelected = items.length > 0 && items.every((item) => item.selected);

  useEffect(() => {
    if (!isVirtualized) return undefined;

    const scrollElement = queueScrollRef.current;
    if (!scrollElement) return undefined;

    const updateViewport = () => {
      const rect = scrollElement.getBoundingClientRect();
      setQueueViewportHeight(Math.max(1, scrollElement.clientHeight || rect.height || 480));
    };

    updateViewport();
    queueScrollTopRef.current = scrollElement.scrollTop;
    setQueueScrollTop(queueScrollTopRef.current);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateViewport) : null;
    observer?.observe(scrollElement);
    window.addEventListener('resize', updateViewport);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateViewport);
    };
  }, [isVirtualized, items.length]);

  const startIndex = isVirtualized
    ? Math.min(
        Math.max(0, items.length - 1),
        Math.max(0, Math.floor(queueScrollTop / QUEUE_ROW_HEIGHT) - QUEUE_OVERSCAN),
      )
    : 0;
  const endIndex = isVirtualized
    ? Math.min(
        items.length,
        startIndex + Math.ceil(queueViewportHeight / QUEUE_ROW_HEIGHT) + QUEUE_OVERSCAN * 2,
      )
    : items.length;
  const queueContentHeight = Math.max(0, items.length * QUEUE_ROW_HEIGHT - QUEUE_GAP);

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

  const handleQueueScroll = () => {
    const nextScrollTop = queueScrollRef.current?.scrollTop ?? 0;
    queueScrollTopRef.current = nextScrollTop;
    if (isVirtualized) setQueueScrollTop(nextScrollTop);
  };

  const renderQueueItem = (item: ImageItem, index: number) => {
    const outputName = downloadNameMap.get(item.id) || item.originalName;
    const isActive = item.id === activeItemId;
    const isReady = !!getResolvedBlob(item);
    const hasResult = item.status === 'completed' && !!item.resultSize;
    const itemSettings = resolveSettingsForItem(settings, item);
    const color = statusColor(item);

    return (
      <WithHoverTooltip
        key={item.id}
        label={t('optimizer.queue.dragHint')}
        placement="bottom"
        className="block w-full"
        style={isVirtualized
          ? {
            height: QUEUE_ITEM_HEIGHT,
            left: 0,
            position: 'absolute',
            right: 0,
            top: index * QUEUE_ROW_HEIGHT,
          }
          : undefined}
      >
        <div
          data-virtualized-queue-row="true"
          data-virtualized-queue-row-index={isVirtualized ? index : undefined}
          draggable
          onDragStart={(e) => handleDragStart(e, item.id)}
          onDragOver={(e) => handleDragOver(e, item.id)}
          onDragLeave={() => setDropTargetId((current) => current === item.id ? null : current)}
          onDrop={(e) => handleDrop(e, item.id)}
          onDragEnd={resetDragState}
          className={`group flex h-[52px] w-full flex-none cursor-pointer items-center gap-3 overflow-hidden rounded-lg px-3 transition-[background-color,opacity] duration-150 ${
            isActive
              ? 'bg-[var(--bg-input)]'
              : 'hover:bg-[var(--bg-input)]'
          } ${dropTargetId === item.id ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)]' : ''} ${draggedItemId === item.id ? 'opacity-55' : item.excluded ? 'opacity-45' : ''}`}
          onClick={() => onSetActiveItem(item.id)}
          role="button"
          tabIndex={0}
          aria-label={`Ver ${item.originalName}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSetActiveItem(item.id);
            }
          }}
        >
          <GripVertical size={14} className="-mx-1 shrink-0 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100" />

          <input
            type="checkbox"
            checked={item.selected}
            onChange={() => onToggleSelection(item.id)}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent-primary)]"
          />

          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-[var(--bg-input)]">
            {item.preview ? (
              <img src={item.preview} alt={item.originalName} loading="lazy" decoding="async" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <ImageIcon size={14} className="text-[var(--text-secondary)]" />
              </div>
            )}
            {item.status === 'processing' && (
              <div className="absolute inset-0 flex items-center justify-center bg-[color:color-mix(in_srgb,var(--bg-base)_55%,transparent)]">
                <Loader2 size={14} className="animate-spin text-[var(--text-primary)]" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 overflow-hidden">
            <p className={`truncate text-[13px] leading-tight text-[var(--text-primary)] ${item.excluded ? 'line-through' : ''}`}>
              {outputName}
            </p>
            <p className="mt-1 truncate whitespace-nowrap font-mono text-[12px] tabular-nums leading-tight text-[var(--text-secondary)]">
              {formatBytes(item.originalSize)}
              {hasResult && item.resultSize != null && (
                <span className="text-[var(--accent-green)]">{' → '}{formatBytes(item.resultSize)}</span>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center">
            <div className="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
              <WithHoverTooltip label={t('optimizer.queue.cropEditor')} placement="bottom">
                <Button variant="none" size="none"
                  aria-label={t('optimizer.queue.cropEditor')}
                  onClick={(e) => { e.stopPropagation(); onOpenCropEditor(item.id); }}
                  disabled={!itemSettings.operations.cropEnabled || itemSettings.crop.aspectRatio === 'original'}
                  className={iconBtn}
                >
                  <Crop size={14} />
                </Button>
              </WithHoverTooltip>
              <WithHoverTooltip label={t('optimizer.preview.download')} placement="bottom">
                <Button variant="none" size="none"
                  aria-label={t('optimizer.preview.download')}
                  onClick={(e) => { e.stopPropagation(); onDownloadSingle(item); }}
                  disabled={!isReady}
                  className={iconBtn}
                >
                  <FileDown size={14} />
                </Button>
              </WithHoverTooltip>
              <WithHoverTooltip label={t('optimizer.queue.remove')} placement="bottom">
                <Button variant="none" size="none"
                  aria-label={t('optimizer.queue.remove')}
                  onClick={(e) => { e.stopPropagation(); onRemoveItem(item.id); }}
                  className={`${iconBtn} hover:bg-[color:color-mix(in_srgb,var(--accent-red)_10%,transparent)] hover:text-[var(--accent-red)]`}
                >
                  <Trash2 size={14} />
                </Button>
              </WithHoverTooltip>
            </div>
            <span
              className={`ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.status === 'processing' ? 'animate-pulse' : ''}`}
              style={{ backgroundColor: color }}
              title={item.status === 'error' ? (item.error ?? undefined) : undefined}
            />
          </div>
        </div>
      </WithHoverTooltip>
    );
  };

  return (
    <section data-surface-part="queue" className={`relative flex h-full flex-col overflow-hidden ${glassPanelClass}`}>
      <header className="flex shrink-0 flex-col gap-2 px-5 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[14px] font-medium text-[var(--text-primary)]">
            {t('optimizer.queue.title')} <span className="ml-1 font-mono text-[12px] font-normal tabular-nums text-[var(--text-muted)]">{items.length}</span>
          </p>
          <div className="flex items-center gap-1">
            <Button variant="none" size="none" onClick={onSelectAll} className={chipBtn}>
              {allSelected ? t('optimizer.queue.deselectAll') : t('optimizer.queue.selectAll')}
            </Button>
            {selectedCount > 0 && (
              <Button variant="none" size="none" onClick={onClearSelection} className={chipBtn}>
                {t('optimizer.queue.clearSelection')}
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] tabular-nums text-[var(--text-secondary)]">
          <span>{t('optimizer.queue.included', { count: includedCount })}</span>
          {pendingCount > 0 && <span>{t('optimizer.queue.pending', { count: pendingCount })}</span>}
          {downloadableItems.length > 0 && (
            <span className="text-[var(--accent-green)]">{t('optimizer.queue.ready', { count: downloadableItems.length })}</span>
          )}
        </div>
        {selectedCount > 0 && (
          <div className="flex flex-wrap gap-1">
            <Button variant="none" size="none" onClick={onApplyPresetToSelection} className={chipBtn}>{t('optimizer.queue.applyPreset')}</Button>
            <Button variant="none" size="none" onClick={onReprocessSelected} className={chipBtn}>{t('optimizer.queue.reprocess')}</Button>
            <Button variant="none" size="none" onClick={onToggleExcludeSelected} className={chipBtn}>{t('optimizer.queue.exclude')}</Button>
            <Button variant="none" size="none"
              onClick={onRemoveSelected}
              className="h-7 rounded-md bg-[color:color-mix(in_srgb,var(--accent-red)_10%,transparent)] px-2.5 text-[12px] font-medium text-[var(--accent-red)] transition-[background-color,transform] duration-150 hover:bg-[color:color-mix(in_srgb,var(--accent-red)_16%,transparent)] active:scale-[0.97] motion-reduce:active:scale-100"
            >
              {t('optimizer.queue.remove')}
            </Button>
          </div>
        )}
      </header>

      <div
        ref={queueScrollRef}
        data-virtualized-queue={isVirtualized ? 'true' : undefined}
        data-image-optimizer-queue-scroll="true"
        onScroll={handleQueueScroll}
        className="custom-scrollbar relative flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2"
      >
        <div
          data-virtualized-queue-content={isVirtualized ? 'true' : undefined}
          className={isVirtualized ? 'relative w-full' : 'flex w-full flex-1 flex-col gap-0.5'}
          style={isVirtualized ? { height: queueContentHeight } : undefined}
        >
          {isVirtualized
            ? Array.from({ length: endIndex - startIndex }, (_, offset) => {
              const item = items[startIndex + offset];
              return item ? renderQueueItem(item, startIndex + offset) : null;
            })
            : items.map((item, index) => renderQueueItem(item, index))}

          {items.length === 0 && (
            <div className="flex h-full min-h-[7rem] w-full flex-1 flex-col items-center justify-center gap-2 text-center">
              <ImageIcon size={18} className="text-[var(--text-muted)]" />
              <p className="text-[13px] text-[var(--text-secondary)]">{t('optimizer.queue.empty')}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
