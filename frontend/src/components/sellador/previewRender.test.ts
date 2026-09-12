import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderOtherPagesPreview } from './previewRender';

const mocks = vi.hoisted(() => ({
  acquireStagedFile: vi.fn(),
  stageFileForIpc: vi.fn(),
  cleanupStagedToken: vi.fn(),
  selladorRenderPage: vi.fn(),
}));

vi.mock('../../utils/stageFile', () => ({
  acquireStagedFile: mocks.acquireStagedFile,
  stageFileForIpc: mocks.stageFileForIpc,
  cleanupStagedToken: mocks.cleanupStagedToken,
}));

vi.mock('../../api', () => ({
  api: { selladorRenderPage: mocks.selladorRenderPage },
}));

vi.mock('./pdfjs', () => ({
  loadPdfDocument: vi.fn(async () => ({ destroy: vi.fn(async () => {}), getPage: vi.fn(async () => ({})) })),
}));

const STAGED_TOKEN = 'antares-read_staged_1';
const PAGE_SIZE = { width: 595, height: 842 };

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    pdfPath: null,
    pdfBase64: null,
    pdfFile: null,
    sourceRevision: 0,
    pageCount: 6,
    containerW: 800,
    stampUrl: null,
    placementsByPage: new Map(),
    pageSize: PAGE_SIZE,
    assignmentCounts: new Map(),
    onProgress: () => {},
    isCancelled: () => false,
    ...overrides,
  } as Parameters<typeof renderOtherPagesPreview>[0];
}

describe('renderOtherPagesPreview staging', () => {
  let release: ReturnType<typeof vi.fn>;
  let originalImage: typeof globalThis.Image;

  beforeEach(() => {
    release = vi.fn();
    mocks.acquireStagedFile.mockReset();
    mocks.stageFileForIpc.mockReset();
    mocks.cleanupStagedToken.mockReset();
    mocks.selladorRenderPage.mockReset();

    mocks.acquireStagedFile.mockImplementation(async () => ({ token: STAGED_TOKEN, release }));
    mocks.selladorRenderPage.mockResolvedValue({
      mime_type: 'image/png',
      image_base64: 'cGFnZQ==',
      page_width: PAGE_SIZE.width,
      page_height: PAGE_SIZE.height,
    });

    originalImage = globalThis.Image;
    class StubImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = PAGE_SIZE.width;
      naturalHeight = PAGE_SIZE.height;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', StubImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,cGFnZQ==');
  });

  afterEach(() => {
    vi.stubGlobal('Image', originalImage);
    vi.restoreAllMocks();
  });

  it('stages the PDF once for the whole batch instead of once per page', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'batch.pdf');
    const progress: Array<Array<{ pageNum: number }>> = [];

    await renderOtherPagesPreview(baseOptions({
      pdfFile: file,
      sourceRevision: 1,
      containerW: 800,
      onProgress: (previews: Array<{ pageNum: number }>) => progress.push(previews),
    }));

    // Pages 2..6 → five renders, but only one staged upload.
    expect(mocks.selladorRenderPage).toHaveBeenCalledTimes(5);
    expect(mocks.acquireStagedFile).toHaveBeenCalledTimes(1);
    expect(mocks.acquireStagedFile).toHaveBeenCalledWith(file);
    expect(mocks.stageFileForIpc).not.toHaveBeenCalled();

    for (const call of mocks.selladorRenderPage.mock.calls) {
      expect((call[0] as { pdf_path: string }).pdf_path).toBe(STAGED_TOKEN);
    }

    expect(release).toHaveBeenCalledTimes(1);
    expect(progress[progress.length - 1]).toHaveLength(5);
  });

  it('releases the staged source when the batch is cancelled midway', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'cancel.pdf');
    let rendered = 0;
    mocks.selladorRenderPage.mockImplementation(async () => {
      rendered += 1;
      return {
        mime_type: 'image/png',
        image_base64: 'cGFnZQ==',
        page_width: PAGE_SIZE.width,
        page_height: PAGE_SIZE.height,
      };
    });

    await renderOtherPagesPreview(baseOptions({
      pdfFile: file,
      sourceRevision: 2,
      pageCount: 10,
      containerW: 1200,
      isCancelled: () => rendered >= 2,
    }));

    expect(rendered).toBe(2);
    expect(mocks.acquireStagedFile).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases the handle when staging yields no capability', async () => {
    mocks.acquireStagedFile.mockImplementation(async () => ({ token: null, release }));
    const file = new File([new Uint8Array([1, 2, 3])], 'notoken.pdf');

    await expect(renderOtherPagesPreview(baseOptions({
      pdfFile: file,
      sourceRevision: 3,
      containerW: 1400,
    }))).rejects.toThrow('No se pudo preparar el PDF para la vista previa.');

    expect(release).toHaveBeenCalledTimes(1);
    expect(mocks.selladorRenderPage).not.toHaveBeenCalled();
  });

  it('does not stage when the source is already a resolved path', async () => {
    await renderOtherPagesPreview(baseOptions({
      pdfPath: 'antares-read_dialog',
      sourceRevision: 4,
      containerW: 1600,
    }));

    expect(mocks.acquireStagedFile).not.toHaveBeenCalled();
    expect(mocks.selladorRenderPage).toHaveBeenCalledTimes(5);
    expect(release).not.toHaveBeenCalled();
  });
});
