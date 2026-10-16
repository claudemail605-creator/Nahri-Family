/*
 * Mock Supabase for end-to-end tests.
 *
 * Serves just enough of GoTrue and PostgREST for the app's flows: password
 * sign-in / refresh / logout, recover, set-password (PUT /user), profiles +
 * branch_access reads/updates under the same RLS rules the real database
 * enforces, the people / audit_log reads the tree workspace needs, and a
 * couple of /__mock/* helpers for the tests.
 *
 * Fixtures are fictional (example.test) and passwords are plain text — this
 * server only ever handles fake accounts on 127.0.0.1. Tokens are unsigned
 * JWT-shaped strings so supabase-js can decode their payload.
 *
 * Deliberate simplification (documented in docs/TESTING.md): refresh and
 * invite tokens stay valid until the process restarts, so tests need no
 * cleanup between runs.
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

const USERS = [
  makeUser('11111111-1111-4111-8111-111111111111', 'admin@example.test', {
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
];

/* ----------------------------- people fixtures ---------------------------- */

/*
 * A small fictional family for the tree tests — five generations, two roots,
 * a spouse-text pair, a soft-deleted row, unknown gender and a text-only
 * date. None of it resembles real family data; ids are readable slugs so
 * assertions can name a person directly.
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
    created_by: '11111111-1111-4111-8111-111111111111',
    updated_by: '11111111-1111-4111-8111-111111111111',
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
    path: ['11111111-1111-4111-8111-111111111111'],
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
    path: ['11111111-1111-4111-8111-111111111111'],
  }),
  person({
    id: 'person-c',
    full_name: 'Saima Fixture',
    gender: 'Female',
    parent_id: 'person-a',
    dob: '1925-08-20',
    dod: '2010-01-01',
    qualification: 'B.A.',
    path: ['11111111-1111-4111-8111-111111111111'],
  }),
  person({
    id: 'person-j',
    full_name: 'Jamal Fixture',
    parent_id: 'person-a',
    dob_text: 'year unknown',
    path: ['11111111-1111-4111-8111-111111111111'],
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
    path: ['11111111-1111-4111-8111-111111111111'],
  }),
  person({
    id: 'person-e',
    full_name: 'Nadia Fixture',
    gender: 'Female',
    parent_id: 'person-b',
    dob: '1955-02-14',
    name_ur: 'نادیہ',
    name_hi: 'नादिया',
    path: ['11111111-1111-4111-8111-111111111111'],
  }),
  person({
    id: 'person-k',
    full_name: 'Kashif Fixture',
    gender: 'Male',
    parent_id: 'person-b',
    dob: '1958-01-01',
    is_deleted: true,
    path: ['11111111-1111-4111-8111-111111111111'],
  }),
  person({
    id: 'person-f',
    full_name: 'Farid Fixture',
    gender: 'Male',
    parent_id: 'person-d',
    spouse_name: 'Hina Fixture',
    dob: '1975-06-30',
    qualification: 'M.Sc.',
    path: ['11111111-1111-4111-8111-111111111111'],
  }),
  person({
    id: 'person-g',
    full_name: 'Gul Fixture',
    gender: 'Female',
    parent_id: 'person-d',
    dob: '1978-09-09',
    name_ur: 'گل',
    name_hi: 'गुल',
    path: ['11111111-1111-4111-8111-111111111111'],
  }),
  person({
    id: 'person-h',
    full_name: 'Hamza Fixture',
    gender: 'Male',
    parent_id: 'person-f',
    dob: '2005-04-01',
    path: ['11111111-1111-4111-8111-111111111111'],
  }),
  person({
    id: 'person-i',
    full_name: 'Inaya Fixture',
    gender: 'Female',
    parent_id: 'person-f',
    dob: '2008-12-25',
    path: ['11111111-1111-4111-8111-111111111111'],
  }),
  // Second root: a separate branch, so the layout has several root groups.
  person({
    id: 'person-l',
    full_name: 'Laila Fixture',
    gender: 'Female',
    dob: '1900-01-01',
  }),
  person({
    id: 'person-m',
    full_name: 'Mariam Fixture',
    gender: 'Female',
    parent_id: 'person-l',
    spouse_name: 'Iqbal Fixture',
    dob: '1930-04-04',
    dod: '1999-12-31',
  }),
  person({
    id: 'person-n',
    full_name: 'Naveed Fixture',
    gender: 'Male',
    parent_id: 'person-l',
    dob: '1935-07-07',
    dod: '2015-03-03',
  }),
];

const AUDIT_LOG = [
  {
    id: 1,
    person_id: 'person-a',
    changed_by_name: 'Family Admin',
    changed_at: '2026-01-02T10:00:00.000Z',
  },
];

/* ------------------------------- helpers -------------------------------- */

let tokenSeq = 0;
const accessTokens = new Map(); // access token -> user id
const refreshTokens = new Map(); // refresh token -> user id

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

function sendNoContent(req, res, status = 204) {
  cors(req, res);
  res.writeHead(status);
  res.end();
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
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
  return [Math.min(from, Math.max(0, total - 1)), Math.min(to, total - 1)];
}

function bearerUserId(req) {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  return accessTokens.get(match[1]) ?? null;
}

function restError(req, res, status, code, message) {
  sendJson(req, res, status, {
    code,
    details: null,
    hint: null,
    message,
  });
}

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
    return sendNoContent(req, res);
  }

  if (req.method === 'POST' && path === '/auth/v1/recover') {
    // Always the same answer, whether or not the address exists.
    return sendJson(req, res, 200, {});
  }

  return sendJson(req, res, 404, { code: 404, msg: `No mock route: ${req.method} ${path}` });
}

/* ------------------------------- postgrest ------------------------------- */

async function handleRest(req, res, url) {
  const table = url.pathname.replace('/rest/v1/', '');
  const userId = bearerUserId(req);
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
      return sendNoContent(req, res);
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
    const deletedFilter = queryValue('is_deleted');
    let rows = PEOPLE.filter((row) => admin || !row.is_deleted);
    if (deletedFilter === 'false') rows = rows.filter((row) => !row.is_deleted);
    if (deletedFilter === 'true') rows = rows.filter((row) => row.is_deleted);
    rows = sortRows(rows, url.searchParams.get('order'));
    const total = rows.length;
    const [from, to] = rangeFrom(req, total);
    const page = total ? rows.slice(from, to + 1) : [];
    cors(req, res);
    res.setHeader('Content-Range', `${total ? from : 0}-${total ? to : 0}/${total}`);
    return sendJson(req, res, 200, page);
  }

  if (table === 'audit_log' && req.method === 'GET') {
    // RLS: the audit log is admin-readable only.
    if (!user || !user.profile || user.profile.role !== 'admin') {
      return restError(req, res, 403, '42501', 'permission denied for table audit_log');
    }
    const personId = queryValue('person_id');
    let rows = AUDIT_LOG.filter((row) => !personId || row.person_id === personId);
    rows = sortRows(rows, url.searchParams.get('order'));
    const limitRaw = url.searchParams.get('limit');
    if (limitRaw) rows = rows.slice(0, Number(limitRaw));
    return sendJson(req, res, 200, rows);
  }

  return restError(req, res, 404, 'PGRST404', `No mock table: ${table}`);
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
  if (req.method === 'OPTIONS') return sendNoContent(req, res);

  const route = url.pathname.startsWith('/auth/v1/')
    ? handleAuth
    : url.pathname.startsWith('/rest/v1/')
      ? handleRest
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
