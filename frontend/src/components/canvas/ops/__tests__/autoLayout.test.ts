import { describe, expect, it } from 'vitest';
import { createLayer } from '../../constants';
import { childBox, relayoutAutoFrame } from '../autoLayout';
import type { CanvasLayer, LayerAutoLayout } from '../../types';
import { mm, parseMm } from '../../types';

function frameWith(
  layout: LayerAutoLayout | undefined,
  geo: { x?: number; y?: number; w?: number; h?: number } = {},
): CanvasLayer {
  return {
    id: 'frame-1',
    type: 'group',
    name: 'Grupo',
    value: '',
    cssVars: {
      '--width': mm(geo.w ?? 100),
      '--height': mm(geo.h ?? 80),
      '--translate-x': mm(geo.x ?? 10),
      '--translate-y': mm(geo.y ?? 20),
    },
    meta: layout ? { autoLayout: layout } : undefined,
  };
}

function childAt(id: string, x: number, y: number, w: number, h: number): CanvasLayer {
  return createLayer('rect', {
    id,
    parentId: 'frame-1',
    cssVars: {
      '--width': mm(w),
      '--height': mm(h),
      '--translate-x': mm(x),
      '--translate-y': mm(y),
    },
  });
}

describe('relayoutAutoFrame', () => {
  it('row with 2 identical children places second after first + gap', () => {
    const layout: LayerAutoLayout = {
      direction: 'row',
      gapMm: 5,
      padMm: 2,
      alignMain: 'start',
      alignCross: 'start',
      sizing: 'fixed',
    };
    const frame = frameWith(layout, { w: 100, h: 40, x: 10, y: 20 });
    const a = childAt('a', 0, 0, 20, 10);
    const b = childAt('b', 0, 0, 20, 10);
    const { children } = relayoutAutoFrame(frame, [a, b]);
    const boxA = childBox(children[0]!);
    const boxB = childBox(children[1]!);
    expect(boxA.x).toBe(10 + 2);
    expect(boxA.y).toBe(20 + 2);
    expect(boxB.x).toBe(boxA.x + boxA.w + 5);
    expect(boxB.y).toBe(boxA.y);
  });

  it("sizing 'hug' sets frame width to content + 2*pad", () => {
    const layout: LayerAutoLayout = {
      direction: 'row',
      gapMm: 4,
      padMm: 3,
      alignMain: 'start',
      alignCross: 'start',
      sizing: 'hug',
    };
    const frame = frameWith(layout, { w: 200, h: 200 });
    const a = childAt('a', 0, 0, 20, 10);
    const b = childAt('b', 0, 0, 30, 10);
    const { frame: next } = relayoutAutoFrame(frame, [a, b]);
    // content = 20+30+4 = 54; + 2*3 = 60
    expect(parseMm(next.cssVars['--width'])).toBe(60);
    expect(parseMm(next.cssVars['--height'])).toBe(10 + 2 * 3);
  });

  it("sizing 'fixed' + alignMain center centers children in leftover space", () => {
    const layout: LayerAutoLayout = {
      direction: 'row',
      gapMm: 0,
      padMm: 0,
      alignMain: 'center',
      alignCross: 'start',
      sizing: 'fixed',
    };
    const frame = frameWith(layout, { w: 100, h: 40, x: 0, y: 0 });
    const a = childAt('a', 0, 0, 20, 10);
    const b = childAt('b', 0, 0, 20, 10);
    const { children } = relayoutAutoFrame(frame, [a, b]);
    // content = 40, free = 60, start = 30
    expect(parseMm(children[0]!.cssVars['--translate-x'])).toBe(30);
    expect(parseMm(children[1]!.cssVars['--translate-x'])).toBe(50);
  });

  it("alignCross 'stretch' sets child height to frame height - 2*pad", () => {
    const layout: LayerAutoLayout = {
      direction: 'row',
      gapMm: 0,
      padMm: 5,
      alignMain: 'start',
      alignCross: 'stretch',
      sizing: 'fixed',
    };
    const frame = frameWith(layout, { w: 100, h: 50, x: 0, y: 0 });
    const a = childAt('a', 0, 0, 20, 8);
    const { children } = relayoutAutoFrame(frame, [a]);
    expect(parseMm(children[0]!.cssVars['--height'])).toBe(40);
    expect(parseMm(children[0]!.cssVars['--translate-y'])).toBe(5);
  });

  it('col stacks on Y with gap', () => {
    const layout: LayerAutoLayout = {
      direction: 'col',
      gapMm: 3,
      padMm: 1,
      alignMain: 'start',
      alignCross: 'start',
      sizing: 'fixed',
    };
    const frame = frameWith(layout, { w: 80, h: 100, x: 0, y: 0 });
    const a = childAt('a', 0, 0, 10, 20);
    const b = childAt('b', 0, 0, 10, 20);
    const { children } = relayoutAutoFrame(frame, [a, b]);
    expect(parseMm(children[0]!.cssVars['--translate-y'])).toBe(1);
    expect(parseMm(children[1]!.cssVars['--translate-y'])).toBe(1 + 20 + 3);
  });

  it('skips children with visible===false', () => {
    const layout: LayerAutoLayout = {
      direction: 'row',
      gapMm: 5,
      padMm: 0,
      alignMain: 'start',
      alignCross: 'start',
      sizing: 'fixed',
    };
    const frame = frameWith(layout, { w: 100, h: 40, x: 0, y: 0 });
    const a = childAt('a', 0, 0, 20, 10);
    const hidden = { ...childAt('h', 99, 99, 20, 10), visible: false };
    const b = childAt('b', 0, 0, 20, 10);
    const { children } = relayoutAutoFrame(frame, [a, hidden, b]);
    expect(parseMm(children[0]!.cssVars['--translate-x'])).toBe(0);
    expect(children[1]).toBe(hidden);
    expect(parseMm(children[2]!.cssVars['--translate-x'])).toBe(25);
  });

  it('legacy: frame without meta.autoLayout returns layers unchanged', () => {
    const frame = frameWith(undefined, { w: 100, h: 80, x: 10, y: 20 });
    const a = childAt('a', 15, 25, 20, 10);
    const kids = [a];
    const result = relayoutAutoFrame(frame, kids);
    expect(result.frame).toBe(frame);
    expect(result.children).toBe(kids);
    expect(result.children[0]).toBe(a);
  });
});
