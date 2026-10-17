/**
 * Upcoming 30 days (L2) — birthdays and remembrance dates, the reference
 * `js/extras.js` `buildUpcoming` as a pure function. Year-only dates
 * ("1970") have no day or month, so they are never listed — the same honest
 * exclusion as the reference.
 */
import { parseDate } from '../../core/dates';
import type { Person, TreeModel } from '../tree/model';

export const UPCOMING_DAYS = 30;

export interface UpcomingRow {
  person: Person;
  kind: 'birth' | 'death';
  /** Days until the next anniversary (0 = today). */
  days: number;
  /** The age the person turns at that day, or the years since. */
  years: number;
  /** The rolled date (this or next year), UTC. */
  when: Date;
}

function tryAdd(
  out: UpcomingRow[],
  p: Person,
  kind: 'birth' | 'death',
  iso: string | null,
  base: Date,
): void {
  if (!iso) return;
  // A full date only: year-only texts cannot be listed.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dob_iso ?? p.dod_iso ?? '')) return;
  const d = parseDate(iso);
  if (!d) return;
  let when = new Date(Date.UTC(base.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (when.getTime() < base.getTime()) {
    when = new Date(Date.UTC(base.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()));
  }
  const days = Math.round((when.getTime() - base.getTime()) / 86400000);
  if (days > UPCOMING_DAYS) return;
  if (kind === 'birth' && p.dod) return; // not living
  out.push({
    person: p,
    kind,
    days,
    years: when.getUTCFullYear() - d.getUTCFullYear(),
    when,
  });
}

/** Everything in the next `UPCOMING_DAYS` days, soonest first. */
export function buildUpcoming(model: TreeModel, today: Date): UpcomingRow[] {
  // The caller hands in the day the list belongs to (midnight UTC), so tests
  // and the UI agree on "today".
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const out: UpcomingRow[] = [];
  for (const p of model.people) {
    if (p.is_deleted) continue;
    if (p.dob) tryAdd(out, p, 'birth', p.dob, base);
    if (p.dod) tryAdd(out, p, 'death', p.dod, base);
  }
  out.sort(
    (a, b) =>
      a.days - b.days ||
      String(a.person.name).localeCompare(String(b.person.name)) ||
      a.kind.localeCompare(b.kind),
  );
  return out;
}
