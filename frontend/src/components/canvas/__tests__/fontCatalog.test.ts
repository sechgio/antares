import { describe, expect, it } from 'vitest';
import {
  CANVAS_FONTS,
  allGoogleFontFamilies,
  buildGoogleFontsStylesheetUrl,
  collectGoogleFontFamilies,
  getFontByStack,
  googleFontsHeadHtml,
} from '../ops/fontCatalog';
import { createLayer } from '../constants';
import { createEmptyDocument } from '../types';
import { renderCanvasHtml } from '../runtime/renderHtml';

describe('fontCatalog', () => {
  it('has unique ids and stacks', () => {
    const ids = CANVAS_FONTS.map((f) => f.id);
    const stacks = CANVAS_FONTS.map((f) => f.stack);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(stacks).size).toBe(stacks.length);
  });

  it('keeps legacy system stacks resolvable', () => {
    expect(getFontByStack('Segoe UI, Arial, sans-serif')?.id).toBe('segoe-ui');
    expect(getFontByStack('Georgia, serif')?.source).toBe('system');
    expect(getFontByStack("'Inter', sans-serif")?.family).toBe('Inter');
  });

  it('buildGoogleFontsStylesheetUrl only for google families', () => {
    expect(buildGoogleFontsStylesheetUrl([])).toBe('');
    const url = buildGoogleFontsStylesheetUrl(['Inter', 'Roboto']);
    expect(url).toContain('https://fonts.googleapis.com/css2?');
    expect(url).toContain('family=Inter');
    expect(url).toContain('family=Roboto');
    expect(url).toContain('display=swap');
  });

  it('allGoogleFontFamilies excludes system fonts', () => {
    const families = allGoogleFontFamilies();
    expect(families).not.toContain('Segoe UI');
    expect(families).toContain('Inter');
    expect(families.length).toBe(CANVAS_FONTS.filter((f) => f.source === 'google').length);
  });

  it('collectGoogleFontFamilies ignores system stacks', () => {
    const layers = [
      { cssVars: { '--font-family': 'Segoe UI, Arial, sans-serif' } },
      { cssVars: { '--font-family': "'Inter', sans-serif" } },
      { cssVars: { '--font-family': "'JetBrains Mono', monospace" } },
    ];
    expect(collectGoogleFontFamilies(layers)).toEqual(['Inter', 'JetBrains Mono']);
  });

  it('googleFontsHeadHtml is empty without families', () => {
    expect(googleFontsHeadHtml([])).toBe('');
    const html = googleFontsHeadHtml(['Inter']);
    expect(html).toContain('fonts.googleapis.com');
    expect(html).toContain('rel="stylesheet"');
  });
});

describe('renderCanvasHtml google fonts', () => {
  const emptyCtx = { data: {}, images: [] as string[], logoLeft: null, logoRight: null };

  it('injects Google Fonts link when a google family is used', () => {
    const doc = createEmptyDocument('Fonts');
    const text = createLayer('text');
    text.cssVars['--font-family'] = "'Inter', sans-serif";
    const html = renderCanvasHtml({ ...doc, layers: [...doc.layers, text] }, emptyCtx);
    expect(html).toContain('https://fonts.googleapis.com/css2?');
    expect(html).toContain('family=Inter');
    expect(html).toContain("font-family:'Inter', sans-serif");
  });

  it('omits Google Fonts link when only system fonts are used', () => {
    const doc = createEmptyDocument('System');
    const text = createLayer('text');
    text.cssVars['--font-family'] = 'Georgia, serif';
    const html = renderCanvasHtml({ ...doc, layers: [...doc.layers, text] }, emptyCtx);
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).toContain('font-family:Georgia, serif');
  });
});
