import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { mmToScreenPx } from '../ops/drawHelpers';
import { layerGeometry } from '../ops/layerGeometry';
import { buildLayerTransform } from '../ops/layerStyle';
import {
  applyLayerDomGeometry,
  applyLayerDomTransforms,
} from '../ops/imperativeLayerDom';
import { ensureLinePath } from '../ops/pathGeometry';
import { mm, parseMm } from '../types';

// Geometry contract: drag (imperativeLayerDom), rest (LayerNode) and export
// (renderHtml) must all compose the layer transform from the SAME source, so
// mid-drag preview === committed frame === exported frame.

describe('layerGeometry contract', () => {
  it('returns translate-only transform and no origin for plain rects', () => {
    const layer = createLayer('rect', {
      id: 'geo1',
      cssVars: {
        '--translate-x': mm(10),
        '--translate-y': mm(20),
        '--width': mm(8),
        '--height': mm(4),
      },
    });
    const g = layerGeometry(layer);
    expect(g.transform).toBe('translate(38px, 76px)');
    expect(g.transformOrigin).toBeUndefined();
    expect(g.widthPx).toBe(30); // Math.round(8 * 96 / 25.4)
    expect(g.heightPx).toBe(15); // Math.round(4 * 96 / 25.4)
  });

  it('composes rotate/scale in buildLayerTransform order and pins origin center center', () => {
    const layer = createLayer('rect', {
      id: 'geo2',
      cssVars: {
        '--translate-x': mm(5),
        '--translate-y': mm(5),
        '--width': mm(8),
        '--height': mm(8),
        '--rotate': '15deg',
        '--scale-x': '-1',
      },
    });
    const g = layerGeometry(layer);
    expect(buildLayerTransform(layer.cssVars)).toBe('rotate(15deg) scaleX(-1)');
    expect(g.transform).toBe('translate(19px, 19px) rotate(15deg) scaleX(-1)');
    expect(g.transformOrigin).toBe('center center');
  });

  it('uses the ensured line height for legacy lines (parity with LayerNode), not the 10mm drag default', () => {
    // Legacy line: no --height, no --border-width, no path (meta.path is
    // stripped so ensureLinePath must synthesize the bar geometry).
    const line = createLayer('line', {
      id: 'geo3',
      meta: {},
      cssVars: {
        '--translate-x': mm(0),
        '--translate-y': mm(0),
        '--width': mm(40),
      },
    });
    const ensured = ensureLinePath(line);
    const g = layerGeometry(line);
    // The contract must agree with what LayerNode renders (ensured height),
    // not the old imperative default of 10mm.
    expect(g.heightPx).toBe(mmToScreenPx(parseMm(ensured.cssVars['--height']), 1));
    expect(g.heightPx).not.toBe(mmToScreenPx(10, 1));
    // Width reads the layer's own --width (151px = 40mm), like LayerNode.
    expect(g.widthPx).toBe(mmToScreenPx(40, 1));
  });
});

describe('drag/rest parity (imperativeLayerDom)', () => {
  it('writes the exact contract transform during drag', () => {
    const layer = createLayer('rect', {
      id: 'geo4',
      cssVars: {
        '--translate-x': mm(5),
        '--translate-y': mm(6),
        '--width': mm(8),
        '--height': mm(8),
        '--rotate': '30deg',
      },
    });
    const root = document.createElement('div');
    const node = document.createElement('div');
    node.dataset.layerId = 'geo4';
    root.appendChild(node);
    applyLayerDomTransforms(root, [layer], ['geo4']);
    expect(node.style.transform).toBe(layerGeometry(layer).transform);
  });

  it('pins transform-origin center center when the layer has a paint transform', () => {
    const layer = createLayer('rect', {
      id: 'geo5',
      cssVars: {
        '--translate-x': mm(0),
        '--translate-y': mm(0),
        '--width': mm(8),
        '--height': mm(8),
        '--rotate': '30deg',
      },
    });
    const root = document.createElement('div');
    const node = document.createElement('div');
    node.dataset.layerId = 'geo5';
    root.appendChild(node);
    applyLayerDomTransforms(root, [layer], ['geo5']);
    expect(node.style.transformOrigin).toBe('center center');
  });

  it('writes the ensured line height during geometry drags (parity with rest)', () => {
    const line = createLayer('line', {
      id: 'geo6',
      meta: {},
      cssVars: {
        '--translate-x': mm(0),
        '--translate-y': mm(0),
        '--width': mm(40),
      },
    });
    const ensured = ensureLinePath(line);
    const expectedHeight = `${mmToScreenPx(parseMm(ensured.cssVars['--height']), 1)}px`;
    const root = document.createElement('div');
    const node = document.createElement('div');
    node.dataset.layerId = 'geo6';
    root.appendChild(node);
    applyLayerDomGeometry(root, [line], ['geo6']);
    expect(node.style.height).toBe(expectedHeight);
  });
});
