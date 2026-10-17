/*
 * The Phase 6 tools' pure logic (L1–L3): the kinship walker, the upcoming
 * 30-day list and the statistics — everything the tools modal renders comes
 * from these three functions, so this file pins the family wording, the
 * date-window rules and the stat definitions against hand-chosen families.
 */
import { describe, expect, it } from 'vitest';
import { modelOf, rawRow } from './tree-fixture';
import { chainOf, computeRelation } from '../../src/features/extra/kinship';
import { buildUpcoming, UPCOMING_DAYS } from '../../src/features/extra/upcoming';
import { buildStats } from '../../src/features/extra/stats';

/*
 * Five generations under one grandfather, a second root unconnected:
 *
 *   oldman ── father ──┬─ me ─────┬─ grand1 ── ggf ── gchild
 *                      │          └─ cousin1
 *                      └─ daughter ── cousin2     other
 */
const FAMILY = [
  rawRow({ id: 'oldman', full_name: 'Old ManFixture', gender: 'Male', dob: '1900-01-01' }),
  rawRow({ id: 'father', full_name: 'Father Fixture', gender: 'Male', parent_id: 'oldman', dob: '1930-01-01' }),
  rawRow({ id: 'me', full_name: 'Me Fixture', gender: 'Male', parent_id: 'father', dob: '1960-01-01' }),
  rawRow({ id: 'daughter', full_name: 'Daughter Fixture', gender: 'Female', parent_id: 'father', dob: '1965-06-15' }),
  rawRow({ id: 'grand1', full_name: 'Grand Fixture', gender: 'Male', parent_id: 'me', dob: '1985-01-01' }),
  rawRow({ id: 'ggf', full_name: 'Gg Fixture', gender: 'Female', parent_id: 'grand1', dob: '2005-01-01' }),
  rawRow({ id: 'gchild', full_name: 'Gchild Fixture', gender: 'Male', parent_id: 'ggf', dob: '2015-01-01' }),
  rawRow({ id: 'cousin1', full_name: 'Cousin One', gender: 'Male', parent_id: 'me', dob: '1990-01-01' }),
  rawRow({ id: 'cousin2', full_name: 'Cousin Two', gender: 'Female', parent_id: 'daughter', dob: '1990-01-01' }),
  rawRow({ id: 'other', full_name: 'Other Fixture', gender: 'Male', dob: '1940-01-01' }),
];

describe('chainOf (L1)', () => {
  it('returns the database path root-first when the model has it', () => {
    const model = modelOf(...FAMILY);
    const me = model.byId.get('me')!;
    expect(chainOf(model, me).map((p) => p.id)).toEqual(['oldman', 'father', 'me']);
  });

  it('falls back to walking parent links when the path column is empty', () => {
    const model = modelOf(
      rawRow({ id: 'a', full_name: 'A', gender: 'Male' }),
      rawRow({ id: 'b', full_name: 'B', gender: 'Female', parent_id: 'a' }),
    );
    const b = model.byId.get('b')!;
    b.path = [];
    expect(chainOf(model, b).map((p) => p.id)).toEqual(['a', 'b']);
  });
});

describe('computeRelation (L1)', () => {
  const model = modelOf(...FAMILY);
  const term = (a: string, b: string) => computeRelation(model, a, b);

  it('is honest about the same person and about unconnected people', () => {
    expect(term('me', 'me')).toEqual({ kind: 'same' });
    // gchild descends oldman; `other` is a second root — no shared ancestor.
    expect(term('gchild', 'other')).toEqual({ kind: 'noPath' });
    expect(computeRelation(model, 'me', null)).toEqual({ kind: 'noPath' });
  });

  it('names the direct line by the person being named', () => {
    // me → oldman: "grandfather (Dada)" — the word is what me calls oldman.
    expect(term('me', 'oldman')).toMatchObject({
      kind: 'related',
      term: { key: 'kin.grandfatherPaternal', approx: false },
    });
    // me → grand1: son; ggf (his daughter) is grand1's granddaughter.
    expect(term('me', 'grand1')).toMatchObject({ term: { key: 'kin.son', approx: false } });
    expect(term('grand1', 'ggf')).toMatchObject({ term: { key: 'kin.daughter', approx: false } });
    // Three below: gchild is me's GREAT-grandson — named, not approximated.
    expect(term('me', 'gchild')).toMatchObject({ term: { key: 'kin.greatGrandson', approx: false } });
  });

  it('works out which side of the family an uncle or aunt is on', () => {
    // grand1 → daughter: father's sister (Phupho) — the chain travels the father.
    expect(term('grand1', 'daughter')).toMatchObject({ term: { key: 'kin.fathersSister' } });
    // daughter → grand1: brother's son (Bhatija).
    expect(term('daughter', 'grand1')).toMatchObject({ term: { key: 'kin.brotherSon' } });
  });

  it('names cousins and their children in the mirror direction', () => {
    expect(term('cousin1', 'cousin2')).toMatchObject({ term: { key: 'kin.cousinFemale' } });
    // me → cousin2 (daughter's daughter): sister's daughter (Bhanji).
    expect(term('me', 'cousin2')).toMatchObject({ term: { key: 'kin.sisterDaughter' } });
  });

  it('walks the loop for the chain read-out: A up, ancestor, down to B', () => {
    const r = computeRelation(model, 'cousin1', 'cousin2');
    if (r.kind !== 'related') throw new Error('expected related');
    expect(r.common.id).toBe('father');
    expect(r.chain.map((p) => p.id)).toEqual(['cousin1', 'me', 'father', 'daughter', 'cousin2']);
    expect(r.sentence).toEqual({
      key: 'extra.relatedThrough',
      a: r.chain[0],
      up: 2,
      b: r.chain[4],
      down: 2,
    });
  });

  it('states only one distance when one person is the common ancestor', () => {
    const r = computeRelation(model, 'me', 'grand1');
    if (r.kind !== 'related') throw new Error('expected related');
    expect(r.common.id).toBe('me');
    expect(r.sentence).toEqual({ key: 'extra.relatedBelow', person: model.byId.get('grand1'), n: 1 });
  });
});

describe('buildUpcoming (L2)', () => {
  const base = new Date('2026-10-17T12:00:00Z');
  const model = modelOf(
    // today, exactly
    rawRow({ id: 'p-today', full_name: 'Today', gender: 'Male', dob: '1970-10-17' }),
    // in three days, turns 66
    rawRow({ id: 'p-soon', full_name: 'Soon', gender: 'Female', dob: '1960-10-20' }),
    // in 64 days — past the 30-day window
    rawRow({ id: 'p-far', full_name: 'Far', gender: 'Male', dob: '2000-12-20' }),
    // birthday last week: rolls to next year, so out of the window
    rawRow({ id: 'p-past', full_name: 'Past', gender: 'Male', dob: '1972-10-10' }),
    // a year-only date can never be listed
    rawRow({ id: 'p-year', full_name: 'YearOnly', gender: 'Male', dob: '1970' }),
    // not living: the birthday goes, the remembrance stays (5 days)
    rawRow({ id: 'p-gone', full_name: 'Gone', gender: 'Male', dob: '1950-10-22', dod: '2005-10-22' }),
    // soft-deleted rows stay out
    rawRow({ id: 'p-del', full_name: 'Deleted', gender: 'Male', dob: '1970-10-18', is_deleted: true }),
  );

  it('lists live birthdays and remembrances in the next 30 days, soonest first', () => {
    expect(UPCOMING_DAYS).toBe(30);
    const list = buildUpcoming(model, base);
    expect(list.map((r) => `${r.person.id}:${r.kind}:${r.days}`)).toEqual([
      'p-today:birth:0',
      'p-soon:birth:3',
      'p-gone:death:5',
    ]);
    expect(list[0]!.years).toBe(56);
    expect(list[1]!.years).toBe(66);
    // The remembrance years since the death.
    expect(list[2]!.years).toBe(21);
  });
});

describe('buildStats (L3)', () => {
  const now = new Date('2026-10-17T12:00:00Z');

  it('counts visible people per generation and gender', () => {
    const s = buildStats(modelOf(...FAMILY), now); // 10 visible people
    expect(s.people).toBe(10);
    expect(s.gens).toEqual([
      { gen: 0, count: 2 }, // oldman, other
      { gen: 1, count: 1 }, // father
      { gen: 2, count: 2 }, // me, daughter
      { gen: 3, count: 3 }, // grand1, cousin1, cousin2
      { gen: 4, count: 1 }, // ggf
      { gen: 5, count: 1 }, // gchild
    ]);
    expect(s.men).toBe(7);
    expect(s.women).toBe(3);
    expect(s.unknown).toBe(0);
  });

  it('names the oldest and youngest living people with full dates only', () => {
    const s = buildStats(modelOf(...FAMILY), now);
    expect(s.oldest?.person.id).toBe('oldman');
    expect(s.oldest?.age).toBe(126);
    expect(s.youngest?.person.id).toBe('gchild');
    expect(s.youngest?.age).toBe(11);
    // Year-only and text-only dates never fake an age, so an all-partial
    // family gets an honest "not enough data yet".
    const s2 = buildStats(
      modelOf(
        rawRow({ id: 'y', full_name: 'Y', gender: 'Male', dob: '1970' }),
        rawRow({ id: 't', full_name: 'T', gender: 'Female', dob_text: '1970-ish' }),
      ),
      now,
    );
    expect(s2.oldest).toBeNull();
    expect(s2.youngest).toBeNull();
    expect(s2.men).toBe(1);
    expect(s2.women).toBe(1);
  });

  it('ranks the most common birthplaces and the people with most children', () => {
    const model = modelOf(
      rawRow({ id: 'p1', full_name: 'P One', gender: 'Male', place_of_birth: 'Lahore' }),
      rawRow({ id: 'p2', full_name: 'P Two', gender: 'Female', place_of_birth: 'Lahore' }),
      rawRow({ id: 'p3', full_name: 'P Three', gender: 'Male', place_of_birth: 'Karachi' }),
      rawRow({ id: 'p4', full_name: 'P Four', gender: 'Male', parent_id: 'p1' }),
      rawRow({ id: 'p5', full_name: 'P Five', gender: 'Female', parent_id: 'p1' }),
      rawRow({ id: 'p6', full_name: 'P Six', gender: 'Male', parent_id: 'p1', is_deleted: true }),
    );
    const s = buildStats(model, now);
    expect(s.places).toEqual([
      { place: 'Lahore', count: 2 },
      { place: 'Karachi', count: 1 },
    ]);
    // Only visible children count what the stats list can also show.
    expect(s.children).toEqual([
      { person: model.byId.get('p1'), count: 2 },
    ]);
  });
});
