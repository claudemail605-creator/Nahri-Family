import { describe, expect, it } from 'vitest';
import { branchPeopleOf, completeness } from '../../src/features/tree/branch';
import { FIXTURE_ROWS, modelOf, peopleOf, rawRow } from './tree-fixture';

describe('completeness', () => {
  it('is complete only when every tracked field is really saved', () => {
    const [person] = peopleOf(
      rawRow({
        id: 'full',
        full_name: 'Full Fixture',
        nick_name: 'Nick',
        gender: 'Male',
        dob: '1900-01-01',
        place_of_birth: 'Lahore',
        fathers_name: 'Father',
        spouse_name: 'Spouse',
        qualification: 'B.A.',
        photo_path: 'full/1.png',
      }),
    );
    const [kid] = peopleOf(rawRow({ id: 'kid', full_name: 'Kid Fixture' }));
    const comp = completeness(person!, [kid!]);
    expect(comp.missing).toEqual([]);
    expect(comp.pct).toBe(100);
  });

  it('lists every missing item in the fixed order and rounds the percent', () => {
    const [person] = peopleOf(rawRow({ id: 'sparse', full_name: 'Sparse Fixture', gender: 'Male' }));
    const comp = completeness(person!, []);
    expect(comp.missing).toEqual(['nick', 'dob', 'pob', 'parents', 'spouse', 'children', 'qual', 'photo']);
    expect(comp.pct).toBe(11);
  });

  it('counts dob_text as a birth date and parent_id as parents', () => {
    const [person] = peopleOf(
      rawRow({ id: 'p', full_name: 'Text Fixture', dob_text: 'year unknown', parent_id: 'parent' }),
    );
    const comp = completeness(person!, []);
    expect(comp.missing).not.toContain('dob');
    expect(comp.missing).not.toContain('parents');
  });
});

describe('branchPeopleOf', () => {
  const model = modelOf(...FIXTURE_ROWS);

  it('returns the anchor and every descendant, depth-first', () => {
    expect(branchPeopleOf(model, 'grandpa').map((p) => p.id)).toEqual([
      'grandpa',
      'father',
      'child-a',
      'child-b',
      'uncle',
    ]);
    expect(branchPeopleOf(model, 'father').map((p) => p.id)).toEqual(['father', 'child-a', 'child-b']);
  });

  it('is empty for an id that is not in the model', () => {
    expect(branchPeopleOf(model, 'ghost')).toEqual([]);
  });
});
