import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(__dirname, '..');

function readLocale(name: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'locales', name), 'utf-8')) as Record<string, string>;
}

describe('locale bundle contracts', () => {
  const es = readLocale('es.json');
  const en = readLocale('en.json');

  it('keeps Spanish and English keys in sync', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });

  it('includes the optimizer interaction vocabulary in both bundles', () => {
    const optimizerKeys = Object.keys(es).filter((key) => key.startsWith('optimizer.'));

    expect(optimizerKeys.length).toBeGreaterThan(0);
    for (const key of optimizerKeys) {
      expect(es[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
  });
});
