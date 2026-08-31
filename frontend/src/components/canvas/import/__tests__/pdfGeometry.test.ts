import { describe, expect, it } from 'vitest';
import { pdfBoxToCanvasBox, pdfPointsToMm } from '../pdfGeometry';

describe('PDF geometry', () => {
  it('converts points to millimeters', () => {
    expect(pdfPointsToMm(72)).toBeCloseTo(25.4, 6);
  });

  it('flips the PDF Y axis into Canvas top-left coordinates', () => {
    const box = pdfBoxToCanvasBox(
      { x: 72, y: 72, width: 144, height: 72 },
      { widthPt: 612, heightPt: 792 },
    );
    expect(box.xMm).toBeCloseTo(25.4, 6);
    expect(box.yMm).toBeCloseTo(pdfPointsToMm(648), 6);
    expect(box.widthMm).toBeCloseTo(50.8, 6);
    expect(box.heightMm).toBeCloseTo(25.4, 6);
  });
});
