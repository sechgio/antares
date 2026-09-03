import { describe, expect, it } from 'vitest';
import { createLayer } from '../constants';
import { parseMm } from '../types';
import {
  bendSegment,
  closestSegmentIndex,
  ensureLinePath,
  linePathFromLegacy,
  pathBounds,
  pathFromDrag,
  pathToSvgD,
  pointInPolygon,
  scalePathPoints,
  splitPathAt,
  movePathPoint,
  movePathHandle,
  togglePathClosed,
  lineIntersectsPolygon,
} from '../ops/pathGeometry';

describe('pathGeometry', () => {
  it('builds a horizontal legacy path from width', () => {
    const layer = createLayer('line', {
      cssVars: {
        ...createLayer('line').cssVars,
        '--width': '80mm',
        '--height': '0.3mm',
      },
    });
    const path = linePathFromLegacy(layer);
    expect(path.points).toHaveLength(2);
    expect(path.points[0].x).toBe(0);
    expect(path.points[1].x).toBe(80);
    expect(path.points[0].y).toBeCloseTo(path.points[1].y, 5);
  });

  it('pathFromDrag stores diagonal endpoints in local coords', () => {
    const { path, originX, originY, width, height } = pathFromDrag(10, 20, 40, 50);
    expect(originX).toBe(10);
    expect(originY).toBe(20);
    expect(width).toBe(30);
    expect(height).toBe(30);
    expect(path.points[0]).toEqual({ x: 0, y: 0 });
    expect(path.points[1]).toEqual({ x: 30, y: 30 });
  });

  it('pathToSvgD emits L for sharp segments and C when handles exist', () => {
    expect(pathToSvgD([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe('M 0 0 L 10 0');
    const curved = pathToSvgD([
      { x: 0, y: 0, hout: { x: 5, y: -5 } },
      { x: 10, y: 0, hin: { x: 5, y: 5 } },
    ]);
    expect(curved).toContain('C ');
    expect(curved.startsWith('M 0 0')).toBe(true);
  });

  it('pathBounds includes handles', () => {
    const b = pathBounds([
      { x: 0, y: 0, hout: { x: 0, y: -10 } },
      { x: 20, y: 0 },
    ]);
    expect(b.minY).toBe(-10);
    expect(b.width).toBe(20);
  });

  it('ensureLinePath migrates legacy lines without mutating already-pathed lines', () => {
    const legacy = createLayer('line', {
      cssVars: {
        '--width': '50mm',
        '--height': '1mm',
        '--translate-x': '5mm',
        '--translate-y': '5mm',
        '--background-color': '#000000',
      },
      meta: {},
    });
    delete legacy.meta!.path;
    const migrated = ensureLinePath(legacy);
    expect(migrated.meta?.path?.points.length).toBe(2);
    expect(parseMm(migrated.cssVars['--width'])).toBeGreaterThan(0);

    const again = ensureLinePath(migrated);
    expect(again.meta?.path?.points).toEqual(migrated.meta?.path?.points);
  });

  it('ensureLinePath keeps stroke-height box and centers path (no MIN_BBOX inflation)', () => {
    const legacy = createLayer('line', {
      cssVars: {
        '--width': '198.75mm',
        '--height': '0.26mm',
        '--translate-x': '6.03mm',
        '--translate-y': '78.83mm',
        '--border-width': '1px',
        '--border-color': '#0D43FB',
        '--stroke-visible': '1',
        '--background-color': 'transparent',
        '--fill-visible': '0',
      },
      meta: {},
    });
    delete legacy.meta!.path;

    const migrated = ensureLinePath(legacy);
    const h = parseMm(migrated.cssVars['--height']);
    const y0 = migrated.meta!.path!.points[0].y;
    const y1 = migrated.meta!.path!.points[1].y;

    expect(h).toBeLessThan(0.35);
    expect(h).toBeGreaterThan(0.2);
    expect(y0).toBeCloseTo(h / 2, 5);
    expect(y1).toBeCloseTo(h / 2, 5);
    expect(migrated.cssVars['--translate-y']).toBe('78.83mm');
  });

  it('bendSegment adds symmetric handles on a segment', () => {
    const path = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false };
    const bent = bendSegment(path, 0, 50, -20);
    expect(bent.points[0].hout).toBeTruthy();
    expect(bent.points[1].hin).toBeTruthy();
    expect(bent.points[0].hout!.y).toBeLessThan(0);
  });

  it('movePathPoint moves handles with the anchor', () => {
    const path = {
      points: [
        { x: 0, y: 0, hout: { x: 10, y: 0 } },
        { x: 40, y: 0 },
      ],
      closed: false,
    };
    const next = movePathPoint(path, 0, 5, 5);
    expect(next.points[0].x).toBe(5);
    expect(next.points[0].y).toBe(5);
    expect(next.points[0].hout).toEqual({ x: 15, y: 5 });
  });

  it('movePathHandle mirrors the opposite handle by default', () => {
    const path = {
      points: [
        { x: 20, y: 20, hin: { x: 10, y: 20 }, hout: { x: 30, y: 20 } },
        { x: 60, y: 20 },
      ],
      closed: false,
    };
    const next = movePathHandle(path, 0, 'hout', 40, 10);
    expect(next.points[0].hout).toEqual({ x: 40, y: 10 });
    expect(next.points[0].hin).toEqual({ x: 0, y: 30 });
  });

  it('splitPathAt returns two open paths', () => {
    const path = { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false };
    const split = splitPathAt(path, 0, 0.5);
    expect(split).not.toBeNull();
    expect(split![0].points.length).toBeGreaterThanOrEqual(2);
    expect(split![1].points.length).toBeGreaterThanOrEqual(2);
    expect(split![0].closed).toBe(false);
    expect(split![1].closed).toBe(false);
  });

  it('scalePathPoints scales anchors and handles', () => {
    const path = {
      points: [
        { x: 0, y: 0, hout: { x: 10, y: 0 } },
        { x: 20, y: 10 },
      ],
      closed: false,
    };
    const scaled = scalePathPoints(path, 2, 0.5);
    expect(scaled.points[1]).toMatchObject({ x: 40, y: 5 });
    expect(scaled.points[0].hout).toEqual({ x: 20, y: 0 });
  });

  it('closestSegmentIndex finds nearest segment', () => {
    const path = {
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
      ],
      closed: false,
    };
    expect(closestSegmentIndex(path, 25, 2).index).toBe(0);
    expect(closestSegmentIndex(path, 52, 25).index).toBe(1);
  });

  it('togglePathClosed requires at least 3 points', () => {
    expect(togglePathClosed({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], closed: false }).closed).toBeFalsy();
    expect(togglePathClosed({ points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], closed: false }).closed).toBe(
      true,
    );
  });

  it('pointInPolygon detects containment', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon(5, 5, poly)).toBe(true);
    expect(pointInPolygon(15, 5, poly)).toBe(false);
  });

  it('lineIntersectsPolygon uses path points, not just bbox', () => {
    const line = createLayer('line', {
      cssVars: {
        ...createLayer('line').cssVars,
        '--translate-x': '0mm',
        '--translate-y': '0mm',
        '--width': '100mm',
        '--height': '2mm',
      },
      meta: {
        path: {
          points: [
            { x: 0, y: 1 },
            { x: 100, y: 1 },
          ],
          closed: false,
        },
      },
    });
    const aroundMid = [
      { x: 40, y: -5 },
      { x: 60, y: -5 },
      { x: 60, y: 5 },
      { x: 40, y: 5 },
    ];
    expect(lineIntersectsPolygon(line, aroundMid)).toBe(true);
    const farAway = [
      { x: 200, y: 200 },
      { x: 210, y: 200 },
      { x: 210, y: 210 },
      { x: 200, y: 210 },
    ];
    expect(lineIntersectsPolygon(line, farAway)).toBe(false);
  });
});
