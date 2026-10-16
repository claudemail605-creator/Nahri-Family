import { describe, expect, it } from 'vitest';
import { initials } from '../../src/core/names';

describe('initials()', () => {
  it('skips honorifics and uses the first two remaining words', () => {
    expect(initials('Syed Mazharuddin Nahri')).toBe('MN');
    expect(initials('Syeda Fatima Nahri')).toBe('FN');
    expect(initials('Mohammed Ali Khan')).toBe('AK');
  });

  it('handles single names and casing', () => {
    expect(initials('fatima')).toBe('F');
    expect(initials('md khan')).toBe('K');
  });

  it('falls back to ? for missing names', () => {
    expect(initials(null)).toBe('?');
    expect(initials(undefined)).toBe('?');
    expect(initials('')).toBe('?');
    expect(initials('   ')).toBe('?');
  });
});
