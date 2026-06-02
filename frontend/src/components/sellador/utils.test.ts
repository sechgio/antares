import { describe, expect, it } from 'vitest';
import {
  buildResolvedPlacements,
  buildStampPlacement,
  clampStampRect,
  createStampPosition,
  defaultStampRect,
  distributeStampPages,
  ensureSlotIndices,
  presetStampRect,
} from './utils';

describe('sellador utils', () => {
  it('distributes stamps deterministically with the same seed', () => {
    const first = distributeStampPages(12, 6, 12345);
    const second = distributeStampPages(12, 6, 12345);
    expect(first).toEqual(second);
    expect(first).toHaveLength(6);
    expect(new Set(first).size).toBe(6);
    first.forEach((page) => {
      expect(page).toBeGreaterThanOrEqual(0);
      expect(page).toBeLessThan(12);
    });
  });

  it('never assigns more than one stamp per page', () => {
    const pages = distributeStampPages(5, 20, 777);
    expect(pages).toHaveLength(5);
    expect(new Set(pages).size).toBe(5);
  });

  it('builds stamped page summary in 1-based page numbers', () => {
    const placement = buildStampPlacement(8, 4, 999);
    expect(placement.seed).toBe(999);
    expect(placement.pageAssignments).toHaveLength(4);
    placement.pageAssignments.forEach((page) => {
      expect(page).toBeGreaterThanOrEqual(1);
      expect(page).toBeLessThanOrEqual(8);
    });
    expect(placement.stampedPages.every((page) => placement.pageAssignments.includes(page))).toBe(true);
  });

  it('keeps stamp rect inside page bounds', () => {
    const page = { width: 612, height: 792 };
    const rect = clampStampRect({ x: 700, y: 900, width: 200, height: 200 }, page);
    expect(rect.x).toBeLessThanOrEqual(page.width - rect.width);
    expect(rect.y).toBeLessThanOrEqual(page.height - rect.height);
    expect(rect.width).toBeGreaterThanOrEqual(24);
  });

  it('creates a default stamp rect using page proportions', () => {
    const rect = defaultStampRect({ width: 600, height: 800 }, 1);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
  });

  it('maps each stamp to a chosen position slot', () => {
    const page = { width: 600, height: 800 };
    const positions = [
      createStampPosition(1, presetStampRect(page, 1, 'bottom-right')),
      createStampPosition(2, presetStampRect(page, 1, 'top-left')),
    ];
    const resolved = buildResolvedPlacements([2, 5, 8], positions, [0, 1, 1]);
    expect(resolved).toHaveLength(3);
    expect(resolved[0].positionIndex).toBe(0);
    expect(resolved[1].positionIndex).toBe(1);
  });

  it('keeps slot indices in range when stamp count changes', () => {
    const slots = ensureSlotIndices(5, [0, 1, 0], 2);
    expect(slots).toEqual([0, 1, 0, 1, 0]);
  });
});
