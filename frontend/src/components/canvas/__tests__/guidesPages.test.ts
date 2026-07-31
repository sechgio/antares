import { describe, expect, it } from 'vitest';
import { createGuide, guidesForPage } from '../ops/guides';
import { addPage, duplicatePage, removePage } from '../ops/pages';
import { createEmptyDocument } from '../types';

describe('guides with page operations', () => {
  it('removePage drops guides on the deleted page and reindexes survivors', () => {
    let doc = createEmptyDocument('Guides');
    doc = addPage(doc);
    doc = {
      ...doc,
      guides: [createGuide('x', 10, 0), createGuide('y', 20, 1)],
    };
    const result = removePage(doc, 0);
    expect(result.guides).toHaveLength(1);
    expect(result.guides![0].pageIndex).toBe(0);
    expect(result.guides![0].posMm).toBe(20);
    expect(guidesForPage(result, 0)).toHaveLength(1);
  });

  it('removePage deletes guides on the removed page only', () => {
    let doc = createEmptyDocument('Guides');
    doc = addPage(doc);
    doc = { ...doc, guides: [createGuide('x', 15, 1)] };
    const result = removePage(doc, 1);
    expect(result.guides).toHaveLength(0);
  });

  it('duplicatePage clones guides with new ids and shifts later pages', () => {
    let doc = createEmptyDocument('Guides');
    doc = addPage(doc);
    const source = createGuide('x', 30, 1);
    doc = { ...doc, guides: [createGuide('y', 10, 0), source] };
    const result = duplicatePage(doc, 1);
    const page2Guides = guidesForPage(result, 2);
    expect(page2Guides).toHaveLength(1);
    expect(page2Guides[0].id).not.toBe(source.id);
    expect(page2Guides[0].posMm).toBe(30);
    expect(guidesForPage(result, 1)).toHaveLength(1);
  });

  it('duplicatePage handles missing guides without crashing', () => {
    let doc = createEmptyDocument('No guides');
    doc = addPage(doc);
    const result = duplicatePage(doc, 0);
    expect(result.guides ?? []).toHaveLength(0);
  });
});
