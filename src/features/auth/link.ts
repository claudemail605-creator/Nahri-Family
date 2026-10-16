/**
 * Invite / password-recovery link handling.
 *
 * Supabase puts the auth parameters in the URL hash
 * (#access_token=…&type=invite) or, with PKCE, in the query string
 * (?type=recovery&code=…). The parameters are captured BEFORE the Supabase
 * client consumes and strips them, so the UI can still show the
 * "set your password" form after the hash is gone.
 */

export type AuthLinkType = 'invite' | 'recovery' | 'signup';

export interface AuthLinkInfo {
  /** Link type from the URL, lower-cased, or null. */
  type: AuthLinkType | string | null;
  /** error_code / error parameter (e.g. "otp_expired"), or null. */
  error: string | null;
}

export interface LocationLike {
  hash: string;
  search: string;
}

export interface Windowish {
  location: LocationLike & { pathname: string; origin: string; href: string };
  history: { replaceState(data: unknown, title: string, url: string): void };
}

export function readAuthLink(location: LocationLike): AuthLinkInfo {
  const raw = (location.hash || '').replace(/^#/, '') || (location.search || '').replace(/^\?/, '');
  const params = new URLSearchParams(raw);
  return {
    type: (params.get('type') || '').toLowerCase() || null,
    error: params.get('error_code') || params.get('error') || null,
  };
}

export function isLinkType(type: string | null | undefined): type is AuthLinkType {
  return type === 'invite' || type === 'recovery' || type === 'signup';
}

/** An expired / invalid email link lands in the URL as error_code=otp_expired etc. */
export function isExpiredLinkError(error: string | null | undefined): boolean {
  return !!error && /otp|token|expired|invalid/i.test(error);
}

/** The page URL to return to after an email link (reset / invite). */
export function currentPageUrl(win: Windowish): string {
  const { origin, pathname, href } = win.location;
  if (origin && origin !== 'null') return origin + pathname;
  return href.split(/[?#]/)[0] ?? href;
}

/** Drop ?type=… / #access_token=… from the address bar (after a password is set). */
export function stripAuthParams(win: Windowish): void {
  if (!win.location.hash && !win.location.search) return;
  try {
    win.history.replaceState(null, '', win.location.pathname);
  } catch {
    /* history unavailable — the URL keeps its parameters */
  }
}
