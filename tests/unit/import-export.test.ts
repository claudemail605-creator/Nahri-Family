import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Person } from '../../src/features/tree/model';
import {
  IMPORT_SHEET,
  isoDate,
  looksNumericDate,
  orderParentsFirst,
  parseSheet,
  type TranslateProblem,
} from '../../src/features/admin/importer';
import { EXCEL_SHEET, EXPORT_COLUMNS, buildExportRows } from '../../src/features/admin/excel-export';
import { fetchBackup, fetchLegacyIds, importPeople, type ImportRow } from '../../src/data/admin';

const translate: TranslateProblem = (key, params) => `${key}:${JSON.stringify(params)}`;

function row(overrides: Partial<ImportRow>): ImportRow {
  return {
    legacy: 'L',
    parent: null,
    gender: null,
    full_name: 'Name',
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
    source: null,
    ...overrides,
  };
}

describe('isoDate', () => {
  it('parses day-first and ISO dates', () => {
    expect(isoDate('01/03/1970')).toBe('1970-03-01');
    expect(isoDate('1970-03-01')).toBe('1970-03-01');
    expect(isoDate('1-3-1970')).toBe('1970-03-01');
  });

  it('keeps partial dates as text (null)', () => {
    expect(isoDate('1970')).toBeNull();
    expect(isoDate('1965 (approx)')).toBeNull();
    expect(isoDate('')).toBeNull();
    expect(isoDate(null)).toBeNull();
  });

  it('rejects dates that match the shape but are no dates', () => {
    expect(isoDate('1985-13-45')).toBeNull();
    expect(isoDate('45/45/1985')).toBeNull();
  });
});

describe('looksNumericDate', () => {
  it('matches the shape a problem report is worth', () => {
    expect(looksNumericDate('13/13/1985')).toBe(true);
    expect(looksNumericDate('1985-13-45')).toBe(true);
    expect(looksNumericDate('1970')).toBe(false);
    expect(looksNumericDate('1965 (approx)')).toBe(false);
  });
});

describe('parseSheet', () => {
  it('maps original headers onto people columns (any spacing/case)', () => {
    const parsed = parseSheet(
      [
        {
          Individual_ID: 'F1',
          Parent_ID: null,
          Gender: 'Male',
          'Full Name': 'Ameer',
          Nick_Name: 'Ami',
          Name_Urdu: 'امیر',
          DOB: '01/03/1970',
          Source_File: 'old.xlsx',
        },
      ],
      translate,
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.legacy).toBe('F1');
    expect(parsed.rows[0]!.parent).toBeNull();
    expect(parsed.rows[0]!.gender).toBe('Male');
    expect(parsed.rows[0]!.full_name).toBe('Ameer');
    expect(parsed.rows[0]!.nick_name).toBe('Ami');
    expect(parsed.rows[0]!.name_ur).toBe('امیر');
    expect(parsed.rows[0]!.dob).toBe('1970-03-01');
    expect(parsed.rows[0]!.dob_text).toBe('01/03/1970');
    expect(parsed.rows[0]!.source).toBe('old.xlsx');
  });

  it('keeps partial date text untouched, flags look-alike dates', () => {
    const parsed = parseSheet(
      [
        { Individual_ID: 'A', Full_Name: 'Partial', DOB: '1970' },
        { Individual_ID: 'B', Full_Name: 'Bad', DOB: '13/13/1970' },
      ],
      translate,
    );
    expect(parsed.rows[0]!.dob).toBeNull();
    expect(parsed.rows[0]!.dob_text).toBe('1970');
    expect(parsed.problems).toEqual([
      translate('admin.importBadDate', { id: 'B', value: '13/13/1970' }),
    ]);
  });

  it('flags a dead-before-born person', () => {
    const parsed = parseSheet(
      [{ Individual_ID: 'A', Full_Name: 'X', DOB: '10/01/1980', Date_of_Death: '01/01/1980' }],
      translate,
    );
    expect(parsed.problems).toEqual([translate('admin.importDodBeforeDob', { id: 'A' })]);
  });

  it('nulls a wrong gender and reports it', () => {
    const parsed = parseSheet(
      [{ Individual_ID: 'A', Full_Name: 'X', Gender: 'Unknown' }],
      translate,
    );
    expect(parsed.rows[0]!.gender).toBeNull();
    expect(parsed.problems).toEqual([
      translate('admin.importBadGender', { id: 'A', value: 'Unknown' }),
    ]);
  });

  it('reports rows without an id or a name and drops them', () => {
    const parsed = parseSheet(
      [{ Full_Name: 'No id' }, { Individual_ID: 'A', Gender: 'Male' }, { Individual_ID: 'B', Full_Name: 'Fine' }],
      translate,
    );
    expect(parsed.rows.map((r) => r.legacy)).toEqual(['B']);
    expect(parsed.problems).toEqual([
      translate('admin.importNoName', { id: '#2' }),
      translate('admin.importNoName', { id: 'A' }),
    ]);
  });

  it('reports duplicate legacy ids', () => {
    const parsed = parseSheet(
      [
        { Individual_ID: 'A', Full_Name: 'One' },
        { Individual_ID: 'A', Full_Name: 'Two' },
      ],
      translate,
    );
    expect(parsed.problems).toEqual([translate('admin.importDup', { id: 'A', n: 2 })]);
  });

  it('drops parents that are not in the file (added top level)', () => {
    const parsed = parseSheet(
      [{ Individual_ID: 'A', Parent_ID: 'ZZZ', Full_Name: 'Kid' }],
      translate,
    );
    expect(parsed.rows[0]!.parent).toBeNull();
    expect(parsed.problems).toEqual([
      translate('admin.importBadParent', { id: 'A', parent: 'ZZZ' }),
    ]);
  });

  it('orders parents first so inserts can point at their parent', () => {
    const parsed = parseSheet(
      [
        { Individual_ID: 'kid', Parent_ID: 'pa', Full_Name: 'Kid' },
        { Individual_ID: 'pa', Full_Name: 'Parent' },
        { Individual_ID: 'grand', Parent_ID: 'kid', Full_Name: 'Grand' },
      ],
      translate,
    );
    expect(parsed.rows.map((r) => r.legacy)).toEqual(['pa', 'kid', 'grand']);
  });

  it('cuts cycles instead of looping', () => {
    const parsed = parseSheet(
      [
        { Individual_ID: 'a', Parent_ID: 'b', Full_Name: 'A' },
        { Individual_ID: 'b', Parent_ID: 'a', Full_Name: 'B' },
      ],
      translate,
    );
    // The edge that loops back to a visited row is cut (the reference's rule):
    // the row caught re-entering itself loses its parent, the other row keeps
    // its own — and the resulting order still makes every insert resolvable.
    expect(parsed.rows.map((r) => r.legacy)).toEqual(['b', 'a']);
    expect(parsed.rows[0]!.parent).toBe('a');
    expect(parsed.rows[1]!.parent).toBeNull();
  });

  it('expects the original sheet name constant', () => {
    expect(IMPORT_SHEET).toBe('Family_Data');
  });
});

describe('orderParentsFirst', () => {
  it('is stable for rows without parents', () => {
    const rows = [row({ legacy: 'a' }), row({ legacy: 'b' })];
    expect(orderParentsFirst(rows).map((r) => r.legacy)).toEqual(['a', 'b']);
  });
});

describe('buildExportRows', () => {
  it('writes the original 16 columns, gen/name sorted', () => {
    const person = (id: string, gen: number, name: string, extra: Partial<Person> = {}): Person =>
      ({
        id,
        legacy_id: `F-${id}`,
        parentId: null,
        parent: null,
        gen,
        gender: null,
        name,
        nick: null,
        father: null,
        mother: null,
        spouse: null,
        spouseFather: null,
        dob: null,
        dob_iso: null,
        dob_text: null,
        dob_display: null,
        pob: null,
        qual: null,
        dod: null,
        dod_iso: null,
        dod_text: null,
        dod_display: null,
        burial: null,
        name_ur: null,
        name_hi: null,
        notes: null,
        photo_path: null,
        source: null,
        is_deleted: false,
        created_by: null,
        updated_by: null,
        created: null,
        ...extra,
      }) as Person;

    const child = person('b', 1, 'Zubair', { parentId: 'a', parent: person('a', 0, 'Ameer') });
    const rows = buildExportRows([child, person('a', 0, 'Ameer')]);
    expect(EXPORT_COLUMNS).toHaveLength(16);
    expect(EXPORT_COLUMNS.map((c) => c.header)[0]).toBe('Individual_ID');
    expect(rows.map((r) => r.Individual_ID)).toEqual(['F-a', 'F-b']);
    expect(rows[1]!.Parent_ID).toBe('F-a');
    expect(rows[0]!.Generation).toBe(0);
    expect(EXCEL_SHEET).toBe('Family_Data');
  });
});

/* ----------------------------- data-layer fakes ----------------------------- */

interface Write {
  table: string;
  op: 'insert' | 'update';
  values: Record<string, unknown>;
  eq?: { column: string; value: unknown } | undefined;
  select?: string | undefined;
}

interface FakeSpec {
  people: Array<Record<string, unknown>>;
  profiles?: unknown[];
  branchAccess?: unknown[];
  requests?: unknown[];
  audit?: unknown[];
  failTable?: string;
}

interface FakeState {
  writes: Write[];
}

function makeMultiClient(spec: FakeSpec): { client: SupabaseClient; state: FakeState } {
  const writes: Write[] = [];
  const tables: Record<string, unknown[]> = {
    people: spec.people,
    profiles: spec.profiles ?? [],
    branch_access: spec.branchAccess ?? [],
    deletion_requests: spec.requests ?? [],
    audit_log: spec.audit ?? [],
  };

  const client = {
    from(table: string) {
      // One independent builder per from() call — Promise.all chains must
      // never share query state.
      const q = {
        op: 'select' as 'select' | 'insert' | 'update',
        values: {} as Record<string, unknown>,
        eq: [] as Array<{ column: string; value: unknown }>,
        select: '',
        nots: [] as Array<{ column: string; op: string; value: unknown }>,
        orders: [] as Array<{ column: string; ascending: boolean }>,
      };
      const builder = {
        select(columns: string) {
          q.select = columns;
          return builder;
        },
        order(column: string, options: { ascending?: boolean }) {
          q.orders.push({ column, ascending: options.ascending !== false });
          return builder;
        },
        limit() {
          return builder;
        },
        not(column: string, op: string, value: unknown) {
          q.nots.push({ column, op, value });
          return builder;
        },
        eq(column: string, value: unknown) {
          q.eq.push({ column, value });
          return builder;
        },
        insert(values: Record<string, unknown> | Array<Record<string, unknown>>) {
          q.op = 'insert';
          q.values = Array.isArray(values) ? (values[0] ?? {}) : values;
          return builder;
        },
        update(values: Record<string, unknown>) {
          q.op = 'update';
          q.values = values;
          return builder;
        },
        single() {
          return {
            then: (resolve: (r: { data: unknown; error: unknown }) => void) => {
              if (q.op === 'insert') {
                writes.push({ table, op: 'insert', values: q.values, select: q.select });
                resolve({ data: { id: 'new-uuid-1', ...q.values }, error: null });
              } else {
                resolve({ data: null, error: null });
              }
            },
          };
        },
        then(resolve: (r: { data: unknown; error: unknown }) => void) {
          if (spec.failTable === table) {
            resolve({ data: null, error: { message: 'mock failure' } });
            return;
          }
          let rows = tables[table] ?? [];
          if (q.op === 'insert') {
            writes.push({ table, op: 'insert', values: q.values, select: q.select });
            resolve({ data: null, error: null });
            return;
          }
          if (q.op === 'update') {
            writes.push({ table, op: 'update', values: q.values, eq: q.eq[0] });
            resolve({ data: null, error: null });
            return;
          }
          for (const note of q.nots) {
            if (note.op === 'is' && note.value === null) {
              rows = rows.filter(
                (row) => ((row ?? {}) as Record<string, unknown>)[String(note.column)] !== null,
              );
            }
          }
          resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, state: { writes } };
}

describe('importPeople', () => {
  it('inserts parents first, then children pointing at their new uuid', async () => {
    const { client, state } = makeMultiClient({ people: [] });
    const progress: Array<[number, number]> = [];
    const outcome = await importPeople(
      client,
      [
        row({ legacy: 'pa', full_name: 'Parent' }),
        row({ legacy: 'kid', parent: 'pa', full_name: 'Kid' }),
      ],
      false,
      (done, total) => progress.push([done, total]),
    );
    expect(outcome).toEqual({ added: 2, updated: 0 });
    expect(progress).toEqual([[1, 2], [2, 2]]);
    expect(state.writes.map((w) => (w.values as { full_name?: string }).full_name)).toEqual([
      'Parent',
      'Kid',
    ]);
    const childWrite = state.writes[1]!;
    expect((childWrite.values as { parent_id?: string }).parent_id).toBe('new-uuid-1');
    expect((childWrite.values as { legacy_id?: string }).legacy_id).toBe('kid');
  });

  it('skips existing legacy ids unless the update box is ticked', async () => {
    const { client, state } = makeMultiClient({ people: [{ id: 'u1', legacy_id: 'pa' }] });
    const skipped = await importPeople(client, [row({ legacy: 'pa' })], false, () => {});
    expect(skipped).toEqual({ added: 0, updated: 0 });
    expect(state.writes).toHaveLength(0);

    const updated = await importPeople(client, [row({ legacy: 'pa', full_name: 'New' })], true, () => {});
    expect(updated).toEqual({ added: 0, updated: 1 });
    expect(state.writes[0]!.op).toBe('update');
    expect(state.writes[0]!.eq).toEqual({ column: 'id', value: 'u1' });
    expect((state.writes[0]!.values as { full_name?: string }).full_name).toBe('New');
  });
});

describe('fetchLegacyIds', () => {
  it('maps only non-null legacy ids', async () => {
    const { client } = makeMultiClient({
      people: [
        { id: 'u1', legacy_id: 'F1' },
        { id: 'u2', legacy_id: null },
      ],
    });
    const map = await fetchLegacyIds(client);
    expect(map.get('F1')).toBe('u1');
    expect(map.size).toBe(1);
  });
});

describe('fetchBackup', () => {
  it('reads all five tables and stamps the payload', async () => {
    const { client } = makeMultiClient({
      people: [{ id: 'p1' }],
      profiles: [{ id: 'u1' }],
      branchAccess: [{ user_id: 'u1', person_id: 'p1' }],
      requests: [{ id: 'r1' }],
      audit: [{ id: 'a1' }],
    });
    const payload = await fetchBackup(client);
    expect(payload.app).toBe('Nahri-Family');
    expect(payload.people).toEqual([{ id: 'p1' }]);
    expect(payload.profiles).toEqual([{ id: 'u1' }]);
    expect(payload.branch_access).toEqual([{ user_id: 'u1', person_id: 'p1' }]);
    expect(payload.deletion_requests).toEqual([{ id: 'r1' }]);
    expect(payload.audit_log).toEqual([{ id: 'a1' }]);
    expect(typeof payload.exported_at).toBe('string');
  });

  it('fails when any table read fails — no fake success', async () => {
    const { client } = makeMultiClient({ people: [], failTable: 'audit_log' });
    await expect(fetchBackup(client)).rejects.toEqual({ message: 'mock failure' });
  });
});
