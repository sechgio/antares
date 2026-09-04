import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('water cut notice print styles', () => {
  it('keeps the notice header compact for preview and PDF export', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/padron/vpad-styles.css'), 'utf-8');

    expect(css).toContain('.vpad-cut-head');
    expect(css).toMatch(/\.vpad-cut-head\s*\{[^}]*min-height:\s*18mm/s);
    expect(css).toMatch(/\.vpad-cut-title-block\s*\{[^}]*padding:\s*1\.6mm 4mm/s);
    expect(css).toMatch(/\.vpad-cut-logo\s*\{[^}]*padding:\s*1\.6mm 3mm/s);
  });

  it('keeps 36 table rows clear of the page footer', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/padron/vpad-styles.css'), 'utf-8');

    expect(css).toMatch(/\.vpad-cut-table-wrap\s*\{[^}]*margin-bottom:\s*7mm/s);
    expect(css).toMatch(/\.vpad-cut-table th,\s*\.vpad-cut-table td\s*\{[^}]*padding:\s*0\.35mm 0\.7mm/s);
    expect(css).toMatch(/\.vpad-cut-table th\s*\{[^}]*height:\s*7mm/s);
    expect(css).toMatch(/\.vpad-cut-table tbody tr\s*\{[^}]*height:\s*5\.8mm/s);
    expect(css).toMatch(/\.vpad-cut-sheet \.vpad-sheet-foot\s*\{[^}]*bottom:\s*4mm/s);
  });
});

describe('volante lurigancho print styles', () => {
  it('defines isolated layout hooks', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/padron/vpad-styles.css'), 'utf-8');

    expect(css).toContain('.vpad-sheet.volante-lurigancho');
    expect(css).toContain('.vpad-sheet-folio-top');
    expect(css).toContain('.vpad-volanteo-section-lurigancho');
    expect(css).toMatch(/\.vpad-sheet\.volante-lurigancho\.is-followup\s*\{[^}]*padding-top:\s*8mm/s);
  });
});

describe('appearance theme integration', () => {
  it('keeps preview chrome on shared appearance variables', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/padron/vpad-styles.css'), 'utf-8');

    const rulePropertyValues = (selector: string, property: string) => {
      const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return Array.from(css.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g')))
        .map((match) => match[1].match(new RegExp(`${property}\\s*:\\s*([^;]+)`))?.[1]?.trim())
        .filter((value): value is string => Boolean(value));
    };

    for (const [selector, property] of [
      ['.vpad-preview-toolbar', 'background'],
      ['.vpad-preview-toolbar', 'color'],
      ['.vpad-preview-title h2', 'color'],
      ['.vpad-badge', 'background'],
      ['.vpad-badge', 'color'],
      ['.vpad-btn-nav', 'background'],
      ['.vpad-btn-nav', 'color'],
      ['.vpad-preview-scroll-container', 'background-color'],
      ['.vpad-preview-toolbar .vpad-tool-cluster', 'background'],
    ] as const) {
      const values = rulePropertyValues(selector, property);
      expect(values.length, `${selector} ${property} should be declared`).toBeGreaterThan(0);
      for (const value of values) {
        expect(value, `${selector} ${property}`).toMatch(/var\(--vpad-/);
      }
    }

    expect(css).toMatch(
      /\.vpad-preview-toolbar \.vpad-tool-chip,\s*\.vpad-preview-toolbar \.vpad-folio-menu--toolbar \.vpad-folio-menu-trigger\s*\{[^}]*color:\s*var\(--vpad-/s,
    );
  });
});

describe('padron form control borders', () => {
  it('uses neutral appearance borders until a control receives focus', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/padron/vpad-styles.css'), 'utf-8');

    expect(css).toMatch(
      /\.vpad-inset-control,\s*\.vpad-inset-control-wrap input,\s*\.vpad-inset-control-wrap textarea,\s*\.vpad-inset-control-wrap select,\s*\.vpad-inset-control-wrap \.app-date-picker-trigger\s*\{[^}]*border:\s*1px solid var\(--vpad-border-strong\)/s,
    );
    expect(css).toMatch(
      /\.vpad-field input,\s*\.vpad-field select,\s*\.vpad-field textarea,\s*\.vpad-field \.app-date-picker-trigger\s*\{[^}]*border:\s*1px solid var\(--vpad-border-strong\)/s,
    );
    expect(css).toMatch(
      /\.vpad-inset-control:hover,\s*\.vpad-inset-control-wrap input:hover,\s*\.vpad-inset-control-wrap textarea:hover,\s*\.vpad-inset-control-wrap select:hover,\s*\.vpad-inset-control-wrap \.app-date-picker-trigger:hover:not\(:disabled\)\s*\{[^}]*border-color:\s*var\(--vpad-border-strong\)/s,
    );
    expect(css).toMatch(
      /\.vpad-field input:hover,\s*\.vpad-field select:hover,\s*\.vpad-field textarea:hover,\s*\.vpad-field \.app-date-picker-trigger:hover:not\(:disabled\)\s*\{[^}]*border-color:\s*var\(--vpad-border-strong\)/s,
    );
    expect(css).toMatch(
      /\.vpad-inset-control:focus,\s*\.vpad-inset-control-wrap input:focus,\s*\.vpad-inset-control-wrap textarea:focus,\s*\.vpad-inset-control-wrap select:focus,\s*\.vpad-inset-control-wrap \.app-date-picker-trigger:focus-visible,\s*\.vpad-inset-control-wrap \.app-date-picker-trigger\.is-open\s*\{[^}]*border-color:\s*var\(--vpad-accent\)/s,
    );
  });
});
