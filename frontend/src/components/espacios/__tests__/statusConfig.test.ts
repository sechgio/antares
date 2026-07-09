import { describe, expect, it } from 'vitest';
import {
  fallbackBoardColumns,
  nextColumnSortOrder,
  slugifyColumnKey,
  uniqueColumnKey,
  visibleBoardColumns,
} from '../utils/statusConfig';

describe('statusConfig board columns', () => {
  it('fallback includes default board columns', () => {
    const cols = fallbackBoardColumns('p1');
    expect(cols.map((c) => c.key)).toEqual(['todo', 'in_progress', 'done', 'urgent', 'closed']);
    expect(cols.every((c) => c.is_system)).toBe(true);
  });

  it('hides closed unless showClosed', () => {
    const cols = fallbackBoardColumns('p1');
    expect(visibleBoardColumns(cols, false).map((c) => c.key)).toEqual([
      'todo',
      'in_progress',
      'done',
      'urgent',
    ]);
    expect(visibleBoardColumns(cols, true).some((c) => c.key === 'closed')).toBe(true);
  });

  it('slugifies and uniquifies column keys', () => {
    expect(slugifyColumnKey('En revisión')).toBe('en_revision');
    const existing = new Set(['en_revision']);
    expect(uniqueColumnKey('En revisión', existing)).toBe('en_revision_2');
  });

  it('computes next sort order after max', () => {
    const cols = fallbackBoardColumns('p1');
    expect(nextColumnSortOrder(cols)).toBe(5);
  });
});
