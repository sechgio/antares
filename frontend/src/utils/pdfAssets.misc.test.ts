import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildLocalImageToken,
  buildTimestampedFilename,
  downloadBase64Blob,
  downloadBase64Pdf,
  fileToBase64,
  fileToDataUrl,
  imageToPdfDataUrl,
  logoToPdfSource,
} from './pdfAssets';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fileToDataUrl / fileToBase64', () => {
  it('lee el archivo vía FileReader y devuelve data URL', async () => {
    const file = new File(['hola'], 'a.png', { type: 'image/png' });
    const url = await fileToDataUrl(file);
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect(await fileToBase64(file)).toBe('aG9sYQ==');
  });

  it('usa arrayBuffer cuando no hay FileReader', async () => {
    vi.stubGlobal('FileReader', undefined);
    const file = new File(['abc'], 'a.bin', { type: '' });
    const url = await fileToDataUrl(file);
    expect(url).toBe('data:application/octet-stream;base64,YWJj');
  });
});

describe('logoToPdfSource con URLs remotas', () => {
  it('convierte un blob: URL en data URL persistible', async () => {
    const blob = new Blob(['px'], { type: 'image/png' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ blob: async () => blob })),
    );
    const src = await logoToPdfSource('blob:logo', null, 'logo', {}, false);
    expect(src).toMatch(/^data:/);
  });

  it('convierte http(s) en data URL y conserva data:/otros esquemas', async () => {
    const blob = new Blob(['px'], { type: 'image/png' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ blob: async () => blob })),
    );
    expect(
      await logoToPdfSource('https://x/logo.png', null, 'logo', {}, false),
    ).toMatch(/^data:/);
    expect(
      await logoToPdfSource('data:image/png;base64,AA==', null, 'l', {}, false),
    ).toBe('data:image/png;base64,AA==');
    expect(
      await logoToPdfSource('file:///c/logo.png', null, 'l', {}, false),
    ).toBe('file:///c/logo.png');
  });

  it('devuelve la URL original cuando fetch falla', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('off'))),
    );
    expect(await logoToPdfSource('blob:logo', null, 'l', {}, false)).toBe(
      'blob:logo',
    );
  });
});

describe('imageToPdfDataUrl', () => {
  it('quality=max devuelve el data URL sin comprimir', async () => {
    const file = new File(['pixeles'], 'a.png', { type: 'image/png' });
    expect(await imageToPdfDataUrl(file, 'max')).toMatch(
      /^data:image\/png;base64,/,
    );
  });

  it('cae a fileToDataUrl cuando la compresión falla (Image error)', async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FailingImage);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:x'),
      revokeObjectURL: vi.fn(),
    });
    const file = new File(['pix'], 'a.png', { type: 'image/png' });
    for (const quality of ['high', 'low'] as const) {
      expect(await imageToPdfDataUrl(file, quality)).toMatch(
        /^data:image\/png;base64,/,
      );
    }
  });
});

describe('buildLocalImageToken / buildTimestampedFilename', () => {
  it('sanitiza caracteres del token', () => {
    expect(buildLocalImageToken('fila 1/foto.0')).toBe(
      'antares-local-image:fila_1_foto_0',
    );
  });

  it('genera nombre con timestamp y extensión', () => {
    const name = buildTimestampedFilename('informe', 'pdf');
    expect(name).toMatch(/^informe_\d{8}_\d{6}\.pdf$/);
  });
});

describe('downloadBase64Blob', () => {
  it('crea un blob, anchor y revoca la URL', async () => {
    const revoke = vi.fn();
    const create = vi.fn(() => 'blob:dl');
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.fn();
    const anchor = { href: '', download: '', click, remove: vi.fn() };
    vi.spyOn(document, 'createElement').mockImplementation(
      () => anchor as unknown as HTMLElement,
    );
    vi.spyOn(document.body, 'appendChild').mockImplementation((n) => n);
    downloadBase64Pdf('QUJD', 'x.pdf');
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe('x.pdf');
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:dl'));
    downloadBase64Blob('QUJD', 'y.txt', 'text/plain');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
