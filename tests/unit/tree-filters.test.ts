import { describe, expect, it } from 'vitest';
import { computeVisibility, createFilters, filtersActive, personMatches } from '../../src/features/tree/filters';
import { modelOf, FIXTURE_ROWS } from './tree-fixture';

const model = modelOf(...FIXTURE_ROWS);
const person = (id: string) => model.byId.get(id)!;

describe('personMatches()', () => {
  it('matches every whitespace-separated term, case-insensitively', () => {
    const f = createFilters();
    f.q = 'karam lahOre';
    expect(personMatches(model, f, person('grandpa'))).toBe(true);
    f.q = 'karam karachi';
    expect(personMatches(model, f, person('grandpa'))).toBe(false);
  });

  it('matches across scripts (Urdu and Hindi queries find the same person)', () => {
    const f = createFilters();
    f.q = 'کرام';
    expect(personMatches(model, f, person('grandpa'))).toBe(true);
    f.q = 'कराम';
    expect(personMatches(model, f, person('grandpa'))).toBe(true);
  });

  it('filters by generation and gender class', () => {
    const f = createFilters();
    f.gens = new Set([2]);
    expect(personMatches(model, f, person('child-a'))).toBe(true);
    expect(personMatches(model, f, person('father'))).toBe(false);
    f.gens.clear();
    f.genders = new Set(['female']);
    expect(personMatches(model, f, person('child-a'))).toBe(true);
    expect(personMatches(model, f, person('child-b'))).toBe(false);
  });

  it('filters living vs deceased', () => {
    const f = createFilters();
    f.status = 'deceased';
    expect(personMatches(model, f, person('father'))).toBe(true);
    expect(personMatches(model, f, person('uncle'))).toBe(false);
    f.status = 'living';
    expect(personMatches(model, f, person('uncle'))).toBe(true);
    expect(personMatches(model, f, person('father'))).toBe(false);
  });

  it('filters by branch including the branch person themself', () => {
    const f = createFilters();
    f.branch = 'father';
    expect(personMatches(model, f, person('father'))).toBe(true);
    expect(personMatches(model, f, person('child-b'))).toBe(true);
    expect(personMatches(model, f, person('uncle'))).toBe(false);
  });

  it('filters by exact place of birth and qualification', () => {
    const f = createFilters();
    f.pob = 'Lahore';
    expect(personMatches(model, f, person('grandpa'))).toBe(true);
    expect(personMatches(model, f, person('uncle'))).toBe(false);
    f.pob = '';
    f.qual = 'B.A.';
    expect(personMatches(model, f, person('grandpa'))).toBe(true);
    expect(personMatches(model, f, person('father'))).toBe(false);
  });

  it('supports the has-dob/spouse/children/nochildren filters', () => {
    const f = createFilters();
    f.has = 'dob';
    expect(personMatches(model, f, person('grandpa'))).toBe(true);
    f.has = 'spouse';
    expect(personMatches(model, f, person('grandpa'))).toBe(true);
    expect(personMatches(model, f, person('child-a'))).toBe(false);
    f.has = 'children';
    expect(personMatches(model, f, person('father'))).toBe(true);
    expect(personMatches(model, f, person('child-a'))).toBe(false);
    f.has = 'nochildren';
    expect(personMatches(model, f, person('child-a'))).toBe(true);
    expect(personMatches(model, f, person('father'))).toBe(false);
  });
});

describe('filtersActive()', () => {
  it('is false for a fresh state and true once anything is set', () => {
    const f = createFilters();
    expect(filtersActive(f)).toBe(false);
    f.q = 'x';
    expect(filtersActive(f)).toBe(true);
  });
});

describe('computeVisibility()', () => {
  it('returns everyone (visible=null) when nothing is filtered', () => {
    const vis = computeVisibility(model, createFilters());
    expect(vis.visible).toBeNull();
    expect(vis.vKids).toBe(model.kids);
    expect(vis.vRoots).toBe(model.roots);
  });

  it('re-attaches a match whose parent was filtered out to the nearest visible ancestor', () => {
    const f = createFilters();
    f.q = 'child-a'; // father and grandpa do not match
    const vis = computeVisibility(model, f);
    expect(vis.visible!.has('child-a')).toBe(true);
    expect(vis.visible!.has('father')).toBe(false);
    expect(vis.vRoots.map((p) => p.id)).toEqual(['child-a']);
    expect(vis.vKids.get('father')).toEqual([]);
  });

  it('keeps the branch person on screen even when they do not match the filter', () => {
    const f = createFilters();
    f.branch = 'father';
    const vis = computeVisibility(model, f);
    expect(vis.visible!.has('father')).toBe(true);
    expect(vis.visible!.has('child-b')).toBe(true);
    expect(vis.visible!.has('uncle')).toBe(false);
    expect(vis.vRoots.map((p) => p.id)).toEqual(['father']);
  });

  it('keeps a match whose ancestor matches under that ancestor', () => {
    const f = createFilters();
    f.pob = 'Lahore';
    const vis = computeVisibility(model, f);
    expect(vis.vRoots.map((p) => p.id)).toEqual(['grandpa']);
    expect(vis.vKids.get('grandpa')).toEqual([]); // father/uncle do not match
  });

  it('excludes a soft-deleted person from visibility when the model excluded them', () => {
    const rows = FIXTURE_ROWS.map((r) =>
      r.id === 'uncle' ? { ...r, is_deleted: true } : r,
    );
    const m = modelOf(...rows);
    const vis = computeVisibility(m, createFilters());
    expect(vis.visible).toBeNull();
    expect(m.byId.has('uncle')).toBe(false);
  });
});
