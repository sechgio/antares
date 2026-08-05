import { describe, expect, it } from 'vitest';
import { needsImageCacheBust, stripSelectionChrome } from '../ops/exportPng';

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
