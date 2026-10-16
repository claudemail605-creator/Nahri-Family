import { describe, expect, it } from 'vitest';
import {
  ageYears,
  formatSupabaseDate,
  formatWhen,
  parseDate,
  toIsoDate,
  yearsBetween,
} from '../../src/core/dates';

describe('parseDate()', () => {
  it('reads the archive format day-first (DD/MM/YYYY)', () => {
    const d = parseDate('12/03/1940');
    expect(d?.toISOString().slice(0, 10)).toBe('1940-03-12');
  });

  it('accepts - and . separators', () => {
    expect(parseDate('1-2-1955')?.toISOString().slice(0, 10)).toBe('1955-02-01');
    expect(parseDate('3.12.1960')?.toISOString().slice(0, 10)).toBe('1960-12-03');
  });

  it('reads a bare year as 1 January', () => {
    expect(parseDate('1947')?.toISOString().slice(0, 10)).toBe('1947-01-01');
  });

  it('falls back to Date parsing for ISO strings', () => {
    expect(parseDate('1940-03-12')?.toISOString().slice(0, 10)).toBe('1940-03-12');
  });

  it('returns null for empty or unusable input', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate('not a date')).toBeNull();
  });
});

describe('yearsBetween()', () => {
  it('counts whole years only', () => {
    expect(yearsBetween(new Date('1940-03-12T00:00:00Z'), new Date('2000-03-11T00:00:00Z'))).toBe(59);
    expect(yearsBetween(new Date('1940-03-12T00:00:00Z'), new Date('2000-03-12T00:00:00Z'))).toBe(60);
  });
});

describe('formatSupabaseDate()', () => {
  it('turns a Supabase date into DD/MM/YYYY', () => {
    expect(formatSupabaseDate('1940-03-12')).toBe('12/03/1940');
  });

  it('returns null for empty or unusable values', () => {
    expect(formatSupabaseDate(null)).toBeNull();
    expect(formatSupabaseDate('')).toBeNull();
    expect(formatSupabaseDate('nope')).toBeNull();
  });
});

describe('toIsoDate()', () => {
  it('keeps only the calendar date of a timestamp', () => {
    expect(toIsoDate('1940-03-12T00:00:00Z')).toBe('1940-03-12');
  });

  it('passes a Date through in UTC', () => {
    expect(toIsoDate(new Date('1955-02-01T00:00:00Z'))).toBe('1955-02-01');
  });

  it('returns null when there is nothing usable', () => {
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate(new Date('invalid'))).toBeNull();
  });
});

describe('ageYears()', () => {
  const now = new Date('2026-01-01T00:00:00Z');

  it('ages at death when a death date exists', () => {
    expect(ageYears('1940', '2005', now)).toBe(65);
  });

  it('ages to today for the living', () => {
    expect(ageYears('1940', null, now)).toBe(86);
  });

  it('respects a death date that does not parse (no invented age)', () => {
    expect(ageYears('1940', 'unknown', now)).toBeNull();
  });

  it('returns null without a birth date', () => {
    expect(ageYears(null, null, now)).toBeNull();
  });
});

describe('formatWhen()', () => {
  it('renders a readable local timestamp', () => {
    const out = formatWhen('2026-01-02T03:04:05Z', 'en-GB');
    expect(out).toMatch(/2026/);
  });

  it('returns null for unusable values', () => {
    expect(formatWhen(null)).toBeNull();
    expect(formatWhen('nope')).toBeNull();
  });
});
