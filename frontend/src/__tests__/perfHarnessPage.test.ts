import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const FRONTEND_DIR = path.resolve(__dirname, '..', '..');
const HARNESS_HTML = path.join(FRONTEND_DIR, 'perf-harness.html');
const INDEX_HTML = path.join(FRONTEND_DIR, 'index.html');
const VITE_CONFIG = path.join(FRONTEND_DIR, 'vite.config.ts');

describe('perf-harness.html (dev-only entry)', () => {
  it('exists and loads the perfHarness module', () => {
    expect(fs.existsSync(HARNESS_HTML), 'perf-harness.html missing').toBe(true);
    const html = fs.readFileSync(HARNESS_HTML, 'utf-8');
    expect(html).toContain('/src/perfHarness.tsx');
  });

  it('is not referenced by the production entry (index.html)', () => {
    const html = fs.readFileSync(INDEX_HTML, 'utf-8');
    expect(html).not.toContain('perfHarness');
    expect(html).not.toContain('perf-harness');
  });

  it('is not added to the production rollup inputs (build stays dev-only)', () => {
    const config = fs.readFileSync(VITE_CONFIG, 'utf-8');
    expect(config).not.toContain('perf-harness');
  });
});
