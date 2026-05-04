import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const srcRoot = resolve(__dirname, '../..');

function readSource(path: string) {
  return readFileSync(resolve(srcRoot, path), 'utf8');
}

describe('global appearance coverage', () => {
  it('keeps database and conversion chrome on appearance tokens instead of fixed shell colors', () => {
    const files = [
      'components/database/DatabaseView.tsx',
      'components/conversion/PreviewDrawer.tsx',
      'components/history/HistoryView.tsx',
      'components/history/RunList.tsx',
      'components/history/RunDetail.tsx',
      'components/layout/TitleBar.tsx',
    ];

    for (const file of files) {
      const source = readSource(file);

      expect(source, file).not.toMatch(/#(?:0A0A0A|111111|1A1A1A|222222|333333|555555|666666|A0A0A0|5E6AD2|FFFFFF)\b/i);
      expect(source, file).toMatch(/var\(--(?:bg|text|border|accent)-/);
    }
  });

  it('maps custom module chrome variables to shared appearance tokens', () => {
    const moduleStyles = [
      'components/volantes/styles.css',
      'components/padron/vpad-styles.css',
      'components/reportes-campo/rcampo-styles.css',
    ];

    for (const file of moduleStyles) {
      const source = readSource(file);

      expect(source, file).toMatch(/var\(--bg-base\)/);
      expect(source, file).toMatch(/var\(--bg-surface\)/);
      expect(source, file).toMatch(/var\(--accent-primary\)/);
      expect(source, file).toMatch(/var\(--border-subtle\)/);
    }
  });
});
