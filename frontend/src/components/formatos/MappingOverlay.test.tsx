import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MappingOverlay from './MappingOverlay';
import type { VisualMapping } from '../../types';

const BASE_MAPPING: VisualMapping = {
  page: 0,
  x: 500,
  y: 30,
  width: 140,
  height: 20,
  font_size: 12,
  font_name: 'Helvetica-Bold',
  color_r: 0,
  color_g: 0,
  color_b: 0,
  padding: 7,
  blank_x: null,
  blank_y: null,
  blank_width: null,
  blank_height: null,
  redraw_top_border: false,
  redraw_ot_badge: false,
  blank_mcids: null,
};

describe('MappingOverlay', () => {
  it('positions overlay from mapping coordinates', () => {
    const imageRef = createRef<HTMLImageElement>();
    render(
      <>
        <img ref={imageRef} data-mapping-page-image alt="page" />
        <MappingOverlay
          mapping={{ ...BASE_MAPPING, x: 297.5, y: 42 }}
          pageSize={{ width: 595, height: 842 }}
          imageRef={imageRef}
          onChange={() => {}}
        />
      </>,
    );

    const overlay = screen.getByTestId('mapping-overlay');
    expect(overlay.style.left).toBe('50%');
    expect(overlay.style.top).toBe(`${(42 / 842) * 100}%`);
    expect(overlay.style.width).toBe(`${(140 / 595) * 100}%`);
    expect(overlay.style.height).toBe(`${(20 / 842) * 100}%`);
  });

  it('resizes without moving when arrows are pressed on the resize handle', () => {
    const imageRef = createRef<HTMLImageElement>();
    const onChange = vi.fn();
    render(
      <>
        <img ref={imageRef} data-mapping-page-image alt="page" />
        <MappingOverlay
          mapping={{ ...BASE_MAPPING, x: 100 }}
          pageSize={{ width: 595, height: 842 }}
          imageRef={imageRef}
          onChange={onChange}
        />
      </>,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: /Redimensionar mapping/ }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ x: 100, width: 141 }));

    onChange.mockClear();
    fireEvent.keyDown(screen.getByTestId('mapping-overlay'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ x: 101, width: 141 }));
  });

  it('renders preview text with PDF font metrics', () => {
    const imageRef = createRef<HTMLImageElement>();
    render(
      <>
        <img ref={imageRef} data-mapping-page-image alt="page" />
        <MappingOverlay
          mapping={{ ...BASE_MAPPING, padding: 5, font_name: 'Helvetica-Bold', font_size: 13 }}
          pageSize={{ width: 595, height: 842 }}
          imageRef={imageRef}
          sampleNumber={3051}
          onChange={() => {}}
        />
      </>,
    );

    const text = screen.getByTestId('mapping-preview-text');
    expect(text).toHaveTextContent('03051');
    expect(text.style.fontFamily).toContain('Helvetica');
    expect(text.style.fontWeight).toBe('700');
    expect(text.style.left).toBe(`${(500 / 595) * 100}%`);
  });

  it('shows drag hint text', () => {
    const imageRef = createRef<HTMLImageElement>();
    render(
      <>
        <img ref={imageRef} data-mapping-page-image alt="page" />
        <MappingOverlay
          mapping={BASE_MAPPING}
          pageSize={{ width: 595, height: 842 }}
          imageRef={imageRef}
          onChange={() => {}}
        />
      </>,
    );

    expect(screen.getByText(/Haz clic en la página, arrastra el recuadro/i)).toBeInTheDocument();
  });
});
