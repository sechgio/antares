import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('panel aviso preview styles', () => {
  it('fills photo cells the same way as the PDF export', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/components/panel-aviso-corte/panel-styles.css'),
      'utf-8',
    );

    expect(css).toMatch(/\.pac-cell-photo-inner\s*\{[^}]*height:\s*9\.82cm/s);
    expect(css).toMatch(/\.pac-cell-photo img\s*\{[^}]*width:\s*7\.36cm/s);
    expect(css).toMatch(/\.pac-cell-photo img\s*\{[^}]*height:\s*9\.82cm/s);
    expect(css).toMatch(/\.pac-cell-photo img\s*\{[^}]*object-fit:\s*cover/s);
  });

  it('keeps the workspace usable below the desktop sidebar width', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/components/panel-aviso-corte/panel-styles.css'),
      'utf-8',
    );

    expect(css).toMatch(/\.pac-sidebar\s*\{[^}]*min-width:\s*340px/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*900px\)[\s\S]*?\.pac-sidebar\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*900px\)[\s\S]*?\.pac-preview\s*\{[^}]*min-height:\s*360px/s);
  });
});
