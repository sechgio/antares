import { describe, expect, it } from 'vitest';
import { createLayer } from '../../constants';
import { mm } from '../../types';
import { composeBoolean } from '../booleanOps';
import { clipPathForLayer, clipPathForLayerType } from '../shapePaths';

describe('clipPathForLayerType', () => {
  it('keeps existing shape clips', () => {
    expect(clipPathForLayerType('polygon')).toContain('polygon(');
    expect(clipPathForLayerType('rect')).toBeUndefined();
  });
});

describe('clipPathForLayer', () => {
  it('resolves predefined shape types', () => {
    const star = createLayer('star');
    expect(clipPathForLayer(star)).toBe(clipPathForLayerType('star'));
  });

  it('resolves meta.path to a polygon clip', () => {
    const layer = createLayer('line', {
      cssVars: {
        ...createLayer('line').cssVars,
        '--width': mm(100),
        '--height': mm(50),
      },
      meta: {
        path: {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 50, y: 50 },
          ],
          closed: true,
        },
      },
    });
    const clip = clipPathForLayer(layer);
    expect(clip).toMatch(/^polygon\(/);
    expect(clip).toContain('0% 0%');
    expect(clip).toContain('100% 0%');
    expect(clip).toContain('50% 100%');
  });

  it('resolves boolean outline from operands', () => {
    const a = createLayer('pentagon', { id: 'a' });
    const b = createLayer('diamond', { id: 'b' });
    const booleanLayer = composeBoolean(a, [b]);
    const clip = clipPathForLayer(booleanLayer, [a, b, booleanLayer]);
    expect(clip).toBe(clipPathForLayerType('diamond'));
  });
});
