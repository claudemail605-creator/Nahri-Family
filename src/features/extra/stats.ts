/**
 * Tree statistics (L3) — the reference `js/extras.js` `renderStats` data as a
 * pure function: people per generation, gender split, oldest and youngest
 * living members, the five most common birthplaces and the five people with
 * the most (visible) children. All read-only, straight off the model.
 */
import { ageYears, parseDate } from '../../core/dates';
import { genderClass, type Person, type TreeModel } from '../tree/model';

export interface StatsResult {
  /** People counted (soft-deleted stay out, same as the reference). */
  people: number;
  gens: Array<{ gen: number; count: number }>;
  men: number;
  women: number;
  unknown: number;
  oldest: { person: Person; age: number } | null;
  youngest: { person: Person; age: number } | null;
  places: Array<{ place: string; count: number }>;
  children: Array<{ person: Person; count: number }>;
}

/** Top `max` values, most common first, tie-broken alphabetically (ref rule). */
function topBy(values: string[], max: number): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, max);
}

export function buildStats(model: TreeModel, now: Date = new Date()): StatsResult {
  const people = model.people.filter((p) => !p.is_deleted);
  const byGen = new Map<number, number>();
  for (const p of people) byGen.set(p.gen, (byGen.get(p.gen) ?? 0) + 1);

  const men = people.filter((p) => genderClass(p) === 'male').length;
  const women = people.filter((p) => genderClass(p) === 'female').length;
  const unknown = people.length - men - women;

  // Only full dates count for ages — "1970" is a birth year, not a birthday.
  const withDob = people
    .map((p) => ({ p, d: parseDate(p.dob) }))
    .filter((x) => x.d && /^\d{4}-\d{2}-\d{2}$/.test(x.p.dob_iso ?? ''));
  const alive = withDob.filter((x) => !x.p.dod).sort((a, b) => a.d!.getTime() - b.d!.getTime());
  const ageOf = (p: Person): number => ageYears(p.dob_iso ?? p.dob, null, now) ?? 0;
  const oldest = alive[0]
    ? { person: alive[0].p, age: ageOf(alive[0].p) }
    : null;
  const youngest = alive[alive.length - 1] && alive.length > 1
    ? { person: alive[alive.length - 1]!.p, age: ageOf(alive[alive.length - 1]!.p) }
    : null;

  const places = topBy(people.map((p) => p.pob ?? '').filter(Boolean), 5);

  // Children counted in the visible (non-deleted) set only — what the stats
  // list can also show.
  const aliveIds = new Set(people.map((p) => p.id));
  const childCounts = [...model.kids.entries()]
    .map(([id, kids]) => ({ person: model.byId.get(id)!, count: kids.filter((k) => aliveIds.has(k.id)).length }))
    .filter((x) => x.person && !x.person.is_deleted && x.count > 0)
    .sort((a, b) => b.count - a.count || String(a.person.name).localeCompare(String(b.person.name)))
    .slice(0, 5);

  return {
    people: people.length,
    gens: [...byGen.entries()].map(([gen, count]) => ({ gen, count })).sort((a, b) => a.gen - b.gen),
    men,
    women,
    unknown,
    oldest,
    youngest,
    places: places.map((pl) => ({ place: pl.value, count: pl.count })),
    children: childCounts,
  };
}
