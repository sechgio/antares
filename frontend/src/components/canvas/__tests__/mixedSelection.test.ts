import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { applyCssVarToLayerIds, mixedCssVar, mixedNumericMm } from '../ops/mixedSelection';
import { mm } from '../types';

describe('mixedSelection', () => {
  it('reports a shared css var and mixed when values differ', () => {
    const a = createLayer('rect', { id: 'a' });
    a.cssVars['--translate-x'] = '10mm';
    const b = createLayer('rect', { id: 'b' });
    b.cssVars['--translate-x'] = '10mm';
    expect(mixedCssVar([a, b], '--translate-x')).toEqual({ mixed: false, value: '10mm' });

    b.cssVars['--translate-x'] = '24mm';
    expect(mixedCssVar([a, b], '--translate-x')).toEqual({ mixed: true });
    expect(mixedNumericMm([a, b], '--translate-x')).toEqual({ mixed: true });
  });

  it('applyCssVarToLayerIds writes one value onto unlocked selected layers', () => {
    const a = createLayer('rect', { id: 'a' });
    const b = createLayer('rect', { id: 'b', locked: true });
    const c = createLayer('rect', { id: 'c' });
    const next = applyCssVarToLayerIds([a, b, c], ['a', 'b', 'c'], '--translate-x', mm(15));
    expect(next.find((l) => l.id === 'a')!.cssVars['--translate-x']).toBe('15mm');
    expect(next.find((l) => l.id === 'b')).toBe(b);
    expect(next.find((l) => l.id === 'c')!.cssVars['--translate-x']).toBe('15mm');
    expect(next.find((l) => l.id === 'c')).not.toBe(c);
  });
});
