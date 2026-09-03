import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(__dirname, '..');
const CSS_FILES = [
  path.join(SRC_DIR, 'index.css'),
  path.join(SRC_DIR, 'components', 'volantes', 'styles.css'),
];
const TAILWIND_CONFIG = path.resolve(__dirname, '..', '..', 'tailwind.config.js');

function readAllCss(): string {
  return CSS_FILES.map((f) => fs.readFileSync(f, 'utf-8')).join('\n');
}

function readTailwindConfig(): string {
  return fs.readFileSync(TAILWIND_CONFIG, 'utf-8');
}

function findTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTsxFiles(fullPath));
    } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractClassNames(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const classes: string[] = [];
  const regex = /className=["'`{]([^"'`}]+)["'`}/]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const classNames = match[1].split(/\s+/).filter(Boolean);
    classes.push(...classNames);
  }
  return classes;
}

describe('CSS class audit', () => {
  const allCss = readAllCss();
  const tailwindConfig = readTailwindConfig();
  const allDefined = `${allCss}\n${tailwindConfig}`;

  const SUSPECT_CLASSES = [
    'animate-shimmer',
    'animate-slide-left',
    'custom-scrollbar',
  ];

  it.each(SUSPECT_CLASSES)('should define "%s" in CSS or Tailwind config', (className) => {
    const definedInCss = allCss.includes(`.${className}`) ||
      allCss.includes(`@keyframes ${className.replace('animate-', '')}`) ||
      allCss.includes(className.replace('animate-', ''));
    const definedInTailwind = tailwindConfig.includes(className) ||
      tailwindConfig.includes(className.replace('animate-', ''));

    expect(definedInCss || definedInTailwind).toBe(true);
  });

  it('should not have any SUSPECT_CLASSES used in source files without definition', () => {
    const tsxFiles = findTsxFiles(SRC_DIR);
    const usedClasses = new Set<string>();

    for (const file of tsxFiles) {
      const classes = extractClassNames(file);
      for (const cls of classes) {
        if (SUSPECT_CLASSES.includes(cls)) {
          usedClasses.add(cls);
        }
      }
    }

    const undefined: string[] = [];
    for (const cls of usedClasses) {
      const definedInCss = allCss.includes(`.${cls}`) ||
        allCss.includes(`@keyframes ${cls.replace('animate-', '')}`);
      const definedInTailwind = tailwindConfig.includes(cls);
      if (!definedInCss && !definedInTailwind) {
        undefined.push(cls);
      }
    }

    expect(undefined).toEqual([]);
  });
});
