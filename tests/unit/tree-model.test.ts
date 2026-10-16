import { describe, expect, it } from 'vitest';
import { buildModel, genderClass, isDescendantOf, toPerson } from '../../src/features/tree/model';
import { modelOf, peopleOf, rawRow, FIXTURE_ROWS } from './tree-fixture';

describe('toPerson()', () => {
  it('drops rows without an id or a name', () => {
    expect(toPerson(rawRow({ id: 'x', full_name: '' }))).toBeNull();
    expect(toPerson(rawRow({ id: '', full_name: 'No Id' }))).toBeNull();
    expect(toPerson(rawRow({ id: 'ok', full_name: 'Fine' }))).not.toBeNull();
  });

  it('maps the stored columns onto the internal shape', () => {
    const p = toPerson(
      rawRow({
        id: 'a1',
        full_name: 'Syed Karam Nahri',
        nick_name: 'Karam',
        parent_id: 'p1',
        gender: 'Male',
        spouse_name: 'Grandma Nahri',
        dob: '1940-03-12',
        dob_text: 'March 1940',
        dod: '2005-01-02',
        name_ur: 'کرام نہری',
        name_hi: 'कराम नहरी',
        place_of_birth: 'Lahore',
        is_deleted: true,
      }),
    );
    expect(p).not.toBeNull();
    expect(p!.id).toBe('a1');
    expect(p!.parentId).toBe('p1');
    expect(p!.dob).toBe('12/03/1940');
    expect(p!.dob_iso).toBe('1940-03-12');
    expect(p!.dob_display).toBe('March 1940'); // original text wins
    expect(p!.dod_display).toBe('02/01/2005'); // no text → tidied date
    expect(p!.is_deleted).toBe(true);
    expect(p!._initials).toBe('KN'); // honorific stripped
    expect(p!.name_ur).toBe('کرام نہری');
  });
});

describe('buildModel()', () => {
  const model = modelOf(...FIXTURE_ROWS);

  it('computes generation depth from the real parent links', () => {
    expect(model.byId.get('grandpa')!.gen).toBe(0);
    expect(model.byId.get('father')!.gen).toBe(1);
    expect(model.byId.get('child-a')!.gen).toBe(2);
  });

  it('wires parents and children in row order', () => {
    expect(model.byId.get('child-a')!.parent?.id).toBe('father');
    expect(model.kids.get('grandpa')!.map((p) => p.id)).toEqual(['father', 'uncle']);
    expect(model.roots.map((p) => p.id)).toEqual(['grandpa']);
  });

  it('builds one lower-cased haystack with all three scripts', () => {
    const hay = model.byId.get('grandpa')!._hay;
    expect(hay).toContain('syed karam nahri');
    expect(hay).toContain('کرام');
    expect(hay).toContain('कराम');
    expect(hay).toContain('lahore');
  });

  it('drops soft-deleted people unless showDeleted is on', () => {
    const rows = [...FIXTURE_ROWS, rawRow({ id: 'gone', full_name: 'Gone Person', is_deleted: true })];
    const hidden = buildModel(peopleOf(...rows), false);
    expect(hidden.byId.has('gone')).toBe(false);
    const shown = buildModel(peopleOf(...rows), true);
    expect(shown.byId.has('gone')).toBe(true);
  });

  it('parks a parent loop at the root instead of hanging or dropping people', () => {
    const rows = [
      rawRow({ id: 'a', full_name: 'Person A', parent_id: 'b' }),
      rawRow({ id: 'b', full_name: 'Person B', parent_id: 'a' }),
    ];
    const looped = buildModel(peopleOf(...rows), false);
    expect(looped.people).toHaveLength(2);
    expect(looped.roots.length).toBeGreaterThan(0);
    for (const p of looped.people) expect(Number.isInteger(p.gen)).toBe(true);
  });

  it('treats a missing parent id as a root', () => {
    const orphan = modelOf(rawRow({ id: 'o', full_name: 'Orphan', parent_id: 'ghost' }));
    expect(orphan.roots.map((p) => p.id)).toEqual(['o']);
  });
});

describe('genderClass()', () => {
  it('reads the stored Male/Female labels', () => {
    expect(genderClass({ gender: 'Male' })).toBe('male');
    expect(genderClass({ gender: 'Female' })).toBe('female');
    expect(genderClass({ gender: 'M' })).toBe('male');
    expect(genderClass({ gender: 'f' })).toBe('female');
    expect(genderClass({ gender: null })).toBe('unknown');
    expect(genderClass({ gender: 'other' })).toBe('unknown');
  });
});

describe('isDescendantOf()', () => {
  const model = modelOf(...FIXTURE_ROWS);

  it('walks the parent chain upward', () => {
    expect(isDescendantOf(model.byId.get('child-a')!, 'grandpa')).toBe(true);
    expect(isDescendantOf(model.byId.get('father')!, 'grandpa')).toBe(true);
    expect(isDescendantOf(model.byId.get('uncle')!, 'father')).toBe(false);
    expect(isDescendantOf(model.byId.get('grandpa')!, 'grandpa')).toBe(true);
  });
});
