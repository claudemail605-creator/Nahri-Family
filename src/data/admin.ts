/**
 * Admin read/write layer — the queries and writes behind the admin panel
 * (Phase 5). Same convention as the other data modules: `{ data, error }`
 * becomes a thrown error, and nothing here reports a success it did not
 * receive.
 *
 * Reads mirror the reference app's RLS expectations — the admin panel is only
 * reachable for admins, and every list here is the admin's view of the real
 * table (the people snapshot for the deleted tab comes from the workspace
 * model that fetchAllPeople() already loaded for admins).
 *
 * Service-role writes (invite, resend, set password, activate/deactivate,
 * `list` with last sign-in) go through the `admin-users` Edge Function whose
 * source is vendored in supabase/functions/admin-users/. It is deployed by
 * the owner, never by this repository; invokeAdminUsers() surfaces a
 * function-missing failure as a thrown error instead of a fake success.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProfileRow } from './auth';

/* ----------------------------- shared row shapes --------------------------- */

export interface BranchAccessRow {
  user_id: string;
  person_id: string;
}

export interface DeletionRequestRow {
  id: string;
  person_id: string;
  requested_by: string | null;
  reason: string | null;
  status: string; // pending | approved | rejected
  created_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

/** The audit row as the activity feed needs it (one more column than history). */
export interface ActivityRow {
  id: number | string;
  person_id: string | null;
  action: string; // insert | update | delete | restore | hard_delete
  changed_by: string | null;
  changed_by_name: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_at: string | null;
}

export interface ActivityFilter {
  user: string;
  person: string;
  action: string;
  from: string; // yyyy-mm-dd or ''
  to: string;
}

export const EMPTY_ACTIVITY_FILTER: ActivityFilter = {
  user: '',
  person: '',
  action: '',
  from: '',
  to: '',
};

/* ---------------------------------- reads ---------------------------------- */

/** All profiles, name-ordered (branch progress + activity name resolution). */
export async function fetchProfiles(client: SupabaseClient): Promise<ProfileRow[]> {
  const { data, error } = await client
    .from('profiles')
    .select('id, email, full_name, role, active, language')
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProfileRow[];
}

/** Every branch assignment (the admin view of branch_access). */
export async function fetchBranchAccess(client: SupabaseClient): Promise<BranchAccessRow[]> {
  const { data, error } = await client.from('branch_access').select('user_id, person_id');
  if (error) throw error;
  return (data ?? []) as BranchAccessRow[];
}

/** The columns the recently-deleted tab shows (mirrors the reference). */
export interface RecentlyDeletedRow {
  id: string;
  full_name: string | null;
  gender: string | null;
  parent_id: string | null;
  updated_at: string | null;
  legacy_id: string | null;
}

/** Soft-deleted people, newest deletion first (capped like the reference). */
export async function fetchRecentlyDeleted(client: SupabaseClient): Promise<RecentlyDeletedRow[]> {
  const { data, error } = await client
    .from('people')
    .select('id, full_name, gender, parent_id, updated_at, legacy_id')
    .eq('is_deleted', true)
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as RecentlyDeletedRow[];
}

/** Deletion queue, newest first (mirrors the reference's limit of 200). */
export async function fetchDeletionRequests(
  client: SupabaseClient,
): Promise<DeletionRequestRow[]> {
  const { data, error } = await client
    .from('deletion_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as DeletionRequestRow[];
}

/** The global activity feed: newest 100 rows, optionally filtered. */
export async function fetchActivity(
  client: SupabaseClient,
  filter: ActivityFilter,
): Promise<ActivityRow[]> {
  let query = client
    .from('audit_log')
    .select(
      'id, person_id, action, changed_by, changed_by_name, old_data, new_data, changed_at',
    )
    .order('changed_at', { ascending: false })
    .limit(100);
  if (filter.user) query = query.eq('changed_by', filter.user);
  if (filter.person) query = query.eq('person_id', filter.person);
  if (filter.action) query = query.eq('action', filter.action);
  if (filter.from) query = query.gte('changed_at', `${filter.from}T00:00:00Z`);
  if (filter.to) query = query.lte('changed_at', `${filter.to}T23:59:59Z`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ActivityRow[];
}

/* ---------------------------------- writes --------------------------------- */

/** Approve (the person is soft-deleted first by the caller) or reject. */
export async function resolveDeletionRequest(
  client: SupabaseClient,
  requestId: string,
  status: 'approved' | 'rejected',
  resolvedBy: string | null,
): Promise<void> {
  const { error } = await client
    .from('deletion_requests')
    .update({
      status,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', requestId);
  if (error) throw error;
}

/* ------------------------------- admin-users fn ----------------------------- */

/** Every action the vendored Edge Function understands. */
export type AdminUsersAction =
  | 'list'
  | 'invite'
  | 'update'
  | 'resend'
  | 'set_password'
  | 'disable'
  | 'enable';

/** `action: 'list'` → email, profile, role, active flag and the last sign-in. */
export interface AdminUserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: string | null;
  active: boolean;
  language: string | null;
  last_sign_in_at: string | null;
}

/**
 * Invoke the admin-users Edge Function. The function is vendored (never
 * deployed by this repository), so a deployment with the function missing
 * throws AdminUsersNotDeployedError — callers say so plainly instead of
 * repeating a raw network error, exactly like the reference's `fn()`.
 */
export class AdminUsersNotDeployedError extends Error {
  constructor() {
    super('admin-users function is not deployed');
    this.name = 'AdminUsersNotDeployedError';
  }
}

export async function invokeAdminUsers<T = unknown>(
  client: SupabaseClient,
  action: AdminUsersAction,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await client.functions.invoke<Record<string, unknown>>(
    'admin-users',
    { body: { action, ...payload } },
  );
  if (error) {
    const raw = error instanceof Error && error.message ? error.message : String(error);
    if (/failed to send|not found|404|4040/i.test(raw)) throw new AdminUsersNotDeployedError();
    // A 4xx/5xx function answer carries { error } in the body, surfaced by
    // supabase-js as a FunctionsHttpError whose context holds the JSON.
    let detail = raw;
    try {
      const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
      const body = ctx && typeof ctx.json === 'function' ? ((await ctx.json()) as { error?: unknown }) : null;
      if (body?.error) detail = String(body.error);
    } catch {
      /* keep the original message */
    }
    throw new Error(detail);
  }
  const body = data as T;
  const candidate = body as unknown as Record<string, unknown> | null;
  if (candidate && typeof candidate === 'object' && 'error' in candidate) {
    const message = candidate.error;
    throw new Error(typeof message === 'string' && message ? message : 'admin-users failed');
  }
  return body;
}

/** `action: 'list'` → user id → last sign-in (or null). Missing function → empty map. */
export async function fetchLastSignInTimes(
  client: SupabaseClient,
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  try {
    const data = await invokeAdminUsers<{ users?: AdminUserRow[] }>(client, 'list');
    for (const u of data.users ?? []) map.set(u.id, u.last_sign_in_at ?? null);
  } catch {
    /* the function is not deployed (or failed) — the UI shows "unknown" */
  }
  return map;
}

/* ----------------------------- the Users tab's writes ----------------------- */

/**
 * These mirror the reference's users tab semantics exactly: name / role /
 * active flag and the branch list are written through RLS-permitted REST (an
 * admin is allowed to do that with its own key), while anything that needs the
 * service-role key (inviting, e-mail, passwords, banning) goes through the
 * vendored admin-users function.
 */

/** All columns an admin may patch on another account's profile. */
export interface ProfilePatch {
  full_name?: string;
  role?: 'admin' | 'editor';
  active?: boolean;
}

/** Change an account's name / role / active flag. */
export async function updateProfile(
  client: SupabaseClient,
  userId: string,
  patch: ProfilePatch,
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (patch.full_name !== undefined) body.full_name = patch.full_name;
  if (patch.role !== undefined) body.role = patch.role;
  if (patch.active !== undefined) body.active = patch.active;
  const { error } = await client.from('profiles').update(body).eq('id', userId);
  if (error) throw error;
}

/** Replace an account's branch assignments: delete every row, insert the picked. */
export async function replaceBranchAccess(
  client: SupabaseClient,
  userId: string,
  personIds: string[],
): Promise<void> {
  const del = await client.from('branch_access').delete().eq('user_id', userId);
  if (del.error) throw del.error;
  if (!personIds.length) return;
  const ins = await client
    .from('branch_access')
    .insert(personIds.map((person_id) => ({ user_id: userId, person_id })));
  if (ins.error) throw ins.error;
}

export interface InviteOutcome {
  userId: string;
  /** Only when the account was created WITHOUT an invitation e-mail. */
  temporaryPassword: string | null;
}

/** Create an account through the function (invitation mail or a temp password). */
export async function inviteAccount(
  client: SupabaseClient,
  input: {
    email: string;
    fullName: string;
    role: 'admin' | 'editor';
    branchPersonIds: string[];
    sendEmail: boolean;
  },
): Promise<InviteOutcome> {
  const data = await invokeAdminUsers<{ user_id?: string | null; temporary_password?: string | null }>(
    client,
    'invite',
    {
      email: input.email,
      full_name: input.fullName,
      role: input.role,
      branch_person_ids: input.branchPersonIds,
      send_email: input.sendEmail,
    },
  );
  if (!data.user_id) throw new Error('The account was created but no user id came back.');
  return { userId: data.user_id, temporaryPassword: data.temporary_password ?? null };
}

/** A fresh invitation — or a recovery mail for an account that signed in once. */
export async function resendAccountEmail(
  client: SupabaseClient,
  userId: string,
): Promise<'invite' | 'recovery'> {
  const data = await invokeAdminUsers<{ kind?: string }>(client, 'resend', { user_id: userId });
  return data.kind === 'recovery' ? 'recovery' : 'invite';
}

/** Set a relative's sign-in password (they cannot receive e-mail). */
export async function setAccountPassword(
  client: SupabaseClient,
  userId: string,
  password: string,
): Promise<void> {
  await invokeAdminUsers(client, 'set_password', { user_id: userId, password });
}

/**
 * Activate/deactivate with the reference's graceful degradation: the profile
 * flag itself is writable through RLS, so a missing function still flips the
 * access flag — it just cannot ban/unban the auth user.
 *
 * Parity note: the reference calls `fn('disable', { user_id, active })` for
 * BOTH directions, but the vendored function derives the direction from the
 * action name alone (`case 'disable'` hard-codes active:false), so the
 * reference's own "activate" click actually deactivated the account and then
 * toasted success. This port calls 'enable' instead — the bug is documented,
 * not copied.
 */
export async function setAccountActive(
  client: SupabaseClient,
  userId: string,
  active: boolean,
): Promise<{ banned: boolean }> {
  try {
    const out = await invokeAdminUsers<{ ok?: boolean; warning?: string }>(
      client,
      active ? 'enable' : 'disable',
      { user_id: userId },
    );
    // The function reports a failed ban as { ok, warning } — the flag landed,
    // but the session was not killed: not a full ban.
    return { banned: !out.warning };
  } catch {
    // Without the Edge Function the auth user cannot be banned, but the
    // profile flag already stops the account from using the tree — do that
    // much directly, exactly like the reference (which swallows any function
    // failure for this action).
    await updateProfile(client, userId, { active });
    return { banned: false };
  }
}
