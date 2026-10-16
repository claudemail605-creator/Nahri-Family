import { describe, expect, it } from 'vitest';
import { getDisplayName } from '../../src/core/i18n/display';

const person = {
  name: 'Syed Mazharuddin Nahri',
  name_ur: 'سید مظہر الدین نہری',
  name_hi: 'सैयद मज़हरुद्दीन नहरी',
};

describe('getDisplayName', () => {
  it('returns an empty string for missing people', () => {
    expect(getDisplayName(null, 'en')).toBe('');
    expect(getDisplayName(undefined, 'en')).toBe('');
    expect(getDisplayName({}, 'en')).toBe('');
  });

  it('uses the English name for English', () => {
    expect(getDisplayName(person, 'en')).toBe(person.name);
  });

  it('prefers the localised spelling for Urdu and Hindi', () => {
    expect(getDisplayName(person, 'ur')).toBe(person.name_ur);
    expect(getDisplayName(person, 'hi')).toBe(person.name_hi);
  });

  it('falls back to English when a localised name is missing', () => {
    expect(getDisplayName({ name: 'X' }, 'ur')).toBe('X');
    expect(getDisplayName({ name: 'X' }, 'hi')).toBe('X');
  });

  it('never borrows the wrong script', () => {
    // Urdu spelling present but Hindi is active and no Hindi spelling exists:
    // fall back to English, not to the Urdu text.
    expect(getDisplayName({ name_ur: 'الف' }, 'hi')).toBe('');
    expect(getDisplayName({ name: 'X', name_ur: 'الف' }, 'hi')).toBe('X');
    expect(getDisplayName({ name_ur: 'الف' }, 'en')).toBe('');
  });
});
