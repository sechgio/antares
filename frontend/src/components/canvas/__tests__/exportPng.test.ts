import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportPagePng,
  needsImageCacheBust,
  stripSelectionChrome,
} from '../ops/exportPng';
import { createLayer } from '../constants';
import { createEmptyDocument } from '../types';

const { toPngSpy } = vi.hoisted(() => ({
  toPngSpy: vi.fn<(node: HTMLElement) => Promise<string>>(),
}));

vi.mock('html-to-image', () => ({ toPng: toPngSpy }));

beforeEach(() => {
  toPngSpy.mockReset().mockResolvedValue('data:image/png;base64,AA==');
});

describe('needsImageCacheBust', () => {
  it('is false for blob: and data: images (and empty roots)', () => {
    const root = document.createElement('div');
    expect(needsImageCacheBust(root)).toBe(false);

    const blobImg = document.createElement('img');
    blobImg.setAttribute('src', 'blob:http://localhost/abc');
    root.appendChild(blobImg);
    const dataImg = document.createElement('img');
    dataImg.setAttribute('src', 'data:image/png;base64,AAA');
    root.appendChild(dataImg);
    expect(needsImageCacheBust(root)).toBe(false);
  });

  it('is true when any image is a remote http(s) URL', () => {
    const root = document.createElement('div');
    const img = document.createElement('img');
    img.setAttribute('src', 'https://cdn.example.com/photo.png');
    root.appendChild(img);
    expect(needsImageCacheBust(root)).toBe(true);
  });
});

describe('stripSelectionChrome', () => {
  it('strips selection ring, transform, handles; keeps real shadows', () => {
    const el = document.createElement('div');
    el.setAttribute('data-selected', '');
    el.style.transform = 'translate(50px, 20px)';
    el.style.boxShadow = '0 0 8px rgba(0,0,0,.5), 0 0 0 1px var(--cv-accent)';
    const handle = document.createElement('div');
    handle.setAttribute('data-handle', 'nw');
    el.appendChild(handle);

    const clone = stripSelectionChrome(el);
    expect(clone.hasAttribute('data-selected')).toBe(false);
    expect(clone.style.transform).toBe('none');
    expect(clone.style.boxShadow).toBe('0 0 8px rgba(0,0,0,.5)');
    expect(clone.querySelector('[data-handle]')).toBeNull();
  });

  it('leaves box-shadow intact when there is no selection ring', () => {
    const el = document.createElement('div');
    el.style.boxShadow = '0 2px 4px rgba(0,0,0,.3)';
    const clone = stripSelectionChrome(el);
    expect(clone.style.boxShadow).toBe('0 2px 4px rgba(0,0,0,.3)');
  });
});

describe('exportPagePng', () => {
  it('renders every document layer instead of exporting only mounted viewport layers', async () => {
    const doc = createEmptyDocument('Export');
    doc.layers = [
      createLayer('rect', {
        id: 'left',
        cssVars: {
          '--translate-x': '5mm',
          '--translate-y': '150mm',
          '--width': '10mm',
          '--height': '10mm',
        },
      }),
      createLayer('rect', {
        id: 'center',
        cssVars: {
          '--translate-x': '100mm',
          '--translate-y': '150mm',
          '--width': '10mm',
          '--height': '10mm',
        },
      }),
      createLayer('rect', {
        id: 'operand',
        cssVars: {
          '--translate-x': '50mm',
          '--translate-y': '150mm',
          '--width': '10mm',
          '--height': '10mm',
        },
      }),
      createLayer('rect', {
        id: 'right',
        cssVars: {
          '--translate-x': '195mm',
          '--translate-y': '150mm',
          '--width': '10mm',
          '--height': '10mm',
        },
      }),
      createLayer('boolean', {
        id: 'composed',
        meta: { ops: [{ op: 'union', layerId: 'operand' }] },
      }),
    ];
    const layerIds: string[] = [];
    toPngSpy.mockImplementation(async (node) => {
      layerIds.push(
        ...Array.from(node.querySelectorAll<HTMLElement>('[data-layer-id]')).map(
          (layer) => layer.dataset.layerId ?? '',
        ),
      );
      return 'data:image/png;base64,AA==';
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      await act(async () => exportPagePng('page', 2, doc, 0));
    } finally {
      clickSpy.mockRestore();
    }

    expect(layerIds).toEqual(['left', 'center', 'right', 'composed']);
  });
});
