import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

function queueElement(items: ImageItem[]) {
  return (
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
    />
  );
}

function renderQueue(items: ImageItem[]) {
  return render(queueElement(items));
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
  afterEach(() => vi.restoreAllMocks());

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

  it('reserves the real queue interval, including the row gap', async () => {
    mockViewport();
    const items = makeItems(200);
    const { container } = renderQueue(items);

    await waitFor(() => expect(container.querySelector('[data-virtualized-queue-content]')).not.toBeNull());

    const content = container.querySelector('[data-virtualized-queue-content]') as HTMLElement;
    expect(content.style.height).toBe(`${items.length * 44 - 4}px`);

    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-virtualized-queue-row]'));
    expect(rows[0]?.parentElement?.style.top).toBe('0px');
    expect(rows[1]?.parentElement?.style.top).toBe('44px');
    expect(rows[0]?.parentElement?.style.height).toBe('40px');
  });

  it('maps a deep queue scroll offset to the same 44 px row interval', async () => {
    mockViewport();
    const { container } = renderQueue(makeItems(200));
    const scrollElement = container.querySelector('[data-image-optimizer-queue-scroll]') as HTMLElement;

    await waitFor(() => expect(container.querySelector('[data-virtualized-queue]')).not.toBeNull());
    Object.defineProperty(scrollElement, 'scrollTop', { configurable: true, value: 44 * 50, writable: true });
    fireEvent.scroll(scrollElement);

    await waitFor(() => {
      const firstRow = container.querySelector('[data-virtualized-queue-row]') as HTMLElement;
      expect(firstRow.dataset.virtualizedQueueRowIndex).toBe('44');
    });
  });

  it('keeps the scroll anchor when a small queue crosses the virtualization threshold', async () => {
    const items = makeItems(99);
    const { container, rerender } = renderQueue(items);
    const scrollElement = container.querySelector('[data-image-optimizer-queue-scroll]') as HTMLElement;
    Object.defineProperty(scrollElement, 'scrollTop', { configurable: true, value: 500, writable: true });
    fireEvent.scroll(scrollElement);

    rerender(queueElement(makeItems(200)));

    await waitFor(() => expect(container.querySelector('[data-virtualized-queue]')).not.toBeNull());
    const firstRow = container.querySelector('[data-virtualized-queue-row]') as HTMLElement;
    expect(firstRow.dataset.virtualizedQueueRowIndex).toBe('5');
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

  it('derives grid card and row heights from the measured width', async () => {
    mockViewport(320, 480);
    const items = makeItems(200);
    const { container } = renderGrid(items);

    await waitFor(() => expect(container.querySelector('[data-virtualized-grid-content]')).not.toBeNull());

    const content = container.querySelector('[data-virtualized-grid-content]') as HTMLElement;
    const row = container.querySelector('[data-virtualized-grid-row]') as HTMLElement;
    const card = container.querySelector('[data-image-optimizer-card]') as HTMLElement;

    expect(card.style.height).toBe('440px');
    expect(row.style.top).toBe('0px');
    expect(container.querySelectorAll('[data-virtualized-grid-row]')[1]).toHaveStyle({ top: '448px' });
    expect(content.style.height).toBe(`${items.length * 448 - 8}px`);
  });

  it('maps a deep grid scroll offset to the measured card row interval', async () => {
    mockViewport(320, 480);
    const { container } = renderGrid(makeItems(200));
    const scrollElement = container.querySelector('[data-image-optimizer-grid-scroll]') as HTMLElement;

    await waitFor(() => expect(container.querySelector('[data-virtualized-grid-row]')).not.toBeNull());
    Object.defineProperty(scrollElement, 'scrollTop', { configurable: true, value: 448 * 10, writable: true });
    fireEvent.scroll(scrollElement);

    await waitFor(() => {
      const firstRow = container.querySelector('[data-virtualized-grid-row]') as HTMLElement;
      expect(firstRow.dataset.virtualizedGridRowIndex).toBe('8');
    });
  });

  it('recalculates grid geometry when the container width changes', async () => {
    let width = 320;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      width,
      height: 480,
      top: 0,
      right: width,
      bottom: 480,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect));
    const { container } = renderGrid(makeItems(200));

    await waitFor(() => expect(container.querySelector('[data-image-optimizer-card]')).not.toBeNull());
    const card = container.querySelector('[data-image-optimizer-card]') as HTMLElement;
    const narrowHeight = Number.parseFloat(card.style.height);

    width = 1024;
    fireEvent(window, new Event('resize'));

    await waitFor(() => expect(Number.parseFloat(card.style.height)).toBeLessThan(narrowHeight));
    const row = container.querySelector('[data-virtualized-grid-row]') as HTMLElement;
    expect(row.style.gridTemplateColumns).toBe('repeat(6, minmax(0, 1fr))');
  });

  it('keeps long card metadata inside a bounded card row', async () => {
    mockViewport(320, 480);
    const items = makeItems(200);
    items[0] = {
      ...items[0],
      originalName: 'very-long-name-'.repeat(80),
      sourceWidth: 123456789,
      sourceHeight: 987654321,
      resultSize: 123456789,
    };
    const { container } = renderGrid(items);

    await waitFor(() => expect(container.querySelector('[data-image-optimizer-card]')).not.toBeNull());

    const card = container.querySelector('[data-image-optimizer-card]') as HTMLElement;
    const metadata = card.querySelector('p.font-mono') as HTMLElement;
    expect(card.querySelector('.h-10')).not.toBeNull();
    expect(metadata.className).toMatch(/truncate/);
    expect(metadata.className).toMatch(/whitespace-nowrap/);
  });
});
