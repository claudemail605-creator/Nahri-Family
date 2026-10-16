import { describe, expect, it } from 'vitest';
import type { I18n } from '../../src/core/i18n';
import { extractMessage, friendlyAuthError } from '../../src/features/auth/errors';

/** Minimal stub: uses the dictionary key itself so assertions stay readable. */
const i18n = {
  t: (key: string) => `T:${key}`,
  fmt: (key: string, vars: Record<string, unknown> = {}) =>
    `F:${key}:${String(vars.msg ?? '')}`,
} as unknown as I18n;

describe('extractMessage()', () => {
  it('reads Error instances', () => {
    expect(extractMessage(new Error('boom'))).toBe('boom');
  });

  it('reads GoTrue error shapes', () => {
    expect(extractMessage({ message: 'msg here' })).toBe('msg here');
    expect(extractMessage({ error_description: 'desc here' })).toBe('desc here');
  });

  it('falls back to String() for anything else', () => {
    expect(extractMessage('plain')).toBe('plain');
    // Ported behaviour: the reference also ends with String(err).
    expect(extractMessage({})).toBe('[object Object]');
  });
});

describe('friendlyAuthError()', () => {
  it('maps invalid credentials', () => {
    expect(friendlyAuthError(new Error('Invalid login credentials'), i18n)).toBe('T:auth.signInFailed');
    expect(friendlyAuthError({ error_description: 'invalid_grant' }, i18n)).toBe('T:auth.signInFailed');
  });

  it('maps confirmation and rate-limit errors', () => {
    expect(friendlyAuthError(new Error('Email not confirmed'), i18n)).toBe('T:auth.notConfirmed');
    expect(friendlyAuthError(new Error('Too many requests'), i18n)).toBe('T:auth.tooMany');
  });

  it('maps network errors', () => {
    expect(friendlyAuthError(new Error('Failed to fetch'), i18n)).toBe('T:auth.network');
  });

  it('maps an inactive account', () => {
    expect(friendlyAuthError(new Error('User is not active'), i18n)).toBe('T:auth.notActive');
  });

  it('falls back to the templated message', () => {
    expect(friendlyAuthError(new Error('weird'), i18n)).toBe('F:auth.signInError:weird');
  });
});
