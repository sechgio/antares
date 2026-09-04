import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ImageItem } from './types';
import { DEFAULT_BATCH_SETTINGS } from './presets';
import PreviewWorkspace from './PreviewWorkspace';
import QueuePanel from './QueuePanel';

function makeItems(count: number): ImageItem[] {
  return Array.from({ length: count }, (_, index) => {
    const name = `image-${index}.jpg`;
    const file = new File(['pixel'], name, { type: 'image/jpeg' });
    return {
      id: `item-${index}`,
      sourceFile: file,
      preview: '',
      originalName: name,
      originalSize: file.size,
      status: 'pending',
      stale: false,
      selected: false,
      excluded: false,
      overrides: {
        customFilename: '',
        customCropOffset: undefined,
        excluded: false,
        skipCompression: false,
        presetId: null,
      },
    };
  });
}

function mockViewport(width = 640, height = 480): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function renderQueue(items: ImageItem[]) {
  return render(
    <QueuePanel
      items={items}
      settings={DEFAULT_BATCH_SETTINGS}
      activeItemId={items[0]?.id ?? null}
      selectedCount={0}
      includedCount={items.length}
      downloadableItems={[]}
      onSelectAll={vi.fn()}
      onClearSelection={vi.fn()}
      onApplyPresetToSelection={vi.fn()}
      onReprocessSelected={vi.fn()}
      onToggleExcludeSelected={vi.fn()}
      onRemoveSelected={vi.fn()}
      onToggleSelection={vi.fn()}
      onSetActiveItem={vi.fn()}
      onOpenCropEditor={vi.fn()}
      onDownloadSingle={vi.fn()}
      onRemoveItem={vi.fn()}
      onReorderItems={vi.fn()}
      getResolvedBlob={() => null}
    />,
  );
}

function renderGrid(items: ImageItem[]) {
  return render(
    <PreviewWorkspace
      items={items}
      downloadNameMap={new Map()}
      activeItem={null}
      activeItemSettings={DEFAULT_BATCH_SETTINGS}
      activeItemOutputName=""
      activeItemDownloadable={false}
      activeIsDirect={false}
      activeCropPreview={null}
      previewTab="original"
      processing={false}
      processingProgress={{ current: 0, total: 0 }}
      processingMessage=""
      primaryActionLabel="Procesar"
      viewMode="grid"
      onChangePreviewTab={vi.fn()}
      onViewModeChange={vi.fn()}
      onSetActiveItem={vi.fn()}
      onDownloadSingle={vi.fn()}
      onRemoveItem={vi.fn()}
      onOpenCropEditor={vi.fn()}
      onUpdateCustomFilename={vi.fn()}
      onUpdatePresetOverride={vi.fn()}
      onToggleSkipCompression={vi.fn()}
      onToggleExcluded={vi.fn()}
      onClearPresetOverride={vi.fn()}
      onAddClick={vi.fn()}
      isDragActive={false}
      onDragEnter={vi.fn()}
      onDragLeave={vi.fn()}
      onDragOver={vi.fn()}
      onDrop={vi.fn()}
    />,
  );
}

describe('image optimizer virtualization', () => {
  it('keeps small queues fully rendered for the existing interaction path', () => {
    const items = makeItems(3);
    const { container } = renderQueue(items);

    expect(container.querySelector('[data-virtualized-queue]')).toBeNull();
    expect(container.querySelectorAll('[draggable="true"]')).toHaveLength(items.length);
  });

  it('renders only visible queue rows for large batches', async () => {
    mockViewport();
    const items = makeItems(200);
    const { container } = renderQueue(items);

    await waitFor(() => expect(container.querySelector('[data-virtualized-queue]')).not.toBeNull());

    const renderedRows = container.querySelectorAll('[draggable="true"]');
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(items.length);
  });

  it('renders only visible grid rows for large batches', async () => {
    mockViewport();
    const items = makeItems(200);
    const { container } = renderGrid(items);

    await waitFor(() => expect(container.querySelector('[data-virtualized-grid]')).not.toBeNull());

    const renderedCards = container.querySelectorAll('[data-image-optimizer-card]');
    expect(renderedCards.length).toBeGreaterThan(0);
    expect(renderedCards.length).toBeLessThan(items.length);
  });
});
