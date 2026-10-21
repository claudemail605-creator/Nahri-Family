/* =====================================================================
   admin-users — the only place that may touch accounts.

   Everything that needs the service-role key (creating a user, sending an
   invitation, resetting a password, banning) happens here, on the server, so
   the key never reaches the browser. The website calls this with
   supabase.functions.invoke('admin-users', { body: { action: ... } }).

   The caller is identified from their own JWT and must be an ACTIVE ADMIN,
   checked against the database — being signed in is not enough.

   Actions (POST, JSON body):
     { action: 'list' }                                   -> users + last sign-in + invite hints
     { action: 'invite', email, full_name, role, branch_person_ids[], send_email }
     { action: 'update', user_id, full_name?, role?, branch_person_ids? }
     { action: 'resend', user_id }
     { action: 'set_password', user_id, password }
     { action: 'disable'|'enable', user_id, active? }
     { action: 'remove', user_id }                        -> cancel a PENDING invitation:
                                                             deletes an auth account that has
                                                             NEVER signed in. Sign-in-experienced
                                                             accounts are always refused.

   Secrets used (Supabase injects the two SUPABASE_* ones automatically):
     SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
     SITE_URL   the website's address, used for invitation / reset links
   ===================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// SITE_URL points the invitation / reset links at the website. It is normally a
// function secret (supabase secrets set SITE_URL=...), but the production URL is
// public information, so it is also the hard-coded default below. Setting the
// secret still overrides it — choose the secret when the site moves elsewhere.
const SITE_URL_FALLBACK = 'https://family-tree-eight-beige.vercel.app';
const SITE_URL = ((Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '')) || SITE_URL_FALLBACK;

// The service client is created lazily and never logged or returned.
// (Typed loosely on purpose: the client's generics are not worth threading
// through every helper, and this file is bundled, not shipped to a browser.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let serviceClient: any = null;
// deno-lint-ignore no-explicit-any
function service(): any {
  if (!serviceClient) {
    if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Server is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
    serviceClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return serviceClient;
}

function allowedOrigins(req: Request): string[] {
  const list = [];
  if (SITE_URL) list.push(SITE_URL);
  const origin = req.headers.get('origin') || '';
  // Local development: the app usually runs on 127.0.0.1 or localhost.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) list.push(origin);
  return list;
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allowed = allowedOrigins(req);
  const allow = allowed.includes(origin) ? origin : (SITE_URL || allowed[0] || '*');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function json(body: unknown, status: number, req: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
  });
}

function fail(message: string, status: number, req: Request) {
  return json({ error: message }, status, req);
}

/* ------------------------------ validation ------------------------------ */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['admin', 'editor'];

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(v => typeof v === 'string' && v.length > 0))];
}

function temporaryPassword(): string {
  // Readable but not guessable: 4 words-ish chunks from a small alphabet.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out + '9a';
}

/* ------------------------------- handlers ------------------------------- */
type Ctx = { req: Request; callerId: string };

async function replaceBranches(userId: string, ids: string[]) {
  const sb = service();
  const del = await sb.from('branch_access').delete().eq('user_id', userId);
  if (del.error) throw new Error(del.error.message);
  if (!ids.length) return;
  const ins = await sb.from('branch_access').insert(ids.map(person_id => ({ user_id: userId, person_id })));
  if (ins.error) throw new Error(ins.error.message);
}

async function actionList(ctx: Ctx) {
  const sb = service();
  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  const users = (data?.users ?? []).map((u: Record<string, unknown>) => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at ?? null,
    // Invite-status hints. The UI derives "pending invitation" purely from these:
    // never signed in AND (not confirmed, or confirmed but never used).
    last_sign_in_at: u.last_sign_in_at ?? null,
    email_confirmed_at: u.email_confirmed_at ?? null,
    confirmation_sent_at: (u as Record<string, unknown>).confirmation_sent_at ?? null,
    banned_until: u.banned_until ?? null
  }));
  return json({ ok: true, users }, 200, ctx.req);
}

async function actionInvite(ctx: Ctx, body: Record<string, unknown>) {
  const sb = service();
  const email = String(body.email ?? '').trim().toLowerCase();
  const fullName = String(body.full_name ?? '').trim();
  const role = String(body.role ?? 'editor');
  const branchIds = cleanIds(body.branch_person_ids);
  const sendEmail = body.send_email !== false;

  if (!EMAIL_RE.test(email)) return fail('A valid email address is required.', 400, ctx.req);
  if (!fullName) return fail('A full name is required.', 400, ctx.req);
  if (!ROLES.includes(role)) return fail('Role must be editor or admin.', 400, ctx.req);

  let userId: string | null = null;
  let tempPassword: string | null = null;

  if (sendEmail) {
    const { data, error } = await sb.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: SITE_URL || undefined
    });
    if (error) return fail(error.message, 400, ctx.req);
    userId = data?.user?.id ?? null;
  } else {
    tempPassword = temporaryPassword();
    const { data, error } = await sb.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    });
    if (error) return fail(error.message, 400, ctx.req);
    userId = data?.user?.id ?? null;
  }
  if (!userId) return fail('The account was created but no user id came back.', 500, ctx.req);

  // The handle_new_user trigger inserts the profile row; fill in the rest.
  const upsert = await sb.from('profiles').upsert({
    id: userId,
    email,
    full_name: fullName,
    role,
    active: true
  });
  if (upsert.error) return fail(upsert.error.message, 400, ctx.req);

  await replaceBranches(userId, role === 'admin' ? [] : branchIds);

  return json({ ok: true, user_id: userId, temporary_password: tempPassword }, 200, ctx.req);
}

async function actionUpdate(ctx: Ctx, body: Record<string, unknown>) {
  const sb = service();
  const userId = String(body.user_id ?? '');
  if (!userId) return fail('user_id is required.', 400, ctx.req);

  const patch: Record<string, unknown> = {};
  if (typeof body.full_name === 'string') patch.full_name = body.full_name.trim();
  if (typeof body.role === 'string') {
    if (!ROLES.includes(body.role)) return fail('Role must be editor or admin.', 400, ctx.req);
    if (userId === ctx.callerId && body.role !== 'admin') {
      return fail('You cannot remove your own admin role.', 400, ctx.req);
    }
    patch.role = body.role;
  }
  if (Object.keys(patch).length) {
    const { error } = await sb.from('profiles').update(patch).eq('id', userId);
    if (error) return fail(error.message, 400, ctx.req);
  }
  if (body.branch_person_ids !== undefined) {
    await replaceBranches(userId, cleanIds(body.branch_person_ids));
  }
  return json({ ok: true }, 200, ctx.req);
}

async function actionResend(ctx: Ctx, body: Record<string, unknown>) {
  const sb = service();
  const userId = String(body.user_id ?? '');
  if (!userId) return fail('user_id is required.', 400, ctx.req);
  const { data: profile, error: pErr } = await sb.from('profiles').select('email').eq('id', userId).single();
  if (pErr || !profile?.email) return fail('That account has no email address.', 400, ctx.req);

  // For an account that has never signed in, a fresh invitation; otherwise a
  // password-recovery link, which is the same "here is a new way in" email.
  const invite = await sb.auth.admin.inviteUserByEmail(profile.email, { redirectTo: SITE_URL || undefined });
  if (!invite.error) return json({ ok: true, kind: 'invite' }, 200, ctx.req);

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const reset = await anon.auth.resetPasswordForEmail(profile.email, { redirectTo: SITE_URL || undefined });
  if (reset.error) return fail(reset.error.message, 400, ctx.req);
  return json({ ok: true, kind: 'recovery' }, 200, ctx.req);
}

async function actionSetPassword(ctx: Ctx, body: Record<string, unknown>) {
  const sb = service();
  const userId = String(body.user_id ?? '');
  const password = String(body.password ?? '');
  if (!userId) return fail('user_id is required.', 400, ctx.req);
  if (userId === ctx.callerId) return fail('Change your own password from the Profile button instead.', 400, ctx.req);
  if (password.length < 8) return fail('The password must be at least 8 characters.', 400, ctx.req);
  const { error } = await sb.auth.admin.updateUserById(userId, { password });
  if (error) return fail(error.message, 400, ctx.req);
  return json({ ok: true }, 200, ctx.req);
}

async function actionRemove(ctx: Ctx, body: Record<string, unknown>) {
  const sb = service();
  const userId = String(body.user_id ?? '');
  if (!userId) return fail('user_id is required.', 400, ctx.req);
  // Cancelling a pending invitation removes a not-yet-used account. Anything
  // with sign-in history is a real account and is refused — this path is only
  // ever for invitations that were never accepted.
  if (userId === ctx.callerId) return fail('You cannot cancel your own invitation.', 400, ctx.req);
  const { data } = await sb.auth.admin.getUserById(userId);
  const u = data?.user ?? null;
  if (!u) return fail('That account was not found — it may already be cancelled.', 404, ctx.req);
  if (u.last_sign_in_at) {
    return fail('This account has already signed in, so it cannot be cancelled. Deactivate it instead.', 400, ctx.req);
  }
  const { error } = await sb.auth.admin.deleteUser(userId);
  if (error) return fail(error.message, 400, ctx.req);
  return json({ ok: true, removed: true }, 200, ctx.req);
}

async function actionSetActive(ctx: Ctx, body: Record<string, unknown>, active: boolean) {
  const sb = service();
  const userId = String(body.user_id ?? '');
  if (!userId) return fail('user_id is required.', 400, ctx.req);
  if (!active && userId === ctx.callerId) return fail('You cannot deactivate your own account.', 400, ctx.req);

  const { error } = await sb.from('profiles').update({ active }).eq('id', userId);
  if (error) return fail(error.message, 400, ctx.req);

  // Banning stops the account from getting a session at all; deactivating alone
  // already blocks the tree, but banning also kills any existing session.
  const ban = await sb.auth.admin.updateUserById(userId, {
    ban_duration: active ? 'none' : '876000h'
  });
  if (ban.error) {
    // The profile flag did change, so report success but say what was skipped.
    return json({ ok: true, warning: ban.error.message }, 200, ctx.req);
  }
  return json({ ok: true }, 200, ctx.req);
}

/* -------------------------------- entry -------------------------------- */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return fail('Use POST.', 405, req);

  try {
    const auth = req.headers.get('Authorization') || '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    if (!jwt) return fail('Sign in first.', 401, req);

    const sb = service();
    // Verify the token and identify the caller with the service client.
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) return fail('Your session is not valid any more.', 401, req);
    const callerId = userData.user.id;

    const { data: profile, error: profErr } = await sb
      .from('profiles').select('role, active').eq('id', callerId).single();
    if (profErr || !profile) return fail('No profile found for this account.', 403, req);
    if (profile.role !== 'admin' || profile.active !== true) {
      return fail('Only an active admin can manage accounts.', 403, req);
    }

    const body = await req.json().catch(() => ({}));
    const action = String((body as Record<string, unknown>).action ?? '');
    const ctx: Ctx = { req, callerId };

    switch (action) {
      case 'list': return await actionList(ctx);
      case 'invite': return await actionInvite(ctx, body);
      case 'update': return await actionUpdate(ctx, body);
      case 'resend': return await actionResend(ctx, body);
      case 'set_password': return await actionSetPassword(ctx, body);
      case 'disable': return await actionSetActive(ctx, body, false);
      case 'enable': return await actionSetActive(ctx, body, true);
      case 'remove': return await actionRemove(ctx, body);
      default: return fail('Unknown action.', 400, req);
    }
  } catch (err) {
    // Never echo the service key or an internal stack to the browser.
    console.error('admin-users failed:', (err as Error)?.message);
    return fail((err as Error)?.message || 'The request failed.', 500, req);
  }
});
