import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(__dirname, '..');

function readLocale(name: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'locales', name), 'utf-8')) as Record<string, string>;
}

function walkSource(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSource(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') && !entry.name.includes('.test.')) acc.push(full);
  }
  return acc;
}

function toastKeysFromSource(): Array<{ file: string; key: string }> {
  const found: Array<{ file: string; key: string }> = [];
  for (const file of walkSource(SRC_DIR)) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes('addToast')) continue;
    const rel = path.relative(SRC_DIR, file).split(path.sep).join('/');
    const callRe = /addToast\(\{([\s\S]*?)\}\)/g;
    let call: RegExpExecArray | null;
    while ((call = callRe.exec(text))) {
      const keyMatch = /\bt\(\s*['"]([^'"]+)['"]/.exec(call[1]);
      if (keyMatch?.[1]?.includes('.')) found.push({ file: rel, key: keyMatch[1] });
    }
  }
  return found;
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

  it('keeps every addToast t() key in both locale bundles', () => {
    const toastKeys = toastKeysFromSource();
    expect(toastKeys.length).toBeGreaterThan(0);
    for (const { file, key } of toastKeys) {
      expect(es[key], `${file} uses missing es key ${key}`).toBeTruthy();
      expect(en[key], `${file} uses missing en key ${key}`).toBeTruthy();
    }
  });
});
