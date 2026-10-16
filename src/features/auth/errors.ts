import type { I18n } from '../../core/i18n';

/** Best-effort human message from any thrown value. */
export function extractMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object') {
    const obj = err as { message?: unknown; error_description?: unknown };
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.error_description === 'string' && obj.error_description) return obj.error_description;
  }
  return String(err);
}

/**
 * Map raw GoTrue / supabase-js errors to friendly translated messages.
 * Ported regex-for-regex from the reference `friendlySignInError()`.
 */
export function friendlyAuthError(err: unknown, i18n: I18n): string {
  const msg = extractMessage(err);
  if (/invalid login credentials|invalid_grant|invalid password/i.test(msg)) {
    return i18n.t('auth.signInFailed');
  }
  if (/email not confirmed|not confirmed/i.test(msg)) return i18n.t('auth.notConfirmed');
  if (/too many requests|rate limit|over_email_send_rate/i.test(msg)) return i18n.t('auth.tooMany');
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return i18n.t('auth.network');
  if (/not active/i.test(msg)) return i18n.t('auth.notActive');
  return i18n.fmt('auth.signInError', { msg });
}
