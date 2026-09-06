import { describe, expect, it } from 'vitest';
import {
  LAYER_OVERSCAN,
  LAYER_ROW_H,
  LAYER_VIRTUALIZE_AT,
  clampLayerScrollTop,
  layerVirtualWindow,
  nextLayerRowIndex,
  scrollTopToRevealIndex,
} from '../ops/layerListWindow';

describe('layerVirtualWindow', () => {
  it('keeps a usable window when scroll sits past a shorter result list', () => {
    const window = layerVirtualWindow({
      rowCount: 5,
      scrollTop: 80 * LAYER_ROW_H,
      listHeight: 400,
    });
    expect(window.start).toBe(0);
    expect(window.end).toBe(5);
    expect(window.scrollTop).toBe(0);
    expect(window.end - window.start).toBeGreaterThan(0);
  });

  it('clamps the window to the current row count after collapsing or deleting', () => {
    const window = layerVirtualWindow({
      rowCount: 12,
      scrollTop: 900,
      listHeight: 200,
    });
    expect(window.start).toBeGreaterThanOrEqual(0);
    expect(window.end).toBeLessThanOrEqual(12);
    expect(window.start).toBeLessThan(window.end);
    expect(window.padTop).toBe(window.start * LAYER_ROW_H);
    expect(window.padBottom).toBe((12 - window.end) * LAYER_ROW_H);
  });

  it('returns an empty window only when there are no rows', () => {
    const empty = layerVirtualWindow({ rowCount: 0, scrollTop: 400, listHeight: 280 });
    expect(empty).toMatchObject({ start: 0, end: 0, padTop: 0, padBottom: 0, scrollTop: 0 });
  });

  it('uses the same row height as the layer list CSS', () => {
    expect(LAYER_ROW_H).toBe(28);
    expect(LAYER_OVERSCAN).toBe(8);
    expect(LAYER_VIRTUALIZE_AT).toBe(80);
  });
});

describe('clampLayerScrollTop / scrollTopToRevealIndex', () => {
  it('clampLayerScrollTop never exceeds the scrollable range', () => {
    expect(clampLayerScrollTop(9999, 3, 400)).toBe(0);
    expect(clampLayerScrollTop(-20, 40, 200)).toBe(0);
    expect(clampLayerScrollTop(80, 40, 200)).toBe(80);
  });

  it('nextLayerRowIndex walks the visible tree without wrapping', () => {
    expect(nextLayerRowIndex(-1, 10, 1)).toBe(0);
    expect(nextLayerRowIndex(0, 10, -1)).toBe(0);
    expect(nextLayerRowIndex(9, 10, 1)).toBe(9);
    expect(nextLayerRowIndex(4, 10, 1)).toBe(5);
  });

  it('scrollTopToRevealIndex only moves when the row is outside the viewport', () => {
    expect(scrollTopToRevealIndex(2, LAYER_ROW_H, 200, 0)).toBe(0);
    expect(scrollTopToRevealIndex(0, LAYER_ROW_H, 200, 80)).toBe(0);
    const below = scrollTopToRevealIndex(20, LAYER_ROW_H, 200, 0);
    expect(below).toBe(20 * LAYER_ROW_H + LAYER_ROW_H - 200);
  });
});
