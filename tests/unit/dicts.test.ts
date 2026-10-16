import { describe, expect, it } from 'vitest';
import { en } from '../../src/core/i18n/dict.en';
import { hi } from '../../src/core/i18n/dict.hi';
import { ur } from '../../src/core/i18n/dict.ur';

const DICTS = { en, ur, hi } as const;
const enKeys = Object.keys(en).sort();

describe('shipped dictionaries', () => {
  it('English is the parity baseline (617 keys)', () => {
    expect(enKeys).toHaveLength(617);
  });

  it.each(['ur', 'hi'] as const)('%s defines exactly the English key set', (lang) => {
    expect(Object.keys(DICTS[lang]).sort()).toEqual(enKeys);
  });

  it.each(['en', 'ur', 'hi'] as const)('%s values are non-empty strings', (lang) => {
    const entries = Object.entries(DICTS[lang]);
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, value] of entries) {
      expect(typeof value, `${lang}.${key} should be a string`).toBe('string');
      expect(value.trim().length, `${lang}.${key} should not be empty`).toBeGreaterThan(0);
    }
  });

  it('carries the new app name in every language', () => {
    expect(en['brand.title']).toBe('Nahri Family');
    expect(ur['brand.title']).toBe('نہری فیملی');
    expect(hi['brand.title']).toBe('नहरी फैमिली');
  });
});
