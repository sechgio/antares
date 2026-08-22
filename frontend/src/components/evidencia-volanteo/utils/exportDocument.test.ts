import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalImage, LogoAsset } from '../types';
import { imageExportKey } from './buildExportHtml';
import { buildImagePayload, exportEvidenciaDocument, readLogoOnce } from './exportDocument';

const renderMock = vi.fn(async () => ({
  filename: 'out.pdf',
  pdf_base64: btoa('pdf'),
  content_base64: btoa('pdf'),
}));

vi.mock('../../../api', () => ({
  api: {
    dialogSave: vi.fn(async () => ({ paths: [] })),
    evidenciaVolanteoRender: (...args: unknown[]) => renderMock(...args),
  },
}));

function makeFile(name: string, body = 'img-bytes', type = 'image/jpeg'): File {
  return new File([body], name, { type });
}

function makeImage(name: string, localPath?: string): LocalImage {
  return {
    file: makeFile(name),
    objectUrl: `blob:${name}`,
    localPath,
  };
}

describe('buildImagePayload', () => {
  it('prefers local paths and skips Base64 when path is valid (DOCX mode)', async () => {
    const images = [
      makeImage('a.jpg', 'C:\\fotos\\a.jpg'),
      makeImage('b.jpg', 'D:/fotos/b.jpg'),
    ];
    const payload = await buildImagePayload(images, { needDataUris: false });
    expect(payload.imagePaths['0::a.jpg']).toBe('C:\\fotos\\a.jpg');
    expect(payload.imagePaths['1::b.jpg']).toBe('D:/fotos/b.jpg');
    expect(Object.keys(payload.imagesBase64)).toHaveLength(0);
    expect(Object.keys(payload.imageDataUris)).toHaveLength(0);
  });

  it('falls back to Base64 when path is missing or blank', async () => {
    const images = [makeImage('x.jpg'), makeImage('y.jpg', '   ')];
    const payload = await buildImagePayload(images, { needDataUris: false });
    expect(Object.keys(payload.imagePaths)).toHaveLength(0);
    expect(payload.imagesBase64['0::x.jpg']).toBeTruthy();
    expect(payload.imagesBase64['1::y.jpg']).toBeTruthy();
  });

  it('builds data URIs for PDF HTML without putting path images into imagesBase64', async () => {
    const images = [makeImage('a.jpg', 'C:\\fotos\\a.jpg'), makeImage('b.jpg')];
    const payload = await buildImagePayload(images, { needDataUris: true });
    expect(payload.imagePaths['0::a.jpg']).toBe('C:\\fotos\\a.jpg');
    expect(payload.imagesBase64['0::a.jpg']).toBeUndefined();
    expect(payload.imagesBase64['1::b.jpg']).toBeTruthy();
    expect(payload.imageDataUris['0::a.jpg']).toMatch(/^data:image\/jpeg;base64,/);
    expect(payload.imageDataUris['1::b.jpg']).toMatch(/^data:image\/jpeg;base64,/);
  });
});

describe('readLogoOnce', () => {
  it('reads each logo file once and reuses b64 for URI', async () => {
    const file = makeFile('logo.png', 'logo', 'image/png');
    const logo: LogoAsset = { file, objectUrl: 'blob:logo' };
    const once = await readLogoOnce(logo);
    expect(once.b64).toBeTruthy();
    expect(once.dataUri).toBe(`data:image/png;base64,${once.b64}`);
  });
});

describe('exportEvidenciaDocument payload', () => {
  beforeEach(() => {
    renderMock.mockClear();
    vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
    vi.spyOn(document.body, 'removeChild').mockImplementation((n) => n);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:dl');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    HTMLAnchorElement.prototype.click = vi.fn();
  });

  it('PDF with html omits images and image_paths duplicates', async () => {
    const images = [makeImage('a.jpg', 'C:\\fotos\\a.jpg')];
    // Force browser download path: dialogSave returns no path via electron mock above.
    // exportEvidenciaDocument checks window.electronAPI?.invoke — stub without invoke.
    (window as unknown as { electronAPI?: { invoke?: unknown } }).electronAPI = {};
    await exportEvidenciaDocument('T', [], images, null, null, 'pdf');
    expect(renderMock).toHaveBeenCalledTimes(1);
    const body = renderMock.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof body.html).toBe('string');
    expect(body.html).toContain('data:image/jpeg;base64,');
    expect(body.images).toBeUndefined();
    expect(body.image_paths).toBeUndefined();
  });

  it('DOCX sends paths first and Base64 only for pathless images', async () => {
    (window as unknown as { electronAPI?: { invoke?: unknown } }).electronAPI = {};
    renderMock.mockResolvedValueOnce({
      filename: 'out.docx',
      pdf_base64: btoa('docx'),
      content_base64: btoa('docx'),
    });
    const images = [
      makeImage('a.jpg', 'C:\\fotos\\a.jpg'),
      makeImage('b.jpg'),
    ];
    await exportEvidenciaDocument('T', [], images, null, null, 'docx');
    const body = renderMock.mock.calls[0][0] as {
      images: Record<string, string>;
      image_paths: Record<string, string>;
      html?: string;
    };
    expect(body.html).toBeUndefined();
    expect(body.image_paths[imageExportKey(0, 'a.jpg')]).toBe('C:\\fotos\\a.jpg');
    expect(body.images[imageExportKey(0, 'a.jpg')]).toBeUndefined();
    expect(body.images[imageExportKey(1, 'b.jpg')]).toBeTruthy();
  });

  it('works without local paths (browser fallback)', async () => {
    (window as unknown as { electronAPI?: { invoke?: unknown } }).electronAPI = {};
    const images = [makeImage('only.jpg')];
    await exportEvidenciaDocument('T', [], images, null, null, 'pdf');
    const body = renderMock.mock.calls[0][0] as { html: string };
    expect(body.html).toContain('data:image/jpeg;base64,');
  });
});
