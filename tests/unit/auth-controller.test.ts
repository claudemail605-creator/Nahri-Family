import type { Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthData, ProfileRow, ProfileUpdate } from '../../src/data/auth';
import {
  createAuthController,
  type AuthController,
} from '../../src/features/auth/controller';

/*
 * The controller is exercised against a scriptable fake of AuthData: no
 * DOM, no network. Each test controls sessions, profile rows, branch access
 * and failures, then asserts the observable state transitions.
 */

function makeSession(id: string): Session {
  return {
    access_token: `token-${id}`,
    refresh_token: `refresh-${id}`,
    expires_in: 3600,
    expires_at: 4_000_000_000,
    token_type: 'bearer',
    user: { id, email: `${id}@example.test` },
  } as unknown as Session;
}

function makeProfile(id: string, overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id,
    email: `${id}@example.test`,
    full_name: `User ${id}`,
    role: 'editor',
    active: true,
    language: 'en',
    ...overrides,
  };
}

interface FakeAuthData {
  data: AuthData;
  session: Session | null;
  profiles: Map<string, ProfileRow | null>;
  branch: Map<string, string[]>;
  signInCalls: Array<{ email: string; password: string }>;
  resetCalls: Array<{ email: string; redirectTo: string }>;
  setPasswordCalls: string[];
  updateCalls: Array<{ userId: string; fields: ProfileUpdate }>;
  signOutCalls: number;
  profileReads: number;
  branchReads: number;
  /** Set by tests to control sign-ins, reads and the session endpoint. */
  signInImpl: (email: string, password: string) => Promise<void>;
  loadProfileImpl: ((userId: string) => Promise<ProfileRow | null>) | null;
  getSessionImpl: (() => Promise<Session | null>) | null;
  emit(event: string, session: Session | null): void;
  setSession(session: Session | null): void;
}

function createFakeData(): FakeAuthData {
  const listeners = new Set<(event: string, session: Session | null) => void>();
  const fake: FakeAuthData = {
    session: null,
    profiles: new Map(),
    branch: new Map(),
    signInCalls: [],
    resetCalls: [],
    setPasswordCalls: [],
    updateCalls: [],
    signOutCalls: 0,
    profileReads: 0,
    branchReads: 0,
    signInImpl: async (email, password) => {
      if (password === 'wrong') throw new Error('Invalid login credentials');
      fake.session = makeSession(email.split('@')[0]!);
    },
    loadProfileImpl: null,
    getSessionImpl: null,
    emit(event, session) {
      for (const listener of [...listeners]) listener(event, session);
    },
    setSession(session) {
      fake.session = session;
    },
    data: {
      getSession: async () => (fake.getSessionImpl ? fake.getSessionImpl() : fake.session),
      signIn: async (email, password) => {
        fake.signInCalls.push({ email, password });
        await fake.signInImpl(email, password);
      },
      signOut: async () => {
        fake.signOutCalls += 1;
        fake.session = null;
        fake.emit('SIGNED_OUT', null);
      },
      requestPasswordReset: async (email, redirectTo) => {
        fake.resetCalls.push({ email, redirectTo });
      },
      setPassword: async (password) => {
        fake.setPasswordCalls.push(password);
      },
      loadProfile: async (userId) => {
        fake.profileReads += 1;
        if (fake.loadProfileImpl) return fake.loadProfileImpl(userId);
        return fake.profiles.get(userId) ?? null;
      },
      loadBranchAccess: async (userId) => {
        fake.branchReads += 1;
        return fake.branch.get(userId) ?? [];
      },
      updateProfile: async (userId, fields) => {
        fake.updateCalls.push({ userId, fields });
        const row = fake.profiles.get(userId);
        if (row) fake.profiles.set(userId, { ...row, ...fields });
      },
      onAuthStateChange: (callback) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    },
  };
  return fake;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeController(
  fake: FakeAuthData,
  overrides: Partial<Parameters<typeof createAuthController>[0]> = {},
): { auth: AuthController; stripUrlParams: ReturnType<typeof vi.fn> } {
  const stripUrlParams = vi.fn();
  const auth = createAuthController({
    data: fake.data,
    link: { type: null, error: null },
    redirectTo: 'https://app.example.test/',
    stripUrlParams,
    ...overrides,
  });
  return { auth, stripUrlParams };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('createAuthController() — session lifecycle', () => {
  it('starts in loading and settles to sign-in without a session', async () => {
    const fake = createFakeData();
    const { auth } = makeController(fake);
    expect(auth.getState().status).toBe('loading');
    await flush();
    expect(auth.getState().status).toBe('sign-in');
    expect(auth.getState().session).toBeNull();
    auth.dispose();
  });

  it('treats a getSession timeout as no session', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = createFakeData();
    fake.getSessionImpl = () => new Promise(() => {});
    const { auth } = makeController(fake);
    expect(auth.getState().status).toBe('loading');
    await vi.advanceTimersByTimeAsync(6000);
    expect(auth.getState().status).toBe('sign-in');
    auth.dispose();
  });

  it('signs in, loads the profile and reaches ready, reporting the profile', async () => {
    const fake = createFakeData();
    fake.profiles.set('admin', makeProfile('admin', { role: 'admin', full_name: 'Family Admin' }));
    const { auth } = makeController(fake);
    const profiles: ProfileRow[] = [];
    auth.onProfileChange((p) => profiles.push(p));
    await flush();

    await auth.signIn('admin@example.test', 'secret');
    await flush();

    expect(fake.signInCalls).toEqual([{ email: 'admin@example.test', password: 'secret' }]);
    expect(auth.getState().status).toBe('ready');
    expect(auth.getState().profile?.full_name).toBe('Family Admin');
    expect(auth.isAdmin()).toBe(true);
    expect(profiles.map((p) => p.id)).toEqual(['admin']);
    auth.dispose();
  });

  it('rejects failed sign-ins and stays on the sign-in screen', async () => {
    const fake = createFakeData();
    const { auth } = makeController(fake);
    await flush();
    await expect(auth.signIn('admin@example.test', 'wrong')).rejects.toThrow(
      'Invalid login credentials',
    );
    expect(auth.getState().status).toBe('sign-in');
    auth.dispose();
  });

  it('signs out quietly with a notice when the profile is inactive', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = createFakeData();
    fake.profiles.set('gone', makeProfile('gone', { active: false }));
    fake.setSession(makeSession('gone'));
    const { auth } = makeController(fake);
    await flush();
    expect(fake.signOutCalls).toBe(1);
    expect(auth.getState().notice).toBe('auth.notActive');
    expect(auth.getState().status).toBe('sign-in');
    auth.dispose();
  });

  it('treats a missing profile row the same as an inactive account', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = createFakeData();
    fake.setSession(makeSession('nobody'));
    const { auth } = makeController(fake);
    await flush();
    expect(fake.signOutCalls).toBe(1);
    expect(auth.getState().notice).toBe('auth.notActive');
    auth.dispose();
  });

  it('surfaces a profile read failure with a retry that can succeed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = createFakeData();
    fake.setSession(makeSession('u1'));
    fake.loadProfileImpl = () => Promise.reject(new Error('network down'));
    const { auth } = makeController(fake);
    await flush();
    expect(auth.getState().status).toBe('verifying');
    expect(auth.getState().profileError).toBe('network down');

    fake.loadProfileImpl = () => Promise.resolve(makeProfile('u1'));
    auth.retryProfile();
    await flush();
    expect(auth.getState().status).toBe('ready');
    expect(auth.getState().profileError).toBeNull();
    auth.dispose();
  });

  it('discards a stale profile read when the session changes', async () => {
    const fake = createFakeData();
    let resolveA: (row: ProfileRow | null) => void = () => {};
    fake.loadProfileImpl = (userId) => {
      if (userId === 'userA') return new Promise((resolve) => (resolveA = resolve));
      return Promise.resolve(makeProfile(userId, { full_name: 'User B' }));
    };
    fake.setSession(makeSession('userA'));
    const { auth } = makeController(fake);
    await flush(); // userA read now in flight

    fake.emit('SIGNED_IN', makeSession('userB'));
    await flush();
    expect(auth.getState().profile?.full_name).toBe('User B');

    resolveA(makeProfile('userA', { full_name: 'Stale A' }));
    await flush();
    expect(auth.getState().profile?.full_name).toBe('User B');
    auth.dispose();
  });

  it('keeps the profile on a same-user token refresh without re-reading it', async () => {
    const fake = createFakeData();
    fake.profiles.set('u1', makeProfile('u1'));
    fake.setSession(makeSession('u1'));
    const { auth } = makeController(fake);
    await flush();
    expect(auth.getState().status).toBe('ready');
    expect(fake.profileReads).toBe(1);

    fake.emit('TOKEN_REFRESHED', makeSession('u1'));
    await flush();
    expect(auth.getState().status).toBe('ready');
    expect(fake.profileReads).toBe(1);
    auth.dispose();
  });

  it('clears the session and profile on sign-out', async () => {
    const fake = createFakeData();
    fake.profiles.set('u1', makeProfile('u1'));
    fake.setSession(makeSession('u1'));
    const { auth } = makeController(fake);
    await flush();
    expect(auth.getState().status).toBe('ready');

    await auth.signOut();
    expect(auth.getState().status).toBe('sign-in');
    expect(auth.getState().profile).toBeNull();
    expect(auth.getState().session).toBeNull();
    auth.dispose();
  });
});

describe('createAuthController() — links', () => {
  it('shows the expired-link notice from the URL', async () => {
    const fake = createFakeData();
    const { auth } = makeController(fake, {
      link: { type: null, error: 'otp_expired' },
    });
    await flush();
    expect(auth.getState().notice).toBe('auth.linkExpired');
    expect(auth.getState().pendingLink).toBeNull();
    auth.dispose();
  });

  it('keeps the set-password form up for an invite link, even when the profile loads', async () => {
    const fake = createFakeData();
    fake.profiles.set('inv', makeProfile('inv', { active: false }));
    fake.setSession(makeSession('inv'));
    const { auth } = makeController(fake, { link: { type: 'invite', error: null } });
    await flush();
    expect(auth.getState().status).toBe('set-password');
    expect(auth.getState().pendingLink).toBe('invite');
    expect(fake.signOutCalls).toBe(0); // an inactive invitee is NOT signed out yet
    auth.dispose();
  });

  it('turns the PASSWORD_RECOVERY event into a recovery link', async () => {
    const fake = createFakeData();
    const { auth } = makeController(fake);
    await flush();
    fake.emit('PASSWORD_RECOVERY', makeSession('u1'));
    await flush();
    expect(auth.getState().pendingLink).toBe('recovery');
    expect(auth.getState().status).toBe('set-password');
    auth.dispose();
  });

  it('validates sentinels, then clears the link and strips the URL params', async () => {
    const fake = createFakeData();
    fake.profiles.set('inv', makeProfile('inv', { active: true }));
    fake.setSession(makeSession('inv'));
    const { auth, stripUrlParams } = makeController(fake, {
      link: { type: 'invite', error: null },
    });
    await flush();

    await expect(auth.setNewPassword('short', 'short')).rejects.toThrow('PASSWORD_TOO_SHORT');
    await expect(auth.setNewPassword('long-enough', 'different')).rejects.toThrow(
      'PASSWORD_MISMATCH',
    );
    expect(fake.setPasswordCalls).toEqual([]);

    await auth.setNewPassword('long-enough', 'long-enough');
    await flush();
    expect(fake.setPasswordCalls).toEqual(['long-enough']);
    expect(stripUrlParams).toHaveBeenCalledOnce();
    expect(auth.getState().pendingLink).toBeNull();
    expect(auth.getState().status).toBe('ready');
    auth.dispose();
  });

  it('gives an inactive invitee the not-active notice after the password is set', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = createFakeData();
    fake.profiles.set('inv', makeProfile('inv', { active: false }));
    fake.setSession(makeSession('inv'));
    const { auth } = makeController(fake, { link: { type: 'invite', error: null } });
    await flush();
    expect(auth.getState().status).toBe('set-password');

    await auth.setNewPassword('long-enough', 'long-enough');
    await flush();
    expect(fake.signOutCalls).toBe(1);
    expect(auth.getState().notice).toBe('auth.notActive');
    auth.dispose();
  });

  it('clears the notice on request (forgot-password view)', async () => {
    const fake = createFakeData();
    const { auth } = makeController(fake, { link: { type: null, error: 'otp_expired' } });
    await flush();
    expect(auth.getState().notice).toBe('auth.linkExpired');
    auth.clearNotice();
    expect(auth.getState().notice).toBeNull();
    auth.dispose();
  });

  it('forwards password-reset requests with the redirect target', async () => {
    const fake = createFakeData();
    const { auth } = makeController(fake);
    await flush();
    await auth.requestPasswordReset('someone@example.test');
    expect(fake.resetCalls).toEqual([
      { email: 'someone@example.test', redirectTo: 'https://app.example.test/' },
    ]);
    auth.dispose();
  });
});

describe('createAuthController() — profile updates and permissions', () => {
  it('writes the profile, re-reads it and reports the change', async () => {
    const fake = createFakeData();
    fake.profiles.set('ed', makeProfile('ed'));
    fake.setSession(makeSession('ed'));
    const { auth } = makeController(fake);
    const changes: ProfileRow[] = [];
    auth.onProfileChange((p) => changes.push(p));
    await flush();

    await auth.updateProfile({ full_name: 'New Name', language: 'ur' });
    await flush();

    expect(fake.updateCalls).toEqual([
      { userId: 'ed', fields: { full_name: 'New Name', language: 'ur' } },
    ]);
    expect(auth.getState().profile?.full_name).toBe('New Name');
    expect(auth.getState().profile?.language).toBe('ur');
    expect(changes.at(-1)?.full_name).toBe('New Name');
    auth.dispose();
  });

  it('refuses profile writes without a session', async () => {
    const fake = createFakeData();
    const { auth } = makeController(fake);
    await flush();
    await expect(auth.updateProfile({ full_name: 'x' })).rejects.toThrow('Not signed in.');
    auth.dispose();
  });

  it('loads branch access for editors and mirrors can_edit_person', async () => {
    const fake = createFakeData();
    fake.profiles.set('ed', makeProfile('ed', { role: 'editor' }));
    fake.branch.set('ed', ['p-anchor']);
    fake.setSession(makeSession('ed'));
    const { auth } = makeController(fake);
    await flush();

    expect(auth.isActiveEditor()).toBe(true);
    expect(auth.getState().branchAccess).toEqual(['p-anchor']);
    expect(auth.canEditPerson('p2', ['p-root', 'p-anchor', 'p2'])).toBe(true);
    expect(auth.canEditPerson('p3', ['p-root', 'p3'])).toBe(false);
    auth.dispose();
  });

  it('lets admins edit anyone and non-editors no one', async () => {
    const fake = createFakeData();
    fake.profiles.set('admin', makeProfile('admin', { role: 'admin' }));
    fake.profiles.set('viewer', makeProfile('viewer', { role: 'viewer' }));
    fake.setSession(makeSession('admin'));
    const admin = makeController(fake).auth;
    await flush();
    expect(admin.canEditPerson('anyone', ['x'])).toBe(true);
    admin.dispose();

    fake.setSession(makeSession('viewer'));
    const viewer = makeController(fake).auth;
    await flush();
    expect(viewer.getState().status).toBe('ready');
    expect(viewer.canEditPerson('anyone', ['x'])).toBe(false);
    viewer.dispose();
  });
});

describe('createAuthController() — bootstrap failure', () => {
  it('reports unavailable when there is no data client', () => {
    const auth = createAuthController({
      data: null,
      link: { type: null, error: null },
      redirectTo: 'https://app.example.test/',
      stripUrlParams: () => {},
    });
    expect(auth.getState().status).toBe('unavailable');
    expect(auth.getState().failureReason).toBeTruthy();
    auth.dispose();
  });

  it('reports the provided failure reason first', () => {
    const auth = createAuthController({
      data: null,
      link: { type: null, error: null },
      redirectTo: 'https://app.example.test/',
      stripUrlParams: () => {},
      failureReason: 'SUPABASE_URL points at a dashboard page',
    });
    expect(auth.getState().status).toBe('unavailable');
    expect(auth.getState().failureReason).toContain('dashboard');
    auth.dispose();
  });
});
