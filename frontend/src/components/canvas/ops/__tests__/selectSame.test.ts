import { describe, expect, it } from 'vitest';
import { createLayer } from '../../constants';
import { sameLayerIds, selectSameApplicable } from '../selectSame';

describe('selectSame', () => {
  it('fill matches layers with the same background color', () => {
    const a = createLayer('rect', {
      id: 'a',
      cssVars: { ...createLayer('rect').cssVars, '--background-color': '#FF0000' },
    });
    const b = createLayer('rect', {
      id: 'b',
      cssVars: { ...createLayer('rect').cssVars, '--background-color': '#FF0000' },
    });
    const c = createLayer('rect', {
      id: 'c',
      cssVars: { ...createLayer('rect').cssVars, '--background-color': '#00FF00' },
    });
    const ids = sameLayerIds([a, b, c], a, 'fill');
    expect(ids).toEqual(['a', 'b']);
  });

  it('stroke matches on border color and font only applies to text/field', () => {
    const text = createLayer('text', {
      id: 't1',
      cssVars: { ...createLayer('text').cssVars, '--font-family': 'Inter' },
    });
    const field = createLayer('field', {
      id: 'f1',
      cssVars: { ...createLayer('field').cssVars, '--font-family': 'Inter' },
    });
    const rect = createLayer('rect', { id: 'r1' });

    expect(sameLayerIds([text, field, rect], text, 'font')).toEqual(['t1', 'f1']);
    expect(selectSameApplicable(rect, 'font')).toBe(false);
  });

  it('returns empty when the reference lacks the value', () => {
    const a = createLayer('rect', { id: 'a' });
    delete (a.cssVars as Record<string, unknown>)['--background-color'];
    expect(sameLayerIds([a], a, 'fill')).toEqual([]);
  });

  it('selectSameApplicable excludes frames', () => {
    const frame = createLayer('frame', { id: 'fr' });
    expect(selectSameApplicable(frame, 'fill')).toBe(false);
  });
});
