import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PreviewPanel from './PreviewPanel';

describe('PreviewPanel image URLs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not publish iframe HTML before URLs exist for the current images', async () => {
    const images = [
      new File(['one'], '71534759_1.jpg', { type: 'image/jpeg' }),
      new File(['two'], '71534759_2.jpg', { type: 'image/jpeg' }),
    ];
    const srcDocs: string[] = [];
    const setAttribute = Element.prototype.setAttribute;

    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      (file) => `blob:preview/${(file as File).name}`,
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (name, value) {
      if (this instanceof HTMLIFrameElement && name.toLowerCase() === 'srcdoc') {
        srcDocs.push(value);
      }
      setAttribute.call(this, name, value);
    });

    render(<PreviewPanel images={images} />);

    await waitFor(() => {
      expect(srcDocs.some((html) => html.includes('blob:preview/71534759_1.jpg'))).toBe(true);
    });
    expect(srcDocs.some((html) => html.includes('src=""'))).toBe(false);
  });
});
