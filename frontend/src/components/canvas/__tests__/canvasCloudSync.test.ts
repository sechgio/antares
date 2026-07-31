import { describe, it, expect } from 'vitest';
import { isNewer, shouldPushCanvasRow } from '../sync/canvasCloudSync';
import type { SyncConflict } from '../sync/canvasCloudSync';

describe('isNewer', () => {
  it('returns true when a is later than b', () => {
    expect(isNewer('2026-07-30T20:00:00Z', '2026-07-30T19:00:00Z')).toBe(true);
  });

  it('returns false when a is earlier than b', () => {
    expect(isNewer('2026-07-30T19:00:00Z', '2026-07-30T20:00:00Z')).toBe(false);
  });

  it('returns false when a is undefined', () => {
    expect(isNewer(undefined, '2026-07-30T20:00:00Z')).toBe(false);
  });

  it('returns true when b is undefined', () => {
    expect(isNewer('2026-07-30T20:00:00Z', undefined)).toBe(true);
  });

  it('returns false when both are undefined', () => {
    expect(isNewer(undefined, undefined)).toBe(false);
  });

  it('returns false for equal timestamps', () => {
    expect(isNewer('2026-07-30T20:00:00Z', '2026-07-30T20:00:00Z')).toBe(false);
  });
});

describe('shouldPushCanvasRow', () => {
  it('allows push when remote does not exist', () => {
    expect(shouldPushCanvasRow('2026-07-30T20:00:00Z', undefined, undefined)).toBe(true);
  });

  it('blocks push when remote is deleted', () => {
    expect(shouldPushCanvasRow('2026-07-30T20:00:00Z', '2026-07-30T19:00:00Z', '2026-07-30T21:00:00Z')).toBe(false);
  });

  it('allows push when local is newer', () => {
    expect(shouldPushCanvasRow('2026-07-30T21:00:00Z', '2026-07-30T20:00:00Z', null)).toBe(true);
  });

  it('blocks push when remote is newer', () => {
    expect(shouldPushCanvasRow('2026-07-30T19:00:00Z', '2026-07-30T20:00:00Z', null)).toBe(false);
  });

  it('blocks push when local timestamp is undefined', () => {
    expect(shouldPushCanvasRow(undefined, '2026-07-30T20:00:00Z', null)).toBe(false);
  });
});

describe('SyncConflict type', () => {
  it('can be constructed with required fields', () => {
    const conflict: SyncConflict = {
      localDoc: {
        version: 2,
        id: 'doc-1',
        name: 'Test',
        updatedAt: '2026-07-30T19:00:00Z',
        page: { widthMm: 210, heightMm: 297 },
        layers: [],
        fields: [],
      },
      remoteDoc: {
        version: 2,
        id: 'doc-1',
        name: 'Test (remote)',
        updatedAt: '2026-07-30T20:00:00Z',
        page: { widthMm: 210, heightMm: 297 },
        layers: [],
        fields: [],
      },
      remoteUpdatedAt: '2026-07-30T20:00:00Z',
      localUpdatedAt: '2026-07-30T19:00:00Z',
    };

    expect(conflict.remoteDoc.name).toBe('Test (remote)');
    expect(conflict.localDoc.name).toBe('Test');
    expect(isNewer(conflict.remoteUpdatedAt, conflict.localUpdatedAt)).toBe(true);
  });
});
