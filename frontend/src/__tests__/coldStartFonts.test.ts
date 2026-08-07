import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = path.join(__dirname, '..');

describe('cold-start font loading', () => {
  it('does not import the full @fontsource-variable/inter package in main', () => {
    const src = fs.readFileSync(path.join(srcRoot, 'main.tsx'), 'utf8');
    expect(src).not.toMatch(/import\s+['"]@fontsource-variable\/inter['"]/);
  });

  it('ships only the latin Inter face in index.css', () => {
    const css = fs.readFileSync(path.join(srcRoot, 'index.css'), 'utf8');
    expect(css).toMatch(/inter-latin-wght-normal\.woff2/);
    expect(css).not.toMatch(/inter-cyrillic/);
    expect(css).not.toMatch(/inter-greek/);
    expect(css).not.toMatch(/inter-vietnamese/);
    expect(css).not.toMatch(/inter-latin-ext/);
  });
});
