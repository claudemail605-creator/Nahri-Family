import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Read access for the `people` table.
 *
 * Supabase caps a single response at 1000 rows, so the read pages through.
 * The sort order must be unique (dob, then id) or rows can repeat or vanish
 * between pages — same rule as the reference `fetchAllPeople()`.
 *
 * RLS already hides soft-deleted rows from non-admins; the explicit
 * `is_deleted = false` filter is said again here so the client stays correct
 * even if that policy is ever relaxed.
 */

export const PEOPLE_PAGE = 1000;

/** Raw `people` row as stored (snake_case; only the columns the app reads). */
export interface RawPersonRow {
  id: string | null;
  legacy_id: string | null;
  parent_id: string | null;
  gender: string | null;
  full_name: string | null;
  nick_name: string | null;
  fathers_name: string | null;
  mothers_name: string | null;
  spouse_name: string | null;
  spouse_father_name: string | null;
  dob: string | null;
  dob_text: string | null;
  place_of_birth: string | null;
  qualification: string | null;
  dod: string | null;
  dod_text: string | null;
  place_of_burial: string | null;
  name_ur: string | null;
  name_hi: string | null;
  notes: string | null;
  photo_path: string | null;
  source: string | null;
  is_deleted: boolean | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** uuid[] maintained by a DB trigger; used by the edit-permission check. */
  path: string[] | null;
}

export interface FetchPeopleOptions {
  /** Admins also receive soft-deleted rows; everyone else never does. */
  admin: boolean;
  pageSize?: number;
}

export async function fetchAllPeople(
  client: SupabaseClient,
  options: FetchPeopleOptions,
): Promise<RawPersonRow[]> {
  const pageSize = options.pageSize ?? PEOPLE_PAGE;
  const out: RawPersonRow[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = client
      .from('people')
      .select('*')
      .order('dob', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (!options.admin) query = query.eq('is_deleted', false);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || !data.length) break;
    out.push(...(data as RawPersonRow[]));
    if (data.length < pageSize) break;
  }
  return out;
}
