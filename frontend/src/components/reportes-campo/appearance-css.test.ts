import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('reportes-campo appearance styles', () => {
  it('uses theme variables instead of fixed hex colors', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/reportes-campo/rcampo-styles.css'), 'utf-8');

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).toContain('var(--bg-base)');
    expect(css).toContain('var(--accent-primary)');
  });
});
