import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  diffPayload,
  fetchAuditLog,
  insertPerson,
  requestDeletion,
  setPersonDeleted,
  updatePerson,
} from '../../src/data/people';
import {
  fieldDiffs,
  findDuplicate,
  restorePayloadFromAudit,
  validateAndBuild,
  valuesForNewChild,
  valuesFromPerson,
  type FormValues,
} from '../../src/features/tree/fields';
import { peopleOf, rawRow } from './tree-fixture';

/* ------------------------------ form values ------------------------------ */

/** Every column as the form holds it; overrides set the interesting ones. */
function formValues(over: Partial<FormValues> = {}): FormValues {
  return {
    full_name: '',
    nick_name: '',
    name_ur: '',
    name_hi: '',
    gender: '',
    fathers_name: '',
    mothers_name: '',
    spouse_name: '',
    spouse_father_name: '',
    dob: '',
    dob_text: '',
    place_of_birth: '',
    qualification: '',
    dod: '',
    dod_text: '',
    place_of_burial: '',
    notes: '',
    ...over,
  };
}

const NOW = new Date(2026, 5, 15, 12, 0, 0); // local noon → UTC date is stable

describe('validateAndBuild', () => {
  it('requires a name and a gender, in form order', () => {
    const result = validateAndBuild(formValues(), NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.issues.full_name).toEqual({ key: 'edit.fullNameRequired' });
    expect(result.issues.gender).toEqual({ key: 'edit.genderRequired' });
    expect(result.firstBad).toBe('full_name');
  });

  it('rejects an unparseable date and a future date', () => {
    const bad = validateAndBuild(
      formValues({ full_name: 'X', gender: 'Male', dob: 'not a date' }),
      NOW,
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('unreachable');
    expect(bad.issues.dob).toEqual({ key: 'edit.invalidDate', vars: { field: 'edit.dob' } });

    const future = validateAndBuild(
      formValues({ full_name: 'X', gender: 'Female', dob: '2026-06-16' }),
      NOW,
    );
    expect(future.ok).toBe(false);
    if (future.ok) throw new Error('unreachable');
    expect(future.issues.dob).toEqual({ key: 'edit.dobFuture' });
  });

  it('rejects a death date before the birth date', () => {
    const result = validateAndBuild(
      formValues({ full_name: 'X', gender: 'Male', dob: '1980-01-01', dod: '1979-12-31' }),
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.issues.dod).toEqual({ key: 'edit.dodBeforeDob' });
  });

  it('builds the payload: blanks become null, dates are sliced, gender passes through', () => {
    const result = validateAndBuild(
      formValues({
        full_name: '  Bahadur Fixture  ',
        gender: 'Male',
        dob: '1920-03-12',
        nick_name: '   ',
        notes: 'hello',
      }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.payload.full_name).toBe('  Bahadur Fixture  ');
    expect(result.payload.nick_name).toBeNull();
    expect(result.payload.dob).toBe('1920-03-12');
    expect(result.payload.gender).toBe('Male');
    expect(result.payload.notes).toBe('hello');
    expect(result.payload.dod).toBeNull();
  });

  it('accepts a DD/MM/YYYY birth date and stores it as YYYY-MM-DD', () => {
    const result = validateAndBuild(
      formValues({ full_name: 'X', gender: 'Female', dob: '12/03/1920' }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.payload.dob).toBe('1920-03-12');
  });
});

describe('valuesFromPerson', () => {
  it('maps the model back onto the form, dates as YYYY-MM-DD', () => {
    const [person] = peopleOf(
      rawRow({
        id: 'x',
        full_name: 'X',
        gender: 'Male',
        dob: '1890-05-01',
        name_ur: 'عامر',
        name_hi: 'आमिर',
        place_of_birth: 'Lahore',
        spouse_name: 'Y',
      }),
    );
    const values = valuesFromPerson(person!);
    expect(values.full_name).toBe('X');
    expect(values.gender).toBe('Male');
    expect(values.dob).toBe('1890-05-01');
    expect(values.name_ur).toBe('عامر');
    expect(values.name_hi).toBe('आमिर');
    expect(values.place_of_birth).toBe('Lahore');
    expect(values.spouse_name).toBe('Y');
  });

  it('clears anything that is not exactly Male or Female and blanks a null person', () => {
    const [person] = peopleOf(rawRow({ id: 'x', full_name: 'X', gender: 'm' }));
    expect(valuesFromPerson(person!).gender).toBe('');
    expect(valuesFromPerson(null).full_name).toBe('');
  });
});

describe('valuesForNewChild', () => {
  it('fills the father box from a male parent and the mother box from a female one', () => {
    const [dad] = peopleOf(rawRow({ id: 'd', full_name: 'Dad', gender: 'Male', spouse_name: 'Mum' }));
    const [mum] = peopleOf(rawRow({ id: 'm', full_name: 'Mum', gender: 'Female', spouse_name: 'Dad' }));
    expect(valuesForNewChild(dad!).fathers_name).toBe('Dad');
    expect(valuesForNewChild(dad!).mothers_name).toBe('Mum');
    expect(valuesForNewChild(mum!).mothers_name).toBe('Mum');
    expect(valuesForNewChild(mum!).fathers_name).toBe('Dad');
  });

  it('guesses with the unknown-gender rule: the name without a spouse, never both', () => {
    const [solo] = peopleOf(rawRow({ id: 's', full_name: 'Solo', spouse_name: null }));
    const [pair] = peopleOf(rawRow({ id: 'p', full_name: 'Pair', spouse_name: 'Other' }));
    expect(valuesForNewChild(solo!).fathers_name).toBe('Solo');
    expect(valuesForNewChild(solo!).mothers_name).toBe('');
    expect(valuesForNewChild(pair!).fathers_name).toBe('');
    expect(valuesForNewChild(pair!).mothers_name).toBe('Other');
  });
});

describe('findDuplicate', () => {
  const people = peopleOf(
    rawRow({ id: 'a', full_name: 'Amir Fixture' }),
    rawRow({ id: 'b', full_name: 'Amir Fixture', parent_id: 'p1' }),
    rawRow({ id: 'c', full_name: 'Other', parent_id: 'p2' }),
  );

  it('matches case-insensitively under the same parent only', () => {
    expect(findDuplicate(people, '  amir FIXTURE ', null, null)?.id).toBe('a');
    expect(findDuplicate(people, 'Amir Fixture', 'p1', null)?.id).toBe('b');
    expect(findDuplicate(people, 'Amir Fixture', 'p2', null)).toBeNull();
  });

  it('never flags the person being edited and ignores blank names', () => {
    expect(findDuplicate(people, 'Amir Fixture', null, 'a')).toBeNull();
    expect(findDuplicate(people, '   ', null, null)).toBeNull();
  });
});

describe('fieldDiffs', () => {
  it('lists only labeled columns that differ between the snapshots', () => {
    const changes = fieldDiffs(
      { full_name: 'Amir Fitri', qualification: 'Hafiz', notes: null },
      { full_name: 'Amir Fixture', qualification: 'Hafiz', notes: 'x' },
    );
    expect(changes.map((c) => c.col)).toEqual(['full_name', 'notes']);
    expect(changes[0]).toEqual({ col: 'full_name', labelKey: 'edit.fullName', before: 'Amir Fitri', after: 'Amir Fixture' });
    expect(changes[1]!.before).toBe('');
    expect(changes[1]!.after).toBe('x');
  });

  it('does list a changed parent (admin moves are part of the history)', () => {
    const changes = fieldDiffs({ parent_id: 'p1' }, { parent_id: 'p2' });
    expect(changes).toEqual([
      { col: 'parent_id', labelKey: 'edit.parentField', before: 'p1', after: 'p2' },
    ]);
  });

  it('treats null snapshots as empty and skips columns in neither', () => {
    expect(fieldDiffs(null, null)).toEqual([]);
    expect(fieldDiffs(null, { full_name: 'X' })).toHaveLength(1);
  });
});

describe('restorePayloadFromAudit', () => {
  const snapshot = {
    full_name: 'Amir Fitri',
    qualification: null,
    dob: '1890-05-01T00:00:00+00:00',
    parent_id: 'person-x',
    is_deleted: true,
    photo_path: 'person-a/old.png',
    source: 'x.xlsx',
  };

  it('restores only the form-ownable columns, dates sliced', () => {
    const payload = restorePayloadFromAudit(snapshot, false);
    expect(payload).toEqual({
      full_name: 'Amir Fitri',
      qualification: null,
      dob: '1890-05-01',
    });
    expect('parent_id' in payload).toBe(false);
    expect('is_deleted' in payload).toBe(false);
    expect('photo_path' in payload).toBe(false);
    expect('source' in payload).toBe(false);
  });

  it('an admin also restores the tree parent', () => {
    const payload = restorePayloadFromAudit(snapshot, true);
    expect(payload.parent_id).toBe('person-x');
  });

  it('skips a null parent for admins (a move back to the root)', () => {
    const payload = restorePayloadFromAudit({ parent_id: null }, true);
    expect(payload).toEqual({ parent_id: null });
  });
});

/* ------------------------------ data writes ------------------------------ */

interface WriteCalls {
  tables: string[];
  inserts: Array<Record<string, unknown>>;
  updates: Array<Record<string, unknown>>;
  selects: string[];
  eqs: Array<[string, unknown]>;
  orders: Array<[string, boolean]>;
  limits: number[];
}

/** Query-builder stand-in: records the chain, resolves one canned answer. */
function makeWriteClient(answer: { data?: unknown; error?: { message: string } | null } = {}): {
  client: SupabaseClient;
  calls: WriteCalls;
} {
  const calls: WriteCalls = {
    tables: [],
    inserts: [],
    updates: [],
    selects: [],
    eqs: [],
    orders: [],
    limits: [],
  };
  const settled = { data: answer.data ?? null, error: answer.error ?? null };

  const builder = {
    insert(values: Record<string, unknown>) {
      calls.inserts.push(values);
      return builder;
    },
    update(values: Record<string, unknown>) {
      calls.updates.push(values);
      return builder;
    },
    select(columns: string) {
      calls.selects.push(columns);
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.eqs.push([column, value]);
      return builder;
    },
    order(column: string, options: { ascending: boolean }) {
      calls.orders.push([column, options.ascending]);
      return builder;
    },
    limit(count: number) {
      calls.limits.push(count);
      return builder;
    },
    single() {
      return Promise.resolve(settled);
    },
    then(resolve: (value: unknown) => void) {
      resolve(settled);
    },
  };

  const client = {
    from(table: string) {
      calls.tables.push(table);
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe('insertPerson', () => {
  it('inserts the whitelist plus parent_id and returns the created row', async () => {
    const row = { id: 'new', full_name: 'X' };
    const { client, calls } = makeWriteClient({ data: row });
    const created = await insertPerson(client, { full_name: 'X', gender: 'Male' }, 'parent-1');
    expect(calls.tables).toEqual(['people']);
    expect(calls.inserts).toEqual([{ full_name: 'X', gender: 'Male', parent_id: 'parent-1' }]);
    expect(calls.selects).toEqual(['*']);
    expect(created).toEqual(row);
  });

  it('throws the server error', async () => {
    const { client } = makeWriteClient({ error: { message: 'denied' } });
    await expect(insertPerson(client, { full_name: 'X' }, null)).rejects.toEqual({ message: 'denied' });
  });
});

describe('updatePerson', () => {
  it('sends the patch targeted at one id', async () => {
    const { client, calls } = makeWriteClient();
    await updatePerson(client, 'p1', { notes: 'hello' });
    expect(calls.updates).toEqual([{ notes: 'hello' }]);
    expect(calls.eqs).toEqual([['id', 'p1']]);
  });

  it('never sends an empty patch', async () => {
    const { client, calls } = makeWriteClient();
    await updatePerson(client, 'p1', {});
    expect(calls.tables).toEqual([]);
    expect(calls.updates).toEqual([]);
  });

  it('throws the server error', async () => {
    const { client } = makeWriteClient({ error: { message: 'nope' } });
    await expect(updatePerson(client, 'p1', { notes: 'x' })).rejects.toEqual({ message: 'nope' });
  });
});

describe('setPersonDeleted', () => {
  it('updates only the is_deleted flag', async () => {
    const { client, calls } = makeWriteClient();
    await setPersonDeleted(client, 'p1', true);
    expect(calls.tables).toEqual(['people']);
    expect(calls.updates).toEqual([{ is_deleted: true }]);
    expect(calls.eqs).toEqual([['id', 'p1']]);
  });
});

describe('requestDeletion', () => {
  it('inserts a deletion request with the reason', async () => {
    const { client, calls } = makeWriteClient();
    await requestDeletion(client, 'p1', 'Duplicate');
    expect(calls.tables).toEqual(['deletion_requests']);
    expect(calls.inserts).toEqual([{ person_id: 'p1', reason: 'Duplicate' }]);
  });
});

describe('fetchAuditLog', () => {
  it('reads one person newest-first with the history columns', async () => {
    const rows = [{ id: 3, action: 'update' }];
    const { client, calls } = makeWriteClient({ data: rows });
    const result = await fetchAuditLog(client, 'p1');
    expect(calls.tables).toEqual(['audit_log']);
    expect(calls.selects).toEqual(['id, action, changed_by, changed_by_name, old_data, new_data, changed_at']);
    expect(calls.eqs).toEqual([['person_id', 'p1']]);
    expect(calls.orders).toEqual([['changed_at', false]]);
    expect(calls.limits).toEqual([200]);
    expect(result).toEqual(rows);
  });
});

describe('diffPayload', () => {
  it('only includes columns that actually differ', () => {
    const patch = diffPayload(
      { full_name: 'A', notes: null, qualification: 'X' },
      { full_name: 'B', notes: null, qualification: 'X' },
    );
    expect(patch).toEqual({ full_name: 'B' });
  });

  it('ignores columns the next payload does not carry', () => {
    expect(diffPayload({ full_name: 'A', notes: 'x' }, {})).toEqual({});
  });

  it('clears a value with null and treats null and empty as equal', () => {
    expect(diffPayload({ notes: 'x' }, { notes: null })).toEqual({ notes: null });
    expect(diffPayload({ notes: '' }, { notes: null })).toEqual({});
  });
});
