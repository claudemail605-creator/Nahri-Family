import type { Session } from '@supabase/supabase-js';
import { canEditPerson as canEditPersonCore } from '../../core/permissions';
import type { AuthData, ProfileRow, ProfileUpdate } from '../../data/auth';
import { extractMessage } from './errors';
import { isExpiredLinkError, isLinkType, type AuthLinkInfo } from './link';

/**
 * Authentication state machine — the reference app's `window.Auth` object
 * rewritten as a self-contained controller with an observable state.
 *
 * The rules, ported one by one from the reference (js/auth.js):
 *   - the app is unusable until an ACTIVE profile is signed in;
 *   - an invite / recovery link keeps the set-password form up even though the
 *     link itself already signed the user in;
 *   - an expired link shows a notice above the sign-in form;
 *   - a signed-in user whose profile row is missing or `active = false` is
 *     signed out quietly with the "not active" notice;
 *   - `getSession()` is guarded by a timeout because the endpoint can hang;
 *   - a successful sign-in re-reads the session instead of waiting for
 *     `onAuthStateChange` (which is not guaranteed to fire in the same tick).
 *
 * Everything asynchronous that could outlive a session change is guarded by
 * `applySeq`: a profile response that arrives after the user switched (or
 * signed out) is discarded instead of overwriting the newer state.
 */

export type AuthStatus =
  | 'loading' // before the stored session has settled
  | 'sign-in' // no usable session — show the sign-in form
  | 'verifying' // session present, profile not confirmed yet
  | 'set-password' // invite / recovery link — choose a password first
  | 'ready' // active profile signed in — unlock the app
  | 'unavailable'; // the Supabase client itself is unusable

export type AuthNotice = 'auth.linkExpired' | 'auth.notActive';

export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  profile: ProfileRow | null;
  /** Anchor people this editor may edit (branch_access.person_id). */
  branchAccess: readonly string[];
  /** 'invite' | 'recovery' | 'signup' while the set-password form must stay up. */
  pendingLink: string | null;
  /** Message shown above the sign-in form. */
  notice: AuthNotice | null;
  /** Set when the Supabase client could not be created at all. */
  failureReason: string | null;
  /** Message of the last failed profile read (offers a retry). */
  profileError: string | null;
}

export interface AuthControllerOptions {
  /** Data access; null when the Supabase client could not be created. */
  data: AuthData | null;
  /** Auth-link parameters captured from the URL before supabase-js consumed them. */
  link: AuthLinkInfo;
  /** Where password-reset emails return to. */
  redirectTo: string;
  /** Drops ?code= / #access_token=… from the address bar after a password is set. */
  stripUrlParams: () => void;
  /** Reason to start in the `unavailable` state (client creation failed). */
  failureReason?: string | null;
  /** Session guard; the reference used 6000 ms. */
  sessionTimeoutMs?: number;
}

export interface AuthController {
  getState(): AuthState;
  isAdmin(): boolean;
  isActiveEditor(): boolean;
  /** Mirrors public.can_edit_person() — UI-only; RLS enforces the real rule. */
  canEditPerson(personId: string, personPath: readonly string[] | null | undefined): boolean;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  /**
   * Set a password from an invite / recovery link. Rejects with the sentinel
   * messages `PASSWORD_TOO_SHORT` / `PASSWORD_MISMATCH` (reference behaviour).
   */
  setNewPassword(password: string, confirm: string): Promise<void>;
  updateProfile(fields: ProfileUpdate): Promise<void>;
  /** Re-read the profile after a failed read. */
  retryProfile(): void;
  /** Dismiss the gate notice (used when opening the forgot-password form). */
  clearNotice(): void;
  onStateChange(fn: (state: AuthState) => void): () => void;
  onProfileChange(fn: (profile: ProfileRow) => void): () => void;
  dispose(): void;
}

function initialState(link: AuthLinkInfo, failureReason: string | null): AuthState {
  const state: AuthState = {
    status: 'loading',
    session: null,
    profile: null,
    branchAccess: [],
    pendingLink: null,
    notice: null,
    failureReason,
    profileError: null,
  };
  // An expired / invalid email link lands in the URL as error_code=otp_expired.
  if (link.error && isExpiredLinkError(link.error)) {
    state.notice = 'auth.linkExpired';
  } else if (isLinkType(link.type)) {
    state.pendingLink = link.type;
  }
  return state;
}

export function createAuthController(options: AuthControllerOptions): AuthController {
  const { data, redirectTo } = options;
  const sessionTimeoutMs = options.sessionTimeoutMs ?? 6000;

  let state = initialState(options.link, options.failureReason ?? (data ? null : 'Supabase client unavailable.'));
  let disposed = false;
  let sessionSettled = false;
  let profileFresh = false;
  let profileInFlight = false;
  let getSessionTimer: ReturnType<typeof setTimeout> | null = null;
  let applySeq = 0;
  let unsubscribeAuth: (() => void) | null = null;
  const stateListeners = new Set<(state: AuthState) => void>();
  const profileListeners = new Set<(profile: ProfileRow) => void>();

  function computeStatus(): AuthStatus {
    if (state.failureReason) return 'unavailable';
    if (!sessionSettled) return 'loading';
    if (state.pendingLink) return 'set-password';
    if (state.session && state.profile?.active) return 'ready';
    if (state.session) return 'verifying';
    return 'sign-in';
  }

  function emit(): void {
    if (disposed) return;
    state = { ...state, status: computeStatus() };
    const snapshot = state;
    for (const fn of [...stateListeners]) fn(snapshot);
  }

  function patch(fields: Partial<AuthState>): void {
    state = { ...state, ...fields };
    emit();
  }

  function emitProfile(profile: ProfileRow): void {
    if (disposed) return;
    for (const fn of [...profileListeners]) fn(profile);
  }

  function clearSessionTimer(): void {
    if (getSessionTimer) {
      clearTimeout(getSessionTimer);
      getSessionTimer = null;
    }
  }

  /** Apply a session from getSession() or an onAuthStateChange event. */
  function applySession(session: Session | null): void {
    if (disposed) return;
    clearSessionTimer();
    sessionSettled = true;
    const nextUserId = session?.user?.id ?? null;
    const previousUserId = state.session?.user?.id ?? null;
    if (nextUserId !== previousUserId || !session) {
      // A different user (or a sign-out): drop the previous profile and
      // invalidate any read still in flight for it.
      applySeq++;
      profileFresh = false;
      profileInFlight = false;
      state = { ...state, session, profile: null, branchAccess: [], profileError: null };
    } else {
      // Same user — a token refresh: keep the profile on screen while it is
      // re-checked (no flicker back to the gate).
      state = { ...state, session };
    }
    emit();
    if (session) ensureProfile();
  }

  /** Read the signed-in user's profile row and decide what it means. */
  function ensureProfile(): void {
    if (!data) return;
    if (profileFresh && state.profile) return;
    if (profileInFlight) return;
    const uid = state.session?.user?.id ?? null;
    if (!uid) {
      applySeq++;
      patch({ profile: null, branchAccess: [], profileError: null });
      return;
    }
    profileInFlight = true;
    const seq = ++applySeq;
    data.loadProfile(uid).then(
      (row) => {
        profileInFlight = false;
        if (disposed || seq !== applySeq) return;
        applyProfileRow(row);
      },
      (err) => {
        profileInFlight = false;
        if (disposed || seq !== applySeq) return;
        console.warn('profile read error:', extractMessage(err));
        patch({ profile: null, branchAccess: [], profileError: extractMessage(err) });
      },
    );
  }

  function applyProfileRow(row: ProfileRow | null): void {
    if (!data) return;
    const profile = row && row.id ? row : null;
    // An invite / recovery link keeps the set-password form up even when the
    // account is not active yet — they must choose a password first.
    if (!profile || !profile.active) {
      applySeq++;
      profileFresh = false;
      profileInFlight = false;
      patch({ profile: null, branchAccess: [], profileError: null });
      if (state.pendingLink) return;
      patch({ notice: 'auth.notActive' });
      signOutQuietly();
      return;
    }
    profileFresh = true;
    patch({ profile, profileError: null, notice: null });
    if (profile.role === 'editor') {
      // branch_access is only needed by editors (an admin may edit everything).
      const seq = applySeq;
      data
        .loadBranchAccess(profile.id)
        .then(
          (ids) => {
            if (disposed || seq !== applySeq) return;
            patch({ branchAccess: ids });
            emitProfile(profile);
          },
          (err) => {
            if (disposed || seq !== applySeq) return;
            console.warn('branch_access read error:', extractMessage(err));
            patch({ branchAccess: [] });
            emitProfile(profile);
          },
        );
    } else {
      patch({ branchAccess: [] });
      emitProfile(profile);
    }
  }

  // Sign out without caring about the result (used when an account is not active).
  function signOutQuietly(): void {
    if (!data) return;
    data.signOut().catch((err) => console.warn('sign-out failed:', extractMessage(err)));
  }

  /* ------------------------------ lifecycle ------------------------------ */

  // Resolve the initial status ('unavailable' when no client could be built).
  state = { ...state, status: computeStatus() };

  if (data && !state.failureReason) {
    unsubscribeAuth = data.onAuthStateChange((event, session) => {
      if (disposed) return;
      if (event === 'PASSWORD_RECOVERY' && !state.pendingLink) state = { ...state, pendingLink: 'recovery' };
      applySession(session);
    });

    // getSession() can hang on some projects (the session endpoint can answer
    // with text/plain that the client mishandles) — guard it with a timeout.
    getSessionTimer = setTimeout(() => {
      if (!sessionSettled) {
        console.warn('getSession() did not settle within ' + sessionTimeoutMs + 'ms — assuming no session.');
        applySession(null);
      }
    }, sessionTimeoutMs);
    data.getSession().then(
      (session) => applySession(session),
      (err) => {
        console.warn('getSession error:', extractMessage(err));
        applySession(null);
      },
    );
  }

  /* --------------------------- public interface --------------------------- */

  function isAdmin(): boolean {
    return !!(state.profile && state.profile.role === 'admin' && state.profile.active);
  }

  function isActiveEditor(): boolean {
    return !!(state.profile && state.profile.role === 'editor' && state.profile.active);
  }

  return {
    getState: () => state,

    isAdmin,
    isActiveEditor,

    canEditPerson(_personId, personPath) {
      return canEditPersonCore({
        isAdmin: isAdmin(),
        isActiveEditor: isActiveEditor(),
        branchAccess: state.branchAccess,
        personPath,
      });
    },

    async signIn(email, password) {
      if (!data) throw new Error('Auth not initialized.');
      await data.signIn(email, password);
      // Surface the new session immediately: the app must not stay stuck on
      // the sign-in form until onAuthStateChange fires (parity with the
      // reference's post-signIn getSession call).
      try {
        applySession(await data.getSession());
      } catch (err) {
        console.warn('post-signIn getSession error:', extractMessage(err));
      }
    },

    async signOut() {
      if (!data) throw new Error('Auth not initialized.');
      try {
        await data.signOut();
      } catch (err) {
        console.warn('sign-out failed:', extractMessage(err));
      }
      applySeq++;
      profileFresh = false;
      profileInFlight = false;
      patch({ session: null, profile: null, branchAccess: [], profileError: null });
    },

    async requestPasswordReset(email) {
      if (!data) throw new Error('Auth not initialized.');
      await data.requestPasswordReset(email, redirectTo);
    },

    async setNewPassword(password, confirm) {
      if (!data) throw new Error('Auth not initialized.');
      if (!password || password.length < 8) throw new Error('PASSWORD_TOO_SHORT');
      if (password !== confirm) throw new Error('PASSWORD_MISMATCH');
      await data.setPassword(password);
      // A refresh must not re-open the set-password form.
      options.stripUrlParams();
      applySeq++;
      profileFresh = false;
      profileInFlight = false;
      patch({ pendingLink: null, profile: null, branchAccess: [], profileError: null });
      // Re-read the profile: an invited account is usually still inactive, so
      // this is where the "not active yet" notice comes from.
      ensureProfile();
    },

    async updateProfile(fields) {
      if (!data) throw new Error('Auth not initialized.');
      const uid = state.session?.user?.id ?? null;
      if (!uid) throw new Error('Not signed in.');
      await data.updateProfile(uid, fields);
      profileFresh = false;
      profileInFlight = false;
      ensureProfile();
    },

    retryProfile() {
      profileFresh = false;
      profileInFlight = false;
      applySeq++;
      patch({ profileError: null });
      ensureProfile();
    },

    clearNotice() {
      if (state.notice) patch({ notice: null });
    },

    onStateChange(fn) {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },

    onProfileChange(fn) {
      profileListeners.add(fn);
      return () => profileListeners.delete(fn);
    },

    dispose() {
      disposed = true;
      clearSessionTimer();
      unsubscribeAuth?.();
      unsubscribeAuth = null;
      stateListeners.clear();
      profileListeners.clear();
    },
  };
}
