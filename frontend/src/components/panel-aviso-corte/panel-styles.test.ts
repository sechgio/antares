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
    expect(css).toMatch(/\.pac-cell-photo img\s*\{[^}]*width:\s*100%/s);
    expect(css).toMatch(/\.pac-cell-photo img\s*\{[^}]*height:\s*100%/s);
    expect(css).toMatch(/\.pac-cell-photo img\s*\{[^}]*object-fit:\s*cover/s);
  });
});
