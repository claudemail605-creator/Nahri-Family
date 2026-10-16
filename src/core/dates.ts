/**
 * Date helpers for the family archive, ported from the reference app
 * (`js/app.js`). All pure and unit-tested — the family's dates are stored as
 * text, so parsing rules are the most fragile part of the whole port and are
 * deliberately conservative:
 *
 *   - `DD/MM/YYYY` (also `-` / `.` separators) — the archive's own format;
 *   - a bare `YYYY`;
 *   - anything `new Date()` understands as a fallback.
 *
 * Day-first order is intentional and must NOT be "corrected" to month-first.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/** Parse a family date string. Returns null when nothing sensible is there. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  let m = String(value).match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  m = String(value).match(/^(\d{4})$/);
  if (m) return new Date(Date.UTC(Number(m[1]), 0, 1));
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whole years between two dates (UTC — family dates are date-only). */
export function yearsBetween(a: Date, b: Date): number {
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  const months = b.getUTCMonth() - a.getUTCMonth();
  if (months < 0 || (months === 0 && b.getUTCDate() < a.getUTCDate())) years--;
  return years;
}

/** `YYYY-MM-DD` for a `<input type="date">`; never rewrites the stored text. */
export function toIsoDate(value: string | Date | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10) || null;
}

/** A Supabase date (`YYYY-MM-DD`) or a Date as `DD/MM/YYYY`; null when unusable. */
export function formatSupabaseDate(value: string | Date | null | undefined): string | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : parseDate(String(value));
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** A timestamp (created_at / updated_at / changed_at) as a local string. */
export function formatWhen(iso: string | null | undefined, locale?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Age in whole years: at death when a death date exists, otherwise today.
 * Null when there is no usable birth date (or a death date that does not
 * parse — same guard as the reference, so we never show a wrong age).
 */
export function ageYears(dob: string | null | undefined, dod: string | null | undefined, now?: Date): number | null {
  const birth = parseDate(dob);
  if (!birth) return null;
  const death = parseDate(dod);
  if (dod && !death) return null;
  const years = yearsBetween(birth, death ?? now ?? new Date());
  return years < 0 ? null : years;
}
