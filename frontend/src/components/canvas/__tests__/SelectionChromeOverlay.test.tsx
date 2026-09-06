import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectionChromeOverlay } from '../editor/SelectionChromeOverlay';
import { MeasurementBadge } from '../editor/CanvasRulers';

describe('Canvas overlay legibility at camera zoom', () => {
  it.each([0.25, 0.5, 1, 2, 4])('keeps selection edges and measurements readable at %sx', (zoom) => {
    render(
      <SelectionChromeOverlay
        bbox={{ x: 10, y: 10, w: 50, h: 40 }}
        zoom={zoom}
        onResize={vi.fn()}
        onRotate={vi.fn()}
      />,
    );
    const badge = screen.getByTestId('canvas-size-badge');
    expect(parseFloat(badge.style.fontSize) * zoom).toBeCloseTo(11);
    expect(badge.style.background).toBe('var(--cv-accent)');
    const edge = screen.getByTestId('canvas-selection-chrome');
    expect(parseFloat(edge.style.outline) * zoom).toBeCloseTo(1);
    const handle = screen.getByTestId('canvas-resize-handle-nw');
    expect(parseFloat(handle.style.width) * zoom).toBeCloseTo(7);
  });

  it('distinguishes distance measurements from selection measurements', () => {
    render(<MeasurementBadge label="12 mm" zoom={0.5} />);
    const badge = screen.getByTestId('canvas-measurement-badge');
    expect(badge.style.background).toBe('var(--cv-accent-2)');
    expect(parseFloat(badge.style.fontSize) * 0.5).toBeCloseTo(11);
  });
});
