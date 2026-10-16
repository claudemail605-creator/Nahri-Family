import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { PEOPLE_PAGE, fetchAllPeople, type RawPersonRow } from '../../src/data/people';

function person(id: string, overrides: Partial<RawPersonRow> = {}): RawPersonRow {
  return {
    id,
    legacy_id: null,
    parent_id: null,
    gender: null,
    full_name: id,
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
    is_deleted: false,
    created_by: null,
    updated_by: null,
    created_at: null,
    updated_at: null,
    path: null,
    ...overrides,
  };
}

interface Calls {
  table: string | null;
  selects: string[];
  orders: Array<{ column: string; ascending: boolean; nullsFirst: boolean | undefined }>;
  ranges: Array<[number, number]>;
  eqs: Array<{ column: string; value: unknown }>;
}

/**
 * Minimal stand-in for the supabase-js query builder: records the chain calls
 * and serves `rows.slice(from, to + 1)` (inclusive, like PostgREST), with
 * `.eq()` filters applied at await time.
 */
function makeClient(rows: RawPersonRow[], failWith: { message: string } | null = null): {
  client: SupabaseClient;
  calls: Calls;
} {
  const calls: Calls = { table: null, selects: [], orders: [], ranges: [], eqs: [] };

  const builder = {
    select(columns: string) {
      calls.selects.push(columns);
      return builder;
    },
    order(column: string, options: { ascending: boolean; nullsFirst?: boolean }) {
      calls.orders.push({ column, ascending: options.ascending, nullsFirst: options.nullsFirst });
      return builder;
    },
    range(from: number, to: number) {
      calls.ranges.push([from, to]);
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.eqs.push({ column, value });
      return builder;
    },
    then(resolve: (value: { data: unknown; error: unknown }) => void) {
      if (failWith) {
        resolve({ data: null, error: failWith });
        return;
      }
      const [from, to] = calls.ranges[calls.ranges.length - 1] ?? [0, rows.length];
      let filtered = rows;
      for (const { column, value } of calls.eqs) {
        filtered = filtered.filter((row) => (row as unknown as Record<string, unknown>)[column] === value);
      }
      resolve({ data: filtered.slice(from, to + 1), error: null });
    },
  };

  const client = {
    from(table: string) {
      calls.table = table;
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe('fetchAllPeople', () => {
  it('reads the people table with select *', async () => {
    const { client, calls } = makeClient([]);
    await fetchAllPeople(client, { admin: true });
    expect(calls.table).toBe('people');
    expect(calls.selects).toEqual(['*']);
  });

  it('uses a unique ordering: dob first, then id', async () => {
    const { client, calls } = makeClient([]);
    await fetchAllPeople(client, { admin: true });
    expect(calls.orders).toEqual([
      { column: 'dob', ascending: true, nullsFirst: true },
      { column: 'id', ascending: true },
    ]);
  });

  it('defaults to 1000-row pages and stops on the first empty/short page', async () => {
    const { client, calls } = makeClient([person('a')]);
    const rows = await fetchAllPeople(client, { admin: true });
    expect(rows).toHaveLength(1);
    expect(calls.ranges).toEqual([[0, PEOPLE_PAGE - 1]]);
  });

  it('pages through until a short page arrives', async () => {
    const { client, calls } = makeClient([person('a'), person('b'), person('c'), person('d'), person('e')]);
    const rows = await fetchAllPeople(client, { admin: true, pageSize: 2 });
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(calls.ranges).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it('asks one more page after an exact multiple of the page size', async () => {
    const { client, calls } = makeClient([person('a'), person('b')]);
    const rows = await fetchAllPeople(client, { admin: true, pageSize: 2 });
    expect(rows).toHaveLength(2);
    expect(calls.ranges).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('returns an empty list for an empty table in a single call', async () => {
    const { client, calls } = makeClient([]);
    const rows = await fetchAllPeople(client, { admin: true, pageSize: 5 });
    expect(rows).toEqual([]);
    expect(calls.ranges).toEqual([[0, 4]]);
  });

  it('non-admins get the explicit is_deleted = false filter; admins do not', async () => {
    const rows = [person('a'), person('k', { is_deleted: true })];

    const member = makeClient(rows);
    const memberRows = await fetchAllPeople(member.client, { admin: false, pageSize: 10 });
    expect(member.calls.eqs).toEqual([{ column: 'is_deleted', value: false }]);
    expect(memberRows.map((r) => r.id)).toEqual(['a']);

    const admin = makeClient(rows);
    const adminRows = await fetchAllPeople(admin.client, { admin: true, pageSize: 10 });
    expect(admin.calls.eqs).toEqual([]);
    expect(adminRows.map((r) => r.id)).toEqual(['a', 'k']);
  });

  it('throws the server error instead of returning partial data', async () => {
    const { client } = makeClient([person('a')], { message: 'permission denied' });
    await expect(fetchAllPeople(client, { admin: false })).rejects.toEqual({ message: 'permission denied' });
  });
});
