import { describe, expect, it } from 'vitest';
import { createLayer } from '../../constants';
import {
  applyContainerLayoutPanelEffects,
  containerUsesLayoutConstraints,
  propagateContainerResize,
} from '../layerOps';
import { resizeSelection } from '../selectionTransform';
import { mm, parseMm, type CanvasLayer, type LayerAutoLayout } from '../../types';

function groupAt(
  id: string,
  geo: { x: number; y: number; w: number; h: number },
  meta?: CanvasLayer['meta'],
): CanvasLayer {
  return {
    id,
    type: 'group',
    name: 'Grupo',
    value: '',
    cssVars: {
      '--width': mm(geo.w),
      '--height': mm(geo.h),
      '--translate-x': mm(geo.x),
      '--translate-y': mm(geo.y),
    },
    meta,
  };
}

function child(
  id: string,
  parentId: string,
  geo: { x: number; y: number; w: number; h: number },
  meta?: CanvasLayer['meta'],
): CanvasLayer {
  return createLayer('rect', {
    id,
    parentId,
    meta,
    cssVars: {
      '--width': mm(geo.w),
      '--height': mm(geo.h),
      '--translate-x': mm(geo.x),
      '--translate-y': mm(geo.y),
    },
  });
}

describe('propagateContainerResize', () => {
  it('leaves children without constraints unchanged when moving the group', () => {
    const g = groupAt('g1', { x: 10, y: 10, w: 100, h: 50 });
    const a = child('a', 'g1', { x: 20, y: 20, w: 30, h: 20 });
    const moved = groupAt('g1', { x: 30, y: 20, w: 100, h: 50 });
    const next = propagateContainerResize([moved, a], 'g1', { dx: 20, dy: 10, dw: 0, dh: 0 });
    const childNext = next.find((l) => l.id === 'a')!;
    expect(parseMm(childNext.cssVars['--translate-x'])).toBe(20);
    expect(parseMm(childNext.cssVars['--translate-y'])).toBe(20);
  });

  it('applies end constraint: child grows with parent dw', () => {
    const g = groupAt('g1', { x: 0, y: 0, w: 120, h: 50 });
    const a = child('a', 'g1', { x: 10, y: 5, w: 40, h: 20 }, { constraintH: 'end', constraintV: 'start' });
    const next = propagateContainerResize([g, a], 'g1', { dx: 0, dy: 0, dw: 30, dh: 0 });
    const childNext = next.find((l) => l.id === 'a')!;
    expect(parseMm(childNext.cssVars['--translate-x'])).toBe(10);
    expect(parseMm(childNext.cssVars['--width'])).toBe(70);
  });

  it('relayouts when autoLayout is set after parent resize', () => {
    const layout: LayerAutoLayout = {
      direction: 'row',
      gapMm: 4,
      padMm: 2,
      alignMain: 'start',
      alignCross: 'start',
      sizing: 'fixed',
    };
    const g = groupAt('g1', { x: 0, y: 0, w: 100, h: 40 }, { autoLayout: layout });
    const a = child('a', 'g1', { x: 50, y: 50, w: 20, h: 10 });
    const b = child('b', 'g1', { x: 80, y: 50, w: 20, h: 10 });
    const next = propagateContainerResize([g, a, b], 'g1', { dx: 0, dy: 0, dw: 20, dh: 0 });
    const aNext = next.find((l) => l.id === 'a')!;
    const bNext = next.find((l) => l.id === 'b')!;
    expect(parseMm(aNext.cssVars['--translate-x'])).toBe(2);
    expect(parseMm(bNext.cssVars['--translate-x'])).toBe(2 + 20 + 4);
  });
});

describe('applyContainerLayoutPanelEffects', () => {
  it('propagates size change to constrained children', () => {
    const prev = groupAt('g1', { x: 0, y: 0, w: 100, h: 50 });
    const nextGroup = groupAt('g1', { x: 0, y: 0, w: 150, h: 50 });
    const a = child('a', 'g1', { x: 10, y: 5, w: 40, h: 20 }, { constraintH: 'end' });
    const layers = [nextGroup, a];
    const out = applyContainerLayoutPanelEffects(layers, prev, nextGroup);
    expect(parseMm(out.find((l) => l.id === 'a')!.cssVars['--width'])).toBe(90);
  });

  it('relayouts when autoLayout is enabled', () => {
    const layout: LayerAutoLayout = {
      direction: 'row',
      gapMm: 0,
      padMm: 0,
      alignMain: 'start',
      alignCross: 'start',
      sizing: 'fixed',
    };
    const prev = groupAt('g1', { x: 0, y: 0, w: 100, h: 40 });
    const nextGroup = groupAt('g1', { x: 0, y: 0, w: 100, h: 40 }, { autoLayout: layout });
    const a = child('a', 'g1', { x: 50, y: 50, w: 20, h: 10 });
    const out = applyContainerLayoutPanelEffects([nextGroup, a], prev, nextGroup);
    expect(parseMm(out.find((l) => l.id === 'a')!.cssVars['--translate-x'])).toBe(0);
    expect(parseMm(out.find((l) => l.id === 'a')!.cssVars['--translate-y'])).toBe(0);
  });
});

describe('resizeSelection + layout constraints', () => {
  it('uses constraint path instead of uniform scale when child has constraintH', () => {
    const g = groupAt('g1', { x: 0, y: 0, w: 100, h: 50 });
    const a = child('a', 'g1', { x: 10, y: 5, w: 40, h: 20 }, { constraintH: 'end', constraintV: 'start' });
    expect(containerUsesLayoutConstraints([g, a], 'g1')).toBe(true);
    const next = resizeSelection([g, a], ['g1'], 'e', 50, 0, { aspectLock: false });
    const gNext = next.find((l) => l.id === 'g1')!;
    const aNext = next.find((l) => l.id === 'a')!;
    expect(parseMm(gNext.cssVars['--width'])).toBe(150);
    expect(parseMm(aNext.cssVars['--translate-x'])).toBe(10);
    expect(parseMm(aNext.cssVars['--width'])).toBe(90);
  });

  it('keeps legacy uniform scale when no constraints/autoLayout', () => {
    const g = groupAt('g1', { x: 0, y: 0, w: 100, h: 50 });
    const a = child('a', 'g1', { x: 10, y: 5, w: 40, h: 20 });
    expect(containerUsesLayoutConstraints([g, a], 'g1')).toBe(false);
    const next = resizeSelection([g, a], ['g1'], 'e', 50, 0, { aspectLock: false });
    const aNext = next.find((l) => l.id === 'a')!;
    expect(parseMm(aNext.cssVars['--translate-x'])).toBe(15);
    expect(parseMm(aNext.cssVars['--width'])).toBe(60);
  });
});
