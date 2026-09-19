import { describe, expect, it } from 'vitest';
import {
  cloneArtboardForExport,
  needsImageCacheBust,
  stripSelectionChrome,
} from '../ops/exportPng';

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

function makeArtboard(): HTMLElement {
  const board = document.createElement('div');
  board.setAttribute('data-testid', 'canvas-artboard');
  board.style.transform = 'scale(1.5)';
  board.style.boxShadow = '0 12px 40px rgba(0,0,0,0.14)';
  board.style.setProperty('--cv-camera-zoom', '1.5');

  const margin = document.createElement('div');
  margin.setAttribute('data-testid', 'canvas-page-margin');
  board.appendChild(margin);

  const label = document.createElement('div');
  label.textContent = 'Página A4 — 210 × 297 mm · 150%';
  board.appendChild(label);

  const layer = document.createElement('div');
  layer.setAttribute('data-layer-id', 'l1');
  layer.style.transform = 'translate(100px, 50px) rotate(12deg)';
  layer.style.boxShadow = '0 2px 4px rgba(0,0,0,.3), 0 0 0 1px var(--cv-accent)';
  const inner = document.createElement('span');
  inner.textContent = 'hola';
  layer.appendChild(inner);
  board.appendChild(layer);

  const overlay = document.createElement('div');
  overlay.setAttribute('data-testid', 'canvas-selection-chrome');
  board.appendChild(overlay);
  return board;
}

describe('cloneArtboardForExport', () => {
  it('conserva solo las capas y deja la página a escala 1', () => {
    const clone = cloneArtboardForExport(makeArtboard());
    expect(clone.hasAttribute('data-testid')).toBe(false);
    expect(clone.style.transform).toBe('none');
    expect(clone.style.boxShadow).toBe('none');
    expect(clone.style.getPropertyValue('--cv-camera-zoom')).toBe('1');
    expect(clone.children).toHaveLength(1);
    expect(clone.firstElementChild?.getAttribute('data-layer-id')).toBe('l1');
    expect(clone.querySelector('span')?.textContent).toBe('hola');
  });

  it('mantiene la rotación de la capa y quita solo el anillo de selección', () => {
    const layer = cloneArtboardForExport(makeArtboard()).firstElementChild as HTMLElement;
    expect(layer.style.transform).toBe('translate(100px, 50px) rotate(12deg)');
    expect(layer.style.boxShadow).toBe('0 2px 4px rgba(0,0,0,.3)');
  });

  it('usa none cuando la capa solo tenía el anillo de selección', () => {
    const board = makeArtboard();
    board.querySelector<HTMLElement>('[data-layer-id]')!.style.boxShadow =
      '0 0 0 1px var(--cv-accent)';
    const layer = cloneArtboardForExport(board).firstElementChild as HTMLElement;
    expect(layer.style.boxShadow).toBe('none');
  });

  it('limpia el outline de acento y respeta un outline legítimo', () => {
    const board = makeArtboard();
    board.querySelector<HTMLElement>('[data-layer-id]')!.style.outline =
      '1px solid var(--cv-accent)';
    const accent = cloneArtboardForExport(board).firstElementChild as HTMLElement;
    expect(accent.style.outline).toBe('none');

    const plain = makeArtboard();
    plain.querySelector<HTMLElement>('[data-layer-id]')!.style.outline = '1px solid red';
    const kept = cloneArtboardForExport(plain).firstElementChild as HTMLElement;
    expect(kept.style.outline).toBe('1px solid red');
  });

  it('no altera el arteboard original', () => {
    const board = makeArtboard();
    cloneArtboardForExport(board);
    expect(board.children).toHaveLength(4);
    expect(board.style.transform).toBe('scale(1.5)');
  });
});
