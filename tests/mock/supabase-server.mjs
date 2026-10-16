/*
 * Mock Supabase for end-to-end tests.
 *
 * Serves just enough of GoTrue, PostgREST and Storage for the app's flows:
 * password sign-in / refresh / logout, recover, set-password (PUT /user),
 * profiles + branch_access reads/updates under the same RLS rules the real
 * database enforces, people reads AND writes with the real triggers
 * (path / guard / stamps / audit_log) re-implemented, deletion_requests,
 * the private `photos` bucket (upload / signed URL / signed download /
 * remove), and a couple of /__mock/* helpers for the tests.
 *
 * Fixtures are fictional (example.test) and passwords are plain text — this
 * server only ever handles fake accounts on 127.0.0.1. Tokens are unsigned
 * JWT-shaped strings so supabase-js can decode their payload.
 *
 * Deliberate simplifications (documented in docs/TESTING.md):
 *   - refresh and invite tokens stay valid until the process restarts, so
 *     tests need no cleanup between runs;
 *   - people writes land in a PER-ACCESS-TOKEN overlay over the immutable
 *     base fixtures. Parallel Playwright projects (desktop + mobile) each
 *     sign in separately, so they can never observe or clobber each other's
 *     writes; a token refresh starts a fresh overlay. `/__mock/writes`
 *     merges the overlays per fixture account for direct assertions;
 *   - uploaded photo objects are stored in memory, keyed by the object path
 *     (which carries a unique timestamped name per upload), and served to
 *     `<img>` requests through opaque signed tokens;
 *   - PostgREST pagination is Range-header slicing, enough for the app.
 */
import { createServer } from 'node:http';

const HOST = '127.0.0.1';
const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 54321);
const PASSWORD = 'test-password-1';
const NOW_ISO = '2026-01-01T00:00:00.000Z';

/* ------------------------------- fixtures ------------------------------- */

function makeUser(id, email, profile, branchAccess = [], password = PASSWORD) {
  return { id, email, password, profile, branchAccess };
}

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

const USERS = [
  makeUser(ADMIN_ID, 'admin@example.test', {
    full_name: 'Family Admin',
    role: 'admin',
    active: true,
    language: 'en',
  }),
  makeUser(
    '22222222-2222-4222-8222-222222222222',
    'editor@example.test',
    { full_name: 'Branch Editor', role: 'editor', active: true, language: 'en' },
    ['person-a'],
  ),
  makeUser('33333333-3333-4333-8333-333333333333', 'inactive@example.test', {
    full_name: 'Inactive User',
    role: 'editor',
    active: false,
    language: 'en',
  }),
  makeUser('44444444-4444-4444-8444-444444444444', 'noprofile@example.test', null),
  // Invitees start with no password — the invite link is how they choose one.
  makeUser(
    '55555555-5555-4555-8555-555555555555',
    'invitee@example.test',
    { full_name: 'Invited Active', role: 'editor', active: true, language: 'en' },
    [],
    null,
  ),
  makeUser(
    '66666666-6666-4666-8666-666666666666',
    'inactive-invitee@example.test',
    { full_name: 'Invited Inactive', role: 'editor', active: false, language: 'en' },
    [],
    null,
  ),
  makeUser(
    '77777777-7777-4777-8777-777777777777',
    'profile@example.test',
    { full_name: 'Profile Tester', role: 'editor', active: true, language: 'en' },
    ['person-a'],
  ),
  makeUser(
    '88888888-8888-4888-8888-888888888888',
    'lang@example.test',
    { full_name: 'Lang Tester', role: 'editor', active: true, language: 'en' },
    ['person-a'],
  ),
  makeUser(
    '99999999-9999-4999-8999-999999999999',
    'fail@example.test',
    { full_name: 'Load Failure Tester', role: 'editor', active: true, language: 'en' },
    [],
  ),
  // An editor assigned to two branches — exercises the anchor chooser.
  makeUser(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'twobranch@example.test',
    { full_name: 'Two Branch Editor', role: 'editor', active: true, language: 'en' },
    ['person-a', 'person-l'],
  ),
  // An active editor with no assignment — the honest no-access hero.
  makeUser(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'nobranch@example.test',
    { full_name: 'No Branch Editor', role: 'editor', active: true, language: 'en' },
    [],
  ),
];

/* ----------------------------- people fixtures ---------------------------- */

/*
 * A small fictional family for the tree tests — five generations, two roots,
 * a spouse-text pair, a soft-deleted row, unknown gender and a text-only
 * date. None of it resembles real family data; ids are readable slugs so
 * assertions can name a person directly. `path` is the ancestors root..self
 * chain the real trigger maintains (branch_access is matched against it).
 */
function person(over) {
  return {
    id: null,
    legacy_id: null,
    parent_id: null,
    gender: null,
    full_name: null,
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
    source: 'fixture.xlsx',
    is_deleted: false,
    created_by: ADMIN_ID,
    updated_by: ADMIN_ID,
    created_at: NOW_ISO,
    updated_at: null,
    path: [],
    ...over,
  };
}

const PEOPLE = [
  person({
    id: 'person-a',
    legacy_id: 'F1',
    full_name: 'Amir Fixture',
    gender: 'Male',
    spouse_name: 'Fatima Fixture',
    spouse_father_name: 'Yusuf Fixture',
    dob: '1890-05-01',
    dod: '1965-02-02',
    place_of_birth: 'Fixtureabad',
    qualification: 'Hafiz',
    place_of_burial: 'Fixtureabad Cemetery',
    name_ur: 'عامر',
    name_hi: 'आमिर',
    notes: 'Family patriarch (fixture).',
    updated_at: '2026-01-02T10:00:00.000Z',
    path: ['person-a'],
  }),
  person({
    id: 'person-b',
    full_name: 'Bahadur Fixture',
    gender: 'Male',
    parent_id: 'person-a',
    spouse_name: 'Khadija Fixture',
    dob: '1920-03-12',
    place_of_birth: 'Fixtureabad',
    name_ur: 'بہادر',
    name_hi: 'बहादुर',
    path: ['person-a', 'person-b'],
  }),
  person({
    id: 'person-c',
    full_name: 'Saima Fixture',
    gender: 'Female',
    parent_id: 'person-a',
    dob: '1925-08-20',
    dod: '2010-01-01',
    qualification: 'B.A.',
    path: ['person-a', 'person-c'],
  }),
  person({
    id: 'person-j',
    full_name: 'Jamal Fixture',
    parent_id: 'person-a',
    dob_text: 'year unknown',
    path: ['person-a', 'person-j'],
  }),
  person({
    id: 'person-d',
    full_name: 'Dawood Fixture',
    gender: 'Male',
    parent_id: 'person-b',
    spouse_name: 'Safiya Fixture',
    dob: '1950-11-05',
    dob_text: 'circa 1950',
    place_of_birth: 'Karachi',
    path: ['person-a', 'person-b', 'person-d'],
  }),
  person({
    id: 'person-e',
    full_name: 'Nadia Fixture',
    gender: 'Female',
    parent_id: 'person-b',
    dob: '1955-02-14',
    name_ur: 'نادیہ',
    name_hi: 'नादिया',
    path: ['person-a', 'person-b', 'person-e'],
  }),
  person({
    id: 'person-k',
    full_name: 'Kashif Fixture',
    gender: 'Male',
    parent_id: 'person-b',
    dob: '1958-01-01',
    is_deleted: true,
    path: ['person-a', 'person-b', 'person-k'],
  }),
  person({
    id: 'person-f',
    full_name: 'Farid Fixture',
    gender: 'Male',
    parent_id: 'person-d',
    spouse_name: 'Hina Fixture',
    dob: '1975-06-30',
    qualification: 'M.Sc.',
    path: ['person-a', 'person-b', 'person-d', 'person-f'],
  }),
  person({
    id: 'person-g',
    full_name: 'Gul Fixture',
    gender: 'Female',
    parent_id: 'person-d',
    dob: '1978-09-09',
    name_ur: 'گل',
    name_hi: 'गुल',
    path: ['person-a', 'person-b', 'person-d', 'person-g'],
  }),
  person({
    id: 'person-h',
    full_name: 'Hamza Fixture',
    gender: 'Male',
    parent_id: 'person-f',
    dob: '2005-04-01',
    path: ['person-a', 'person-b', 'person-d', 'person-f', 'person-h'],
  }),
  person({
    id: 'person-i',
    full_name: 'Inaya Fixture',
    gender: 'Female',
    parent_id: 'person-f',
    dob: '2008-12-25',
    path: ['person-a', 'person-b', 'person-d', 'person-f', 'person-i'],
  }),
  // Second root: a separate branch, so the layout has several root groups.
  person({
    id: 'person-l',
    full_name: 'Laila Fixture',
    gender: 'Female',
    dob: '1900-01-01',
    path: ['person-l'],
  }),
  person({
    id: 'person-m',
    full_name: 'Mariam Fixture',
    gender: 'Female',
    parent_id: 'person-l',
    spouse_name: 'Iqbal Fixture',
    dob: '1930-04-04',
    dod: '1999-12-31',
    path: ['person-l', 'person-m'],
  }),
  person({
    id: 'person-n',
    full_name: 'Naveed Fixture',
    gender: 'Male',
    parent_id: 'person-l',
    dob: '1935-07-07',
    dod: '2015-03-03',
    path: ['person-l', 'person-n'],
  }),
];

/*
 * Change history for person-a (newest last). The newest row keeps the
 * "by Family Admin" attribution other specs assert; the earlier update
 * carries a different name so "restore this version" has something to do.
 */
const AUDIT_LOG = [
  {
    id: 1,
    person_id: 'person-a',
    action: 'insert',
    changed_by: ADMIN_ID,
    changed_by_name: 'Family Admin',
    old_data: null,
    new_data: null,
    changed_at: '2025-12-01T09:00:00.000Z',
  },
  {
    id: 2,
    person_id: 'person-a',
    action: 'update',
    changed_by: ADMIN_ID,
    changed_by_name: 'Family Admin',
    old_data: {
      full_name: 'Amir Fitri',
      place_of_birth: null,
      qualification: null,
    },
    new_data: {
      full_name: 'Amir Fixture',
      place_of_birth: 'Fixtureabad',
      qualification: 'Hafiz',
    },
    changed_at: '2025-12-15T12:00:00.000Z',
  },
  {
    id: 3,
    person_id: 'person-a',
    action: 'update',
    changed_by: ADMIN_ID,
    changed_by_name: 'Family Admin',
    old_data: { notes: null },
    new_data: { notes: 'Family patriarch (fixture).' },
    changed_at: '2026-01-02T10:00:00.000Z',
  },
];

/* ------------------------------- helpers -------------------------------- */

let tokenSeq = 0;
let idSeq = 0;
let auditSeq = 100;
let signedSeq = 0;
const accessTokens = new Map(); // access token -> user id
const refreshTokens = new Map(); // refresh token -> user id

/**
 * Per-access-token write overlay over the immutable base fixtures.
 *   people            Map<id, row>  — inserted or updated effective rows
 *   audit             audit rows appended by writes
 *   deletionRequests  rows an editor submitted
 *   uploads/removals  object keys touched through the storage API
 */
const overlays = new Map();

/** Uploaded photo objects (key -> { body: Buffer, contentType }). */
const objects = new Map();
/** Signed download refs (opaque token -> { key, expiresAt }). */
const signedRefs = new Map();

/** Fault injection: the next N people reads for one account answer 500. */
const failPeopleFor = new Map(); // email -> remaining failures

function findUserByEmail(email) {
  const normalized = String(email ?? '').toLowerCase();
  return USERS.find((u) => u.email === normalized) ?? null;
}

function findUserById(id) {
  return USERS.find((u) => u.id === id) ?? null;
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** An unsigned JWT-shaped token: supabase-js decodes the payload, never verifies. */
function makeJwt(payload) {
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.${'mock'.repeat(8)}`;
}

function publicUser(user) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: NOW_ISO,
    phone: '',
    confirmed_at: NOW_ISO,
    last_sign_in_at: NOW_ISO,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
  };
}

function mintSession(user) {
  tokenSeq += 1;
  const now = Math.floor(Date.now() / 1000);
  const accessToken = makeJwt({
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    aud: 'authenticated',
    // Unique per session so two sign-ins in the same second never collide
    // (transparently ignored by supabase-js).
    jti: tokenSeq,
    iat: now,
    exp: now + 3600,
  });
  const refreshToken = `mock-refresh-${user.id}-${tokenSeq}`;
  accessTokens.set(accessToken, user.id);
  refreshTokens.set(refreshToken, user.id);
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: refreshToken,
    user: publicUser(user),
  };
}

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] ?? '*',
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(req, res, status, body) {
  cors(req, res);
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendEmpty(req, res, status = 204) {
  cors(req, res);
  res.writeHead(status);
  res.end();
}

function sendBinary(req, res, status, body, contentType) {
  cors(req, res);
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': body.length,
  });
  res.end(body);
}

function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8_000_000) req.destroy();
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function readJson(req) {
  const raw = await readRaw(req);
  try {
    return raw.length ? JSON.parse(raw.toString('utf8')) : {};
  } catch {
    return {};
  }
}

/**
 * PostgREST `order=col.asc.nullsfirst,…` — enough for the columns the app
 * sorts by (ISO date strings and ids compare as strings).
 */
function sortRows(rows, orderParam) {
  const terms = String(orderParam ?? '')
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => {
      const [col, dir, nulls] = term.split('.');
      return { col, dir: dir === 'desc' ? -1 : 1, nullsFirst: nulls === 'nullsfirst' };
    });
  if (!terms.length) return rows;
  return rows.slice().sort((a, b) => {
    for (const { col, dir, nullsFirst } of terms) {
      const av = a[col];
      const bv = b[col];
      if (av == null && bv == null) continue;
      if (av == null) return nullsFirst ? -1 : 1;
      if (bv == null) return nullsFirst ? 1 : -1;
      if (av < bv) return -dir;
      if (av > bv) return dir;
    }
    return 0;
  });
}

/** `Range: 0-999` → inclusive slice bounds, clamped to the row count. */
function rangeFrom(req, total) {
  const match = /^(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
  const from = match ? Number(match[1]) : 0;
  const to = match && match[2] !== '' ? Number(match[2]) : total - 1;
  return [Math.min(from, Math.max(0, total - 1)), Math.min(to, Math.max(0, total - 1))];
}

function bearerToken(req) {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

function bearerUserId(req) {
  const token = bearerToken(req);
  return token ? (accessTokens.get(token) ?? null) : null;
}

function overlayFor(token) {
  let overlay = overlays.get(token);
  if (!overlay) {
    overlay = {
      people: new Map(),
      audit: [],
      deletionRequests: [],
      inserts: [],
      patches: [],
      uploads: [],
      removals: [],
    };
    overlays.set(token, overlay);
  }
  return overlay;
}

/** The caller's view of `people`: immutable base rows overlaid by their writes. */
function effectivePeople(overlay) {
  const rows = new Map();
  for (const base of PEOPLE) rows.set(base.id, { ...base, path: [...base.path] });
  if (overlay) {
    for (const [id, row] of overlay.people) rows.set(id, row);
  }
  return rows;
}

function restError(req, res, status, code, message) {
  sendJson(req, res, status, {
    code,
    details: null,
    hint: null,
    message,
  });
}

/** Trigger-language error with a SQLSTATE, like PostgREST reports exceptions. */
function triggerError(req, res, message) {
  return restError(req, res, 400, 'P0001', message);
}

function wantsObject(req) {
  return String(req.headers.accept ?? '').includes('application/vnd.pgrst.object+json');
}

function wantsRepresentation(req) {
  return String(req.headers.prefer ?? '').includes('return=representation');
}

function changedByName(user) {
  return user?.profile?.full_name ?? user?.email ?? null;
}

function nowIso() {
  return new Date().toISOString();
}

/** `can_edit_person()`: admin everywhere; editor inside an assigned branch. */
function canEditPerson(user, row) {
  if (!user || !user.profile || !user.profile.active) return false;
  if (user.profile.role === 'admin') return true;
  if (!row || !Array.isArray(row.path)) return false;
  return row.path.some((id) => user.branchAccess.includes(id));
}

/** Every column the real table has — anything else is a PGRST204. */
const SCHEMA_COLUMNS = new Set([
  'id',
  'legacy_id',
  'parent_id',
  'gender',
  'full_name',
  'nick_name',
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
  'name_ur',
  'name_hi',
  'notes',
  'photo_path',
  'source',
  'path',
  'is_deleted',
  'created_by',
  'updated_by',
  'created_at',
  'updated_at',
]);

/* --------------------------------- auth --------------------------------- */

async function handleAuth(req, res, url) {
  const path = url.pathname;

  if (req.method === 'POST' && path === '/auth/v1/token') {
    const grant = url.searchParams.get('grant_type');
    const body = await readJson(req);

    if (grant === 'password') {
      const user = findUserByEmail(body.email);
      if (!user || !user.password || user.password !== body.password) {
        return sendJson(req, res, 400, {
          code: 400,
          error_code: 'invalid_credentials',
          msg: 'Invalid login credentials',
        });
      }
      return sendJson(req, res, 200, mintSession(user));
    }

    if (grant === 'refresh_token') {
      const userId = refreshTokens.get(body.refresh_token);
      const user = userId ? findUserById(userId) : null;
      if (!user) {
        return sendJson(req, res, 400, {
          code: 400,
          error_code: 'refresh_token_not_found',
          msg: 'Invalid Refresh Token: Refresh Token Not Found',
        });
      }
      return sendJson(req, res, 200, mintSession(user));
    }

    return sendJson(req, res, 400, { code: 400, msg: `Unsupported grant_type: ${grant}` });
  }

  if (path === '/auth/v1/user') {
    const userId = bearerUserId(req);
    const user = userId ? findUserById(userId) : null;
    if (!user) {
      return sendJson(req, res, 401, {
        code: 401,
        error_code: 'bad_jwt',
        msg: 'invalid claim: missing sub claim',
      });
    }
    if (req.method === 'GET') return sendJson(req, res, 200, publicUser(user));
    if (req.method === 'PUT') {
      const body = await readJson(req);
      if (typeof body.password === 'string' && body.password.length > 0) {
        user.password = body.password;
      }
      return sendJson(req, res, 200, publicUser(user));
    }
  }

  if (req.method === 'POST' && path === '/auth/v1/logout') {
    // Tokens stay valid (documented simplification) — signing out is a client concern here.
    return sendEmpty(req, res);
  }

  if (req.method === 'POST' && path === '/auth/v1/recover') {
    // Always the same answer, whether or not the address exists.
    return sendJson(req, res, 200, {});
  }

  return sendJson(req, res, 404, { code: 404, msg: `No mock route: ${req.method} ${path}` });
}

/* ------------------------------- postgrest ------------------------------- */

/**
 * people INSERT — RLS (`is_admin() or parent_id is not null and
 * can_edit_person(parent_id)`), the guard trigger (editors cannot set
 * legacy_id/is_deleted), the path trigger and an audit row.
 */
async function insertPeople(req, res, url, token, user) {
  if (!user || !user.profile || !user.profile.active) {
    return restError(req, res, 403, '42501', 'permission denied for table people');
  }
  const admin = user.profile.role === 'admin';
  const body = await readJson(req);
  const list = Array.isArray(body) ? body : [body];
  const overlay = overlayFor(token);
  const rows = effectivePeople(overlay);
  const created = [];

  for (const values of list) {
    const parentId = values.parent_id ?? null;
    for (const key of Object.keys(values)) {
      if (!SCHEMA_COLUMNS.has(key)) {
        return restError(req, res, 400, 'PGRST204', `Could not find the '${key}' column of 'people' in the schema cache`);
      }
    }
    if (!admin) {
      if (!parentId || !canEditPerson(user, rows.get(parentId))) {
        return restError(req, res, 403, '42501', 'new row violates row-level security policy for table "people"');
      }
    }

    let path = null;
    if (parentId != null) {
      const parent = rows.get(parentId);
      if (!parent) return triggerError(req, res, 'Parent not found');
      path = [...parent.path];
    }

    idSeq += 1;
    const id = `person-new-${idSeq}`;
    const row = {
      ...values,
      id,
      parent_id: parentId,
      // The guard trigger silently coerces these for non-admins on INSERT.
      legacy_id: admin ? (values.legacy_id ?? null) : null,
      is_deleted: false,
      source: values.source ?? null,
      path: parentId ? [...path, id] : [id],
      created_by: user.id,
      updated_by: user.id,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    const missing = ['gender', 'full_name', 'nick_name', 'fathers_name', 'mothers_name'];
    for (const key of missing) if (!(key in row)) row[key] = null;
    rows.set(id, row);
    overlay.people.set(id, row);
    overlay.inserts.push({ id, values: { ...values } });
    overlay.audit.push({
      id: ++auditSeq,
      person_id: id,
      action: 'insert',
      changed_by: user.id,
      changed_by_name: changedByName(user),
      old_data: null,
      new_data: row,
      changed_at: nowIso(),
    });
    created.push(row);
  }

  if (wantsObject(req)) {
    if (created.length !== 1) {
      return restError(req, res, 406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned');
    }
    return sendJson(req, res, 201, created[0]);
  }
  return sendJson(req, res, 201, created);
}

/**
 * people UPDATE — RLS (`can_edit_person`), the guard trigger (parent moves
 * and delete/restore are admin-only), the path trigger with its "own
 * descendant" check, stamps and the audit trigger (skipping no-op updates).
 */
async function patchPeople(req, res, url, token, user) {
  if (!user || !user.profile || !user.profile.active) {
    return restError(req, res, 403, '42501', 'permission denied for table people');
  }
  const id = url.searchParams.get('id');
  const idValue = id && id.startsWith('eq.') ? id.slice(3) : id;
  const body = await readJson(req);
  const admin = user.profile.role === 'admin';
  const overlay = overlayFor(token);
  const rows = effectivePeople(overlay);
  const row = rows.get(idValue);

  for (const key of Object.keys(body)) {
    if (!SCHEMA_COLUMNS.has(key)) {
      return restError(req, res, 400, 'PGRST204', `Could not find the '${key}' column of 'people' in the schema cache`);
    }
  }
  if (!row) return sendEmpty(req, res, 204);
  if (!canEditPerson(user, row)) {
    return restError(req, res, 403, '42501', 'permission denied for table people');
  }

  if (!admin) {
    // Guard trigger: raise only when the guarded value actually changes …
    if ('parent_id' in body && (body.parent_id ?? null) !== (row.parent_id ?? null)) {
      return triggerError(req, res, 'Only an admin can move a person to a different parent');
    }
    if ('is_deleted' in body && Boolean(body.is_deleted) !== Boolean(row.is_deleted)) {
      return triggerError(req, res, 'Only an admin can delete or restore people - use a deletion request');
    }
  }

  const next = { ...row, path: [...row.path] };
  for (const [key, value] of Object.entries(body)) {
    if (key === 'id' || key === 'path' || key === 'updated_at' || key === 'updated_by') continue;
    next[key] = value;
  }

  if (!admin) {
    // … and silently reset these before the row is written.
    next.legacy_id = row.legacy_id;
    next.created_by = row.created_by;
    next.created_at = row.created_at;
  }

  if ('parent_id' in body) {
    const parentId = body.parent_id ?? null;
    if (parentId === null) {
      next.path = [row.id];
    } else {
      const parent = rows.get(parentId);
      if (!parent) return triggerError(req, res, 'Parent not found');
      if (parentId === row.id || parent.path.includes(row.id)) {
        return triggerError(req, res, 'A person cannot be placed under their own descendant');
      }
      next.path = [...parent.path, row.id];
    }
    // The fix-descendants trigger rewrites the stored path of everyone below.
    for (const child of rows.values()) {
      if (child.id === row.id) continue;
      const at = child.path.indexOf(row.id);
      if (at === -1) continue;
      const updatedChild = { ...child, path: [...next.path, ...child.path.slice(at + 1)] };
      overlay.people.set(child.id, updatedChild);
    }
  }

  next.updated_at = nowIso();
  next.updated_by = user.id;

  // The audit trigger ignores updates where only path/stamps changed.
  const strip = (candidate) => {
    const copy = { ...candidate };
    delete copy.path;
    delete copy.updated_at;
    delete copy.updated_by;
    return copy;
  };
  if (JSON.stringify(strip(next)) !== JSON.stringify(strip(row))) {
    const action =
      next.is_deleted && !row.is_deleted ? 'delete' : row.is_deleted && !next.is_deleted ? 'restore' : 'update';
    overlay.audit.push({
      id: ++auditSeq,
      person_id: row.id,
      action,
      changed_by: user.id,
      changed_by_name: changedByName(user),
      old_data: { ...row },
      new_data: { ...next },
      changed_at: nowIso(),
    });
  }

  overlay.people.set(row.id, next);
  overlay.patches.push({ id: row.id, body: { ...body } });

  if (wantsObject(req)) return sendJson(req, res, 200, next);
  if (wantsRepresentation(req)) return sendJson(req, res, 200, [next]);
  return sendEmpty(req, res, 204);
}

async function handleRest(req, res, url) {
  const table = url.pathname.replace('/rest/v1/', '');
  const token = bearerToken(req);
  const userId = token ? (accessTokens.get(token) ?? null) : null;
  if (!userId) return restError(req, res, 401, 'PGRST301', 'JWT verification failed');
  const user = findUserById(userId);

  function queryValue(key) {
    const raw = url.searchParams.get(key);
    return raw && raw.startsWith('eq.') ? raw.slice(3) : null;
  }

  if (table === 'profiles') {
    if (req.method === 'GET') {
      const id = queryValue('id');
      const row = user && user.profile && (!id || id === user.id) ? user.profile : null;
      const wantsObject = String(req.headers.accept ?? '').includes('application/vnd.pgrst.object+json');
      if (wantsObject) {
        if (!row) {
          return restError(req, res, 406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned');
        }
        return sendJson(req, res, 200, { id: user.id, email: user.email, ...row });
      }
      const rows = row ? [{ id: user.id, email: user.email, ...row }] : [];
      return sendJson(req, res, 200, rows);
    }
    if (req.method === 'PATCH') {
      const id = queryValue('id');
      if (!user || !user.profile || id !== user.id) {
        return restError(req, res, 403, '42501', 'permission denied for table profiles');
      }
      const body = await readJson(req);
      if (typeof body.full_name === 'string') user.profile.full_name = body.full_name;
      if (typeof body.language === 'string') user.profile.language = body.language;
      return sendEmpty(req, res);
    }
  }

  if (table === 'branch_access' && req.method === 'GET') {
    const requested = queryValue('user_id');
    if (!user || requested !== user.id) return sendJson(req, res, 200, []);
    const rows = user.branchAccess.map((personId) => ({ user_id: user.id, person_id: personId }));
    return sendJson(req, res, 200, rows);
  }

  if (table === 'people' && req.method === 'GET') {
    // RLS: only active profiles may read; soft-deleted rows are admin-only.
    if (!user || !user.profile || !user.profile.active) {
      return restError(req, res, 403, '42501', 'permission denied for table people');
    }
    if ((failPeopleFor.get(user.email) ?? 0) > 0) {
      failPeopleFor.set(user.email, failPeopleFor.get(user.email) - 1);
      return restError(req, res, 500, 'MOCK500', 'mock load failure');
    }
    const admin = user.profile.role === 'admin';
    const rows = [...effectivePeople(token ? overlayFor(token) : null).values()];
    const deletedFilter = queryValue('is_deleted');
    let visible = rows.filter((row) => admin || !row.is_deleted);
    if (deletedFilter === 'false') visible = visible.filter((row) => !row.is_deleted);
    if (deletedFilter === 'true') visible = visible.filter((row) => row.is_deleted);
    // Column equality filters (`col=eq.value`) — scalar columns only.
    for (const [col, raw] of url.searchParams.entries()) {
      if (!raw.startsWith('eq.') || !SCHEMA_COLUMNS.has(col)) continue;
      if (col == null || col === 'path') continue;
      const wanted = raw.slice(3);
      visible = visible.filter((row) => String(row[col] ?? '') === wanted);
    }
    visible = sortRows(visible, url.searchParams.get('order'));
    const total = visible.length;
    cors(req, res);
    res.setHeader('Content-Range', `0-${Math.max(0, total - 1)}/${total}`);
    if (wantsObject(req)) {
      if (total !== 1) {
        return restError(req, res, 406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned');
      }
      return sendJson(req, res, 200, visible[0]);
    }
    const [from, to] = rangeFrom(req, total);
    const page = total ? visible.slice(from, to + 1) : [];
    return sendJson(req, res, 200, page);
  }

  if (table === 'people' && req.method === 'POST') {
    return insertPeople(req, res, url, token, user);
  }

  if (table === 'people' && req.method === 'PATCH') {
    return patchPeople(req, res, url, token, user);
  }

  if (table === 'deletion_requests' && req.method === 'POST') {
    // RLS: requested_by = auth.uid() and can_edit_person(person_id).
    if (!user || !user.profile || !user.profile.active) {
      return restError(req, res, 403, '42501', 'permission denied for table deletion_requests');
    }
    const body = await readJson(req);
    const list = Array.isArray(body) ? body : [body];
    const overlay = overlayFor(token);
    const rows = effectivePeople(overlay);
    const created = [];
    for (const values of list) {
      const personId = values.person_id ?? null;
      if (!personId || !canEditPerson(user, rows.get(personId))) {
        return restError(req, res, 403, '42501', 'new row violates row-level security policy for table "deletion_requests"');
      }
      const row = {
        id: `dr-${++idSeq}`,
        person_id: personId,
        requested_by: user.id,
        reason: values.reason ?? null,
        status: 'pending',
        created_at: nowIso(),
        resolved_by: null,
        resolved_at: null,
      };
      overlay.deletionRequests.push(row);
      created.push(row);
    }
    if (wantsObject(req)) return sendJson(req, res, 201, created[0]);
    return sendJson(req, res, 201, created);
  }

  if (table === 'audit_log' && req.method === 'GET') {
    // RLS: admin sees all; editors see the history of people they can edit.
    if (!user || !user.profile || !user.profile.active) {
      return restError(req, res, 403, '42501', 'permission denied for table audit_log');
    }
    const personId = queryValue('person_id');
    const overlay = token ? overlays.get(token) : null;
    const rows = effectivePeople(overlay);
    const allowed = (row) => canEditPerson(user, rows.get(row.person_id));
    let all = [...AUDIT_LOG, ...(overlay?.audit ?? [])];
    if (personId) all = all.filter((row) => row.person_id === personId);
    all = all.filter((row) => allowed(row));
    all = sortRows(all, url.searchParams.get('order'));
    const limitRaw = url.searchParams.get('limit');
    if (limitRaw) all = all.slice(0, Number(limitRaw));
    return sendJson(req, res, 200, all);
  }

  return restError(req, res, 404, 'PGRST404', `No mock table: ${table}`);
}

/* --------------------------------- storage ------------------------------- */

const PNG_FALLBACK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Find the uploaded file's bytes inside a multipart/form-data upload body. */
function extractUploadedFile(req, raw) {
  const contentType = String(req.headers['content-type'] ?? '');
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundaryMatch) return { body: PNG_FALLBACK, contentType: 'image/png' };
  const boundary = Buffer.from(`--${boundaryMatch[1] ?? boundaryMatch[2]}`);
  const headerEnd = Buffer.from('\r\n\r\n');

  let from = raw.indexOf(boundary);
  while (from !== -1) {
    const start = from + boundary.length;
    const next = raw.indexOf(boundary, start);
    if (next === -1) break;
    const part = raw.subarray(start, next);
    const sep = part.indexOf(headerEnd);
    if (sep !== -1) {
      const headers = part.subarray(0, sep).toString('utf8').toLowerCase();
      if (headers.includes('filename=')) {
        let body = part.subarray(sep + headerEnd.length);
        // Trim the trailing CRLF that precedes the next boundary.
        if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
          body = body.subarray(0, body.length - 2);
        }
        const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(headers);
        const type = typeMatch ? typeMatch[1].trim() : 'application/octet-stream';
        if (body.length) return { body: Buffer.from(body), contentType: type };
        return { body: PNG_FALLBACK, contentType: 'image/png' };
      }
    }
    from = next;
  }
  return { body: PNG_FALLBACK, contentType: 'image/png' };
}

async function handleStorage(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);

  // POST /storage/v1/object/photos/<key> — multipart upload.
  if (req.method === 'POST' && pathname.startsWith('/storage/v1/object/photos/')) {
    const token = bearerToken(req);
    const userId = token ? (accessTokens.get(token) ?? null) : null;
    if (!userId) {
      return sendJson(req, res, 400, { statusCode: '401', error: 'Unauthorized', message: 'Invalid JWT' });
    }
    const key = pathname.slice('/storage/v1/object/photos/'.length);
    if (!key) return sendJson(req, res, 400, { statusCode: '400', error: 'InvalidKey' });
    const raw = await readRaw(req);
    if (objects.has(key)) {
      return sendJson(req, res, 400, {
        statusCode: '409',
        error: 'Duplicate',
        message: 'The resource already exists',
      });
    }
    const file = extractUploadedFile(req, raw);
    objects.set(key, file);
    overlayFor(token).uploads.push({ key, size: file.body.length, contentType: file.contentType });
    return sendJson(req, res, 200, { Key: `photos/${key}`, Id: `obj-${++idSeq}` });
  }

  // POST /storage/v1/object/sign/photos[/<key>] — single or batch signing.
  if (req.method === 'POST' && pathname.startsWith('/storage/v1/object/sign/photos')) {
    const token = bearerToken(req);
    const userId = token ? (accessTokens.get(token) ?? null) : null;
    if (!userId) {
      return sendJson(req, res, 400, { statusCode: '401', error: 'Unauthorized', message: 'Invalid JWT' });
    }
    const body = await readJson(req);
    const expiresIn = Number(body.expiresIn ?? 3600);
    const rest = pathname.slice('/storage/v1/object/sign/photos'.length).replace(/^\//, '');

    const signOne = (key) => {
      signedSeq += 1;
      const ref = `mock-signed-${signedSeq}`;
      signedRefs.set(ref, { key, expiresAt: Date.now() + expiresIn * 1000 });
      return `/object/sign/photos/${key.split('/').map(encodeURIComponent).join('/')}?token=${ref}`;
    };

    if (rest) return sendJson(req, res, 200, { signedURL: signOne(rest) });
    const paths = Array.isArray(body.paths) ? body.paths : [];
    const answer = paths.map((key) =>
      objects.has(key)
        ? { path: key, signedURL: signOne(key) }
        : { path: key, error: 'Object not found' },
    );
    return sendJson(req, res, 200, answer);
  }

  // GET /storage/v1/object/sign/photos/<key>?token=… — signed download.
  // `<img>` requests carry no Authorization header; the opaque token is the
  // credential, exactly like a real signed URL.
  if (req.method === 'GET' && pathname.startsWith('/storage/v1/object/sign/photos/')) {
    const key = pathname.slice('/storage/v1/object/sign/photos/'.length);
    const ref = url.searchParams.get('token');
    const hit = ref ? signedRefs.get(ref) : null;
    if (!hit || hit.key !== key || hit.expiresAt < Date.now()) {
      return sendJson(req, res, 400, { statusCode: '400', error: 'InvalidSignature', message: 'invalid signature' });
    }
    const object = objects.get(key);
    if (!object) {
      return sendJson(req, res, 400, { statusCode: '404', error: 'NotFound', message: 'Object not found' });
    }
    return sendBinary(req, res, 200, object.body, object.contentType);
  }

  // DELETE /storage/v1/object/photos — remove objects by prefix.
  if (req.method === 'DELETE' && pathname === '/storage/v1/object/photos') {
    const token = bearerToken(req);
    const userId = token ? (accessTokens.get(token) ?? null) : null;
    if (!userId) {
      return sendJson(req, res, 400, { statusCode: '401', error: 'Unauthorized', message: 'Invalid JWT' });
    }
    const body = await readJson(req);
    const prefixes = Array.isArray(body.prefixes) ? body.prefixes : [];
    const removed = [];
    for (const key of prefixes) {
      objects.delete(key);
      overlayFor(token).removals.push({ key });
      removed.push({ name: key, bucket_id: 'photos' });
    }
    return sendJson(req, res, 200, removed);
  }

  return sendJson(req, res, 404, { statusCode: '404', error: 'NotFound', message: `No mock route: ${req.method} ${pathname}` });
}

/* -------------------------------- mock API ------------------------------- */

async function handleMock(req, res, url) {
  const path = url.pathname;

  if (path === '/__mock/health') return sendJson(req, res, 200, { ok: true });

  // Mint a session for a fixture user, like the token an invite email carries.
  if (req.method === 'POST' && path === '/__mock/token') {
    const body = await readJson(req);
    const user = findUserByEmail(body.email);
    if (!user) return sendJson(req, res, 404, { error: `Unknown fixture: ${body.email}` });
    return sendJson(req, res, 200, mintSession(user));
  }

  // Inspect mutable state (assertions, e.g. "language was persisted to the profile").
  if (req.method === 'GET' && path === '/__mock/state') {
    const user = findUserByEmail(url.searchParams.get('email'));
    if (!user) return sendJson(req, res, 404, { error: 'Unknown fixture' });
    return sendJson(req, res, 200, {
      id: user.id,
      email: user.email,
      passwordSet: user.password != null,
      profile: user.profile ? { id: user.id, email: user.email, ...user.profile } : null,
      branchAccess: user.branchAccess,
    });
  }

  /*
   * Everything the account changed through people / deletion_requests /
   * storage, merged across its session overlays (each sign-in starts a fresh
   * overlay; parallel projects sign in separately). Assert with `some`/
   * `find` — another test signed in as the same fixture may run at the same
   * time and legitimately add its own writes.
   */
  if (req.method === 'GET' && path === '/__mock/writes') {
    // Token-scoped view: exactly the writes of one browser session (the app's
    // access token is readable from localStorage) — race-free assertions even
    // while parallel tests run as the same fixture account.
    const tokenParam = url.searchParams.get('token');
    if (tokenParam) {
      const uid = accessTokens.get(tokenParam);
      const tokenUser = uid ? findUserById(uid) : null;
      if (!tokenUser) return sendJson(req, res, 404, { error: 'Unknown session token' });
      const one = overlays.get(tokenParam) ?? {
        people: new Map(),
        audit: [],
        deletionRequests: [],
        inserts: [],
        patches: [],
        uploads: [],
        removals: [],
      };
      return sendJson(req, res, 200, {
        email: tokenUser.email,
        people: [...one.people.values()],
        audit: one.audit,
        deletionRequests: one.deletionRequests,
        inserts: one.inserts,
        patches: one.patches,
        uploads: one.uploads,
        removals: one.removals,
      });
    }

    const user = findUserByEmail(url.searchParams.get('email'));
    if (!user) return sendJson(req, res, 404, { error: 'Unknown fixture' });
    const merged = {
      email: user.email,
      people: [],
      audit: [],
      deletionRequests: [],
      inserts: [],
      patches: [],
      uploads: [],
      removals: [],
    };
    const seen = new Set();
    for (const [token, overlay] of overlays) {
      if (accessTokens.get(token) !== user.id) continue;
      for (const row of overlay.people.values()) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        merged.people.push(row);
      }
      merged.audit.push(...overlay.audit);
      merged.deletionRequests.push(...overlay.deletionRequests);
      merged.inserts.push(...overlay.inserts);
      merged.patches.push(...overlay.patches);
      merged.uploads.push(...overlay.uploads);
      merged.removals.push(...overlay.removals);
    }
    return sendJson(req, res, 200, merged);
  }

  // Make the next N people reads for one account fail — the load-error banner
  // needs a real 500, scoped to a dedicated fixture account so parallel tests
  // can never consume the failure.
  if (req.method === 'POST' && path === '/__mock/fail-people') {
    const body = await readJson(req);
    const email = String(body.email ?? '');
    if (!findUserByEmail(email)) return sendJson(req, res, 404, { error: `Unknown fixture: ${email}` });
    const times = Number(body.times ?? 1);
    failPeopleFor.set(email, times);
    return sendJson(req, res, 200, { email, failing: times });
  }

  return sendJson(req, res, 404, { error: `No mock route: ${req.method} ${path}` });
}

/* --------------------------------- server -------------------------------- */

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
  if (req.method === 'OPTIONS') return sendEmpty(req, res);

  const route = url.pathname.startsWith('/auth/v1/')
    ? handleAuth
    : url.pathname.startsWith('/rest/v1/')
      ? handleRest
      : url.pathname.startsWith('/storage/v1/')
        ? handleStorage
        : url.pathname.startsWith('/__mock/')
          ? handleMock
          : null;

  const done = route
    ? route(req, res, url)
    : sendJson(req, res, 404, { error: `No mock route: ${req.method} ${url.pathname}` });

  Promise.resolve(done).catch((err) => {
    console.error('[mock-supabase] request failed:', err);
    if (!res.headersSent) sendJson(req, res, 500, { error: String(err) });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-supabase] listening on http://${HOST}:${PORT}`);
});
