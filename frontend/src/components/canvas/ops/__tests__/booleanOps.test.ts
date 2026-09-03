import { describe, expect, it } from 'vitest';
import { createLayer } from '../../constants';
import { mm, parseMm } from '../../types';
import {
  applyBooleanCompose,
  composeBoolean,
  compositionHiddenLayerIds,
  resolveBooleanRender,
} from '../booleanOps';

describe('composeBoolean', () => {
  it('unifies bbox of base + operands', () => {
    const base = createLayer('rect', {
      id: 'base',
      cssVars: {
        ...createLayer('rect').cssVars,
        '--translate-x': mm(10),
        '--translate-y': mm(20),
        '--width': mm(30),
        '--height': mm(20),
      },
    });
    const other = createLayer('ellipse', {
      id: 'other',
      cssVars: {
        ...createLayer('ellipse').cssVars,
        '--translate-x': mm(25),
        '--translate-y': mm(15),
        '--width': mm(40),
        '--height': mm(40),
      },
    });
    const result = composeBoolean(base, [other]);
    expect(result.type).toBe('boolean');
    expect(parseMm(result.cssVars['--translate-x'])).toBe(10);
    expect(parseMm(result.cssVars['--translate-y'])).toBe(15);
    expect(parseMm(result.cssVars['--width'])).toBe(55);
    expect(parseMm(result.cssVars['--height'])).toBe(40);
    expect(result.meta?.ops).toEqual([
      { op: 'union', layerId: 'other' },
    ]);
  });

  it('returns base unchanged when operands are empty (legacy safe)', () => {
    const base = createLayer('rect', { id: 'solo' });
    const result = composeBoolean(base, []);
    expect(result).toBe(base);
    expect(result.type).toBe('rect');
    expect(result.meta?.ops).toBeUndefined();
  });
});

describe('applyBooleanCompose', () => {
  it('hides operand layers so they are not painted twice', () => {
    const base = createLayer('rect', { id: 'base' });
    const other = createLayer('ellipse', { id: 'other' });
    const next = applyBooleanCompose([base, other], base, [{ layer: other, op: 'union' }]);
    const composed = next.find((l) => l.id === 'base');
    const operand = next.find((l) => l.id === 'other');
    expect(composed?.type).toBe('boolean');
    expect(operand?.visible).toBe(false);
    expect(compositionHiddenLayerIds(next).has('other')).toBe(true);
  });
});

describe('compositionHiddenLayerIds', () => {
  it('includes mask silhouettes', () => {
    const target = createLayer('rect', {
      id: 'target',
      meta: { maskLayerId: 'mask' },
    });
    const mask = createLayer('ellipse', { id: 'mask' });
    expect(compositionHiddenLayerIds([target, mask]).has('mask')).toBe(true);
  });
});

describe('resolveBooleanRender', () => {
  it('union → all sub-shapes in order', () => {
    const a = createLayer('polygon', { id: 'a' });
    const b = createLayer('star', { id: 'b' });
    const booleanLayer = composeBoolean(a, [{ layer: b, op: 'union' }]);
    const result = resolveBooleanRender(booleanLayer, [a, b, booleanLayer]);
    expect(result.order.map((item) => item.layerId)).toEqual(['a', 'b']);
    expect(result.order.every((item) => !item.inverted)).toBe(true);
    expect(result.clipPath).toBeTruthy();
  });

  it('subtract → mask/clip applied (clipPath present, inverted flag)', () => {
    const a = createLayer('diamond', { id: 'a' });
    const b = createLayer('hexagon', { id: 'b' });
    const booleanLayer = composeBoolean(a, [{ layer: b, op: 'subtract' }]);
    const result = resolveBooleanRender(booleanLayer, [a, b, booleanLayer]);
    expect(result.order.length).toBeGreaterThanOrEqual(2);
    const hole = result.order.find((item) => item.layerId === 'b');
    expect(hole?.inverted).toBe(true);
    expect(hole?.clipPath).toBeTruthy();
    expect(hole?.blendMode).toBe('difference');
  });
});
