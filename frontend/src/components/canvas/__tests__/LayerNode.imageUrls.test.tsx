import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import LayerNode from '../editor/LayerNode';
import { boxCss } from './fixtures';

const baseHandlers = {
  onSelect: vi.fn(),
  onLayerPointerDown: vi.fn(),
};

function renderImageLayer(value: string) {
  const layer = createLayer('image', {
    value,
    cssVars: boxCss('10mm', '10mm', '40mm', '30mm'),
  });
  const { container } = render(
    <LayerNode
      layer={layer}
      selected={false}
      interactive
      scale={1}
      editing={false}
      {...baseHandlers}
    />,
  );
  return container;
}

describe('LayerNode image url blocking', () => {
  it('no monta <img> para file:, javascript:, data: no raster ni http(s) remotos', () => {
    for (const evil of [
      'file:///C:/Users/x/secreto.png',
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'https://cdn.example.com/tracker.png',
      'http://example.com/x.png',
    ]) {
      const container = renderImageLayer(evil);
      expect(container.querySelector('img'), evil).toBeNull();
    }
  });

  it('monta <img> para data: raster y blob: preservando el src', () => {
    const raster = 'data:image/png;base64,AAAA';
    const container = renderImageLayer(raster);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe(raster);

    const blobContainer = renderImageLayer('blob:https://app/img-1');
    expect(blobContainer.querySelector('img')?.getAttribute('src')).toBe('blob:https://app/img-1');
  });
});
