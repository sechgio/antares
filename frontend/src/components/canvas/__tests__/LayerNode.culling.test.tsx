import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createLayer } from '../constants';
import LayerNode from '../editor/LayerNode';

const baseHandlers = {
  onSelect: vi.fn(),
  onLayerPointerDown: vi.fn(),
};

describe('LayerNode viewport culling and performance', () => {
  it('renders a hidden culled container when offscreen is true', () => {
    const layer = createLayer('text', { value: 'Texto Fuera' });
    const { container } = render(
      <LayerNode
        layer={layer}
        selected={false}
        interactive
        scale={1}
        editing={false}
        offscreen={true}
        {...baseHandlers}
      />,
    );

    const node = container.querySelector('[data-layer-id]');
    expect(node).not.toBeNull();
    expect(node?.getAttribute('data-culled')).toBe('true');
    expect((node as HTMLElement).style.display).toBe('none');
    expect(screen.queryByText('Texto Fuera')).toBeNull();
  });

  it('ignores offscreen culling if layer is selected or editing', () => {
    const layer = createLayer('text', { value: 'Texto Seleccionado' });
    render(
      <LayerNode
        layer={layer}
        selected={true}
        interactive
        scale={1}
        editing={false}
        offscreen={true}
        {...baseHandlers}
      />,
    );

    expect(screen.getByText('Texto Seleccionado')).toBeTruthy();
  });

  it('simplifies paint styles (strips filter/boxShadow) when panning is true', () => {
    const layer = createLayer('rect', {
      cssVars: {
        '--width': '40mm',
        '--height': '40mm',
        '--translate-x': '10mm',
        '--translate-y': '10mm',
        '--box-shadow': '0 10px 20px rgba(0,0,0,0.5)',
        '--filter': 'blur(4px)',
      },
    });

    const { container, rerender } = render(
      <LayerNode
        layer={layer}
        selected={false}
        interactive
        scale={1}
        panning={false}
        {...baseHandlers}
      />,
    );

    const elNormal = container.querySelector('[data-layer-id]') as HTMLElement;
    expect(elNormal.style.boxShadow).toContain('rgba');
    expect(elNormal.style.contain).toBe('layout paint');

    rerender(
      <LayerNode
        layer={layer}
        selected={false}
        interactive
        scale={1}
        panning={true}
        {...baseHandlers}
      />,
    );

    const elPanning = container.querySelector('[data-layer-id]') as HTMLElement;
    expect(elPanning.style.boxShadow).toBe('');
    expect(elPanning.style.filter).toBe('');
  });

  it('adds loading="lazy" attribute to image layers', () => {
    const layer = createLayer('image', { value: 'data:image/png;base64,fake' });
    render(
      <LayerNode
        layer={layer}
        selected={false}
        interactive
        scale={1}
        {...baseHandlers}
      />,
    );

    const img = screen.getByRole('img', { hidden: true });
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
  });
});
