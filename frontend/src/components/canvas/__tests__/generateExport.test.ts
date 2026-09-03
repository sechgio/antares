import { describe, expect, it } from 'vitest';
import { selectGenerateRowIndices } from '../ops/generateExport';

describe('selectGenerateRowIndices', () => {
  it('returns [] for empty rows', () => {
    expect(
      selectGenerateRowIndices({
        rows: [],
        rowIndex: 0,
        exportScope: 'all',
        idColumn: 'ID',
        requiresImages: false,
        images: [],
      }),
    ).toEqual([]);
  });

  it("includes the current row when exportScope is 'single' and images aren't required", () => {
    const rows = [{ ID: 'A' }, { ID: 'B' }];
    expect(
      selectGenerateRowIndices({
        rows,
        rowIndex: 1,
        exportScope: 'single',
        idColumn: 'ID',
        requiresImages: false,
        images: [],
      }),
    ).toEqual([1]);
  });

  it("excludes the current row in 'single' scope when images are required but none match", () => {
    const rows = [{ ID: 'A' }];
    expect(
      selectGenerateRowIndices({
        rows,
        rowIndex: 0,
        exportScope: 'single',
        idColumn: 'ID',
        requiresImages: true,
        images: [new File([], 'unrelated.txt')],
      }),
    ).toEqual([]);
  });

  it("includes the current row in 'single' scope when an image matches the record id", () => {
    const rows = [{ ID: 'A' }];
    const images = [new File([], 'A-1.jpg')];
    expect(
      selectGenerateRowIndices({
        rows,
        rowIndex: 0,
        exportScope: 'single',
        idColumn: 'ID',
        requiresImages: true,
        images,
      }),
    ).toEqual([0]);
  });

  it("returns all row indices in 'all' scope when images aren't required", () => {
    const rows = [{ ID: 'A' }, { ID: 'B' }, { ID: 'C' }];
    expect(
      selectGenerateRowIndices({
        rows,
        rowIndex: 0,
        exportScope: 'all',
        idColumn: 'ID',
        requiresImages: false,
        images: [],
      }),
    ).toEqual([0, 1, 2]);
  });

  it("filters out rows in 'all' scope when images are required and missing", () => {
    const rows = [{ ID: 'A' }, { ID: 'B' }];
    const images = [new File([], 'A-1.jpg')];
    expect(
      selectGenerateRowIndices({
        rows,
        rowIndex: 0,
        exportScope: 'all',
        idColumn: 'ID',
        requiresImages: true,
        images,
      }),
    ).toEqual([0]);
  });

  it('returns [] for a single row with no idColumn when images are required', () => {
    const rows = [{ ID: 'A' }];
    expect(
      selectGenerateRowIndices({
        rows,
        rowIndex: 0,
        exportScope: 'single',
        idColumn: '',
        requiresImages: true,
        images: [new File([], 'A-1.jpg')],
      }),
    ).toEqual([]);
  });
});
