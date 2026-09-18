import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import es from '../locales/es.json';

type Dict = Record<string, unknown>;

function flattenKeys(obj: Dict, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Dict, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

describe('locales parity', () => {
  const esKeys = flattenKeys(es as Dict);
  const enKeys = flattenKeys(en as Dict);

  it('es y en exponen exactamente las mismas claves', () => {
    const esSet = new Set(esKeys);
    const enSet = new Set(enKeys);
    const missingInEn = esKeys.filter((k) => !enSet.has(k));
    const missingInEs = enKeys.filter((k) => !esSet.has(k));
    expect(missingInEn, `claves sin traducción en: ${missingInEn.join(', ')}`).toEqual([]);
    expect(missingInEs, `claves sin traducción es: ${missingInEs.join(', ')}`).toEqual([]);
  });

  it('ninguna clave de es está vacía', () => {
    const checkEmpty = (obj: Dict, prefix = ''): string[] => {
      const empty: string[] = [];
      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value !== null && typeof value === 'object') {
          empty.push(...checkEmpty(value as Dict, path));
        } else if (typeof value === 'string' && !value.trim()) {
          empty.push(path);
        }
      }
      return empty;
    };
    expect(checkEmpty(es as Dict)).toEqual([]);
  });
});
