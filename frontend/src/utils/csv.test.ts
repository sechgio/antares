import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadCsvFromBase64 } from './csv';

describe('downloadCsvFromBase64', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a blob link and triggers download', () => {
    const createObjectUrl = vi.fn(() => 'blob:mock');
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectUrl, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectUrl, configurable: true });

    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') {
        el.click = clickSpy;
      }
      return el;
    }) as typeof document.createElement);

    // "id,run_type" in base64
    downloadCsvFromBase64('historial.csv', 'aWQscnVuX3R5cGU=');

    expect(createObjectUrl).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:mock');
  });
});
