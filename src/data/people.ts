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

/* ------------------------------ write contract ----------------------------- */

/**
 * Every column the person form may write — the whitelist. `path`,
 * `created_by`, `updated_by`, `legacy_id`, `source` and the timestamps are
 * never sent from the browser: the database's triggers own them (an editor's
 * write is forced back to the old values anyway). Same list as the reference
 * `ALL_FIELDS`, one source of truth for the form, the history diffs and the
 * "restore this version" payload.
 */
export const EDITABLE_COLUMNS = [
  'full_name',
  'nick_name',
  'name_ur',
  'name_hi',
  'gender',
  'fathers_name',
  'mothers_name',
  'spouse_name',
  'spouse_father_name',
  'dob',
  'dob_text',
  'place_of_birth',
  'qualification',
  'dod',
  'dod_text',
  'place_of_burial',
  'notes',
] as const;

export type EditableColumn = (typeof EDITABLE_COLUMNS)[number];

/** Column → value as the form holds it; null means "clear this field". */
export type PersonValues = Partial<Record<EditableColumn, string | null>>;

/** Writes outside the form's whitelist: the photo flow and (admin) moves. */
export interface PersonPatch extends PersonValues {
  parent_id?: string | null;
  photo_path?: string | null;
}

/**
 * Only the keys that actually differ between two payloads — null and blank
 * compare equal, everything else compares as text (same rule as the
 * reference's changed-fields diff).
 */
export function diffPayload(original: PersonValues, next: PersonValues): PersonValues {
  const out: PersonValues = {};
  for (const col of EDITABLE_COLUMNS) {
    if (!(col in next)) continue;
    const before = original[col] == null ? '' : String(original[col]);
    const after = next[col] == null ? '' : String(next[col]);
    if (before !== after) out[col] = next[col] ?? null;
  }
  return out;
}

/** INSERT a new person. `parent_id` only plus the whitelisted columns. */
export async function insertPerson(
  client: SupabaseClient,
  values: PersonValues,
  parentId: string | null,
): Promise<RawPersonRow> {
  const { data, error } = await client
    .from('people')
    .insert({ ...values, parent_id: parentId })
    .select('*')
    .single();
  if (error) throw error;
  return data as RawPersonRow;
}

/** UPDATE with a caller-built patch; an empty patch is a no-op. */
export async function updatePerson(
  client: SupabaseClient,
  id: string,
  patch: PersonPatch,
): Promise<void> {
  if (!Object.keys(patch).length) return;
  const { error } = await client.from('people').update(patch).eq('id', id);
  if (error) throw error;
}

/** Admin-only soft delete / restore (RLS + the guard trigger enforce it). */
export async function setPersonDeleted(
  client: SupabaseClient,
  id: string,
  deleted: boolean,
): Promise<void> {
  const { error } = await client.from('people').update({ is_deleted: deleted }).eq('id', id);
  if (error) throw error;
}

/** An editor's request for an admin to delete a person. */
export async function requestDeletion(
  client: SupabaseClient,
  personId: string,
  reason: string,
): Promise<void> {
  const { error } = await client.from('deletion_requests').insert({ person_id: personId, reason });
  if (error) throw error;
}

/* --------------------------------- audit ---------------------------------- */

/** One `audit_log` row as the history panel needs it. */
export interface AuditRow {
  id: number | string;
  action: string; // insert | update | delete | restore | hard_delete
  changed_by: string | null;
  changed_by_name: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_at: string | null;
}

/** Newest-first change history for one person (RLS limits who may read it). */
export async function fetchAuditLog(
  client: SupabaseClient,
  personId: string,
  limit = 200,
): Promise<AuditRow[]> {
  const { data, error } = await client
    .from('audit_log')
    .select('id, action, changed_by, changed_by_name, old_data, new_data, changed_at')
    .eq('person_id', personId)
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AuditRow[];
}
