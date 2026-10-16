import { buildModel, toPerson, type Person, type TreeModel } from '../../src/features/tree/model';
import type { RawPersonRow } from '../../src/data/people';

/** Row factory: overrides fill the rest with nulls so tests stay readable. */
export function rawRow(over: Partial<RawPersonRow> & { id: string; full_name: string }): RawPersonRow {
  return {
    legacy_id: null,
    parent_id: null,
    gender: null,
    nick_name: null,
    fathers_name: null,
    mothers_name: null,
    spouse_name: null,
    spouse_father_name: null,
    dob: null,
    dob_text: null,
    place_of_birth: null,
    qualification: null,
    dod: null,
    dod_text: null,
    place_of_burial: null,
    name_ur: null,
    name_hi: null,
    notes: null,
    photo_path: null,
    source: null,
    is_deleted: null,
    created_by: null,
    updated_by: null,
    created_at: null,
    updated_at: null,
    path: null,
    ...over,
  };
}

export function peopleOf(...rows: RawPersonRow[]): Person[] {
  return rows.map((r) => toPerson(r)).filter((p): p is Person => p !== null);
}

export function modelOf(...rows: RawPersonRow[]): TreeModel {
  return buildModel(peopleOf(...rows), false);
}

/**
 * A small fictional family used by the model/filter/layout tests:
 *
 *   grandpa ── (spouse "Grandma")
 *     ├─ father ── (spouse "Mother")
 *     │    ├─ child-a
 *     │    └─ child-b
 *     └─ uncle
 */
export const FIXTURE_ROWS: RawPersonRow[] = [
  rawRow({
    id: 'grandpa',
    full_name: 'Syed Karam Nahri',
    gender: 'Male',
    spouse_name: 'Grandma Nahri',
    dob: '1900-01-01',
    name_ur: 'کرام نہری',
    name_hi: 'कराम नहरी',
    place_of_birth: 'Lahore',
    qualification: 'B.A.',
  }),
  rawRow({
    id: 'father',
    full_name: 'Father Nahri',
    gender: 'Male',
    parent_id: 'grandpa',
    spouse_name: 'Mother Nahri',
    dob: '1930-05-10',
    dod: '2005-01-02',
  }),
  rawRow({
    id: 'uncle',
    full_name: 'Uncle Nahri',
    gender: 'Male',
    parent_id: 'grandpa',
    dob: '1935-07-20',
  }),
  rawRow({ id: 'child-a', full_name: 'Child A', gender: 'Female', parent_id: 'father', dob: '1960-03-03' }),
  rawRow({ id: 'child-b', full_name: 'Child B', gender: 'Male', parent_id: 'father', dob: '1962-09-09' }),
];
