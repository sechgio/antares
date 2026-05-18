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
