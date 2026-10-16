import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { en } from '../../src/core/i18n/dict.en';

/*
 * Phase 2 end-to-end coverage, exercised against the mock Supabase server
 * (tests/mock/supabase-server.mjs) — the build under test points at it via
 * `.env.e2e` (`vite build --mode e2e`).
 *
 * Fixture accounts (all @example.test — fictional):
 *   admin@example.test            admin, active
 *   editor@example.test           editor, active, one branch anchor
 *   inactive@example.test         editor, inactive  -> "not active" notice
 *   noprofile@example.test        no profile row    -> "not active" notice
 *   invitee@example.test          active; invite-link flow
 *   inactive-invitee@example.test inactive; invite link then notice
 *   profile@example.test          used by the profile-edit test only
 *   lang@example.test             used by the language-persistence test only
 */
const MOCK = 'http://127.0.0.1:54321';
const PASSWORD = 'test-password-1';

interface MintedSession {
  access_token: string;
  refresh_token: string;
}

async function mintToken(request: APIRequestContext, email: string): Promise<MintedSession> {
  const response = await request.post(`${MOCK}/__mock/token`, { data: { email } });
  expect(response.ok(), `minting a token for ${email}`).toBeTruthy();
  return (await response.json()) as MintedSession;
}

function inviteUrl(session: MintedSession, type = 'invite'): string {
  return `/#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=${type}`;
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await expect(page.locator('#sign-in-form')).toBeVisible();
  await page.locator('#sign-in-email').fill(email);
  await page.locator('#sign-in-password').fill(password);
  await page.locator('#sign-in-submit').click();
}

async function mockState(request: APIRequestContext, email: string): Promise<{
  profile: { full_name: string; language: string; role: string; active: boolean } | null;
  passwordSet: boolean;
}> {
  const response = await request.get(`${MOCK}/__mock/state?email=${encodeURIComponent(email)}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test('signs in as admin, shows the profile, signs out', async ({ page }) => {
  await page.goto('/');
  await signIn(page, 'admin@example.test', PASSWORD);

  await expect(page.locator('#account-chip')).toBeVisible();
  await expect(page.locator('#account-chip .account-chip__name')).toContainText('Family Admin');
  await expect(page.locator('#account-chip .tag--admin')).toHaveText(en['admin.adminTag']);
  await expect(page.locator('#sign-out')).toBeVisible();
  // The gate is gone while the workspace is up.
  await expect(page.locator('#sign-in-form')).toHaveCount(0);

  await page.locator('#sign-out').click();
  await expect(page.locator('#sign-in-form')).toBeVisible();
  await expect(page.locator('#account-chip')).toHaveCount(0);

  // The session really ended — a reload stays on the gate.
  await page.reload();
  await expect(page.locator('#sign-in-form')).toBeVisible();
  await expect(page.locator('#view-host')).toBeHidden();
});

test('shows a friendly message on invalid credentials and allows a retry', async ({ page }) => {
  await page.goto('/');
  await signIn(page, 'editor@example.test', 'not-the-password');

  await expect(page.locator('#sign-in-form .gate-msg--error')).toHaveText(en['auth.signInFailed']);
  await expect(page.locator('#sign-in-submit')).toBeEnabled();
  await expect(page.locator('#view-host')).toBeHidden();
});

test('validates empty fields before calling the server', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#sign-in-form')).toBeVisible();

  await page.locator('#sign-in-submit').click();
  await expect(page.locator('#sign-in-form .gate-msg--error')).toHaveText(en['auth.emailRequired']);

  await page.locator('#sign-in-email').fill('nobody@example.test');
  await page.locator('#sign-in-submit').click();
  await expect(page.locator('#sign-in-form .gate-msg--error')).toHaveText(en['auth.passwordRequired']);
});

test('an inactive account sees the not-active notice and stays locked out', async ({ page }) => {
  await page.goto('/');
  await signIn(page, 'inactive@example.test', PASSWORD);

  await expect(page.locator('#sign-in-form .gate-notice')).toHaveText(en['auth.notActive']);
  await expect(page.locator('#view-host')).toBeHidden();

  // The quiet sign-out must survive a reload.
  await page.reload();
  await expect(page.locator('#sign-in-form')).toBeVisible();
  await expect(page.locator('#view-host')).toBeHidden();
});

test('an account with no profile row gets the same notice', async ({ page }) => {
  await page.goto('/');
  await signIn(page, 'noprofile@example.test', PASSWORD);

  await expect(page.locator('#sign-in-form .gate-notice')).toHaveText(en['auth.notActive']);
  await expect(page.locator('#view-host')).toBeHidden();
});

test('forgot password confirms the request and returns to sign-in', async ({ page }) => {
  await page.goto('/');
  await page.locator('#sign-in-forgot').click();
  await expect(page.locator('#forgot-form')).toBeVisible();

  await page.locator('#forgot-email').fill('admin@example.test');
  await page.locator('#forgot-submit').click();
  await expect(page.locator('#forgot-form .gate-msg--ok')).toHaveText(en['auth.resetSent']);

  await page.locator('#forgot-back').click();
  await expect(page.locator('#sign-in-form')).toBeVisible();
});

test('an expired email link shows the expired-link notice', async ({ page }) => {
  await page.goto(
    '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
  );
  await expect(page.locator('#sign-in-form .gate-notice')).toHaveText(en['auth.linkExpired']);
});

test('an invite link sets a password, enters the app, and the password signs in again', async ({
  page,
  request,
}) => {
  const session = await mintToken(request, 'invitee@example.test');
  await page.goto(inviteUrl(session));

  await expect(page.locator('#set-password-form')).toBeVisible();
  await expect(page.locator('#set-password-form .gate-title')).toHaveText(en['auth.setPasswordInvite']);
  await expect(page.locator('#view-host')).toBeHidden();

  // Too short.
  await page.locator('#set-pw-password').fill('short');
  await page.locator('#set-pw-confirm').fill('short');
  await page.locator('#set-password-submit').click();
  await expect(page.locator('#set-password-form .gate-msg--error')).toHaveText(en['auth.pwTooShort']);

  // Mismatch.
  await page.locator('#set-pw-password').fill('invitee-pass-1');
  await page.locator('#set-pw-confirm').fill('different-pass');
  await page.locator('#set-password-submit').click();
  await expect(page.locator('#set-password-form .gate-msg--error')).toHaveText(en['auth.pwMismatch']);

  // Success — the gate closes and the link parameters leave the address bar.
  await page.locator('#set-pw-confirm').fill('invitee-pass-1');
  await page.locator('#set-password-submit').click();
  await expect(page.locator('#account-chip')).toBeVisible();
  await expect(page.locator('#account-chip .account-chip__name')).toContainText('Invited Active');
  expect(new URL(page.url()).hash).toBe('');
  expect(page.url()).not.toContain('access_token');

  // Sign out and back in with the password that was just chosen.
  await page.locator('#sign-out').click();
  await signIn(page, 'invitee@example.test', 'invitee-pass-1');
  await expect(page.locator('#account-chip')).toBeVisible();
});

test('an inactive invitee ends on the not-active notice after setting a password', async ({
  page,
  request,
}) => {
  const session = await mintToken(request, 'inactive-invitee@example.test');
  await page.goto(inviteUrl(session));

  await expect(page.locator('#set-password-form')).toBeVisible();
  await page.locator('#set-pw-password').fill('invitee-pass-2');
  await page.locator('#set-pw-confirm').fill('invitee-pass-2');
  await page.locator('#set-password-submit').click();

  await expect(page.locator('#sign-in-form .gate-notice')).toHaveText(en['auth.notActive']);
  await expect(page.locator('#view-host')).toBeHidden();
});

test('editing the profile saves the name and the language (RTL) and both persist', async ({
  page,
  request,
}) => {
  const before = await mockState(request, 'profile@example.test');
  const targetLang = before.profile?.language === 'ur' ? 'en' : 'ur';
  const targetDir = targetLang === 'ur' ? 'rtl' : 'ltr';

  await page.goto('/');
  await signIn(page, 'profile@example.test', PASSWORD);
  await expect(page.locator('#account-chip')).toBeVisible();

  await page.locator('#account-chip').click();
  await expect(page.locator('.modal')).toBeVisible();
  await page.locator('#profile-name').fill('Profile Tester Two');
  await page.locator('#profile-language').selectOption(targetLang);
  await page.locator('.modal__actions .btn--accent').click();
  await expect(page.locator('.modal .form-msg')).toHaveText(/\S/);

  // The change reaches the database…
  await expect
    .poll(async () => (await mockState(request, 'profile@example.test')).profile?.language)
    .toBe(targetLang);
  expect((await mockState(request, 'profile@example.test')).profile?.full_name).toBe(
    'Profile Tester Two',
  );
  // …and switches the interface direction.
  await expect(page.locator('html')).toHaveAttribute('dir', targetDir);

  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);

  // Both survive a reload (profile.language wins at boot).
  await page.reload();
  await expect(page.locator('#account-chip .account-chip__name')).toContainText('Profile Tester Two');
  await expect(page.locator('html')).toHaveAttribute('dir', targetDir);
});

test('a header language choice is stored on the profile', async ({ page, request }) => {
  await page.goto('/');
  await signIn(page, 'lang@example.test', PASSWORD);
  await expect(page.locator('#account-chip')).toBeVisible();

  await page.locator('#lang-select').selectOption('hi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await expect
    .poll(async () => (await mockState(request, 'lang@example.test')).profile?.language)
    .toBe('hi');

  await page.reload();
  await expect(page.locator('#lang-select')).toHaveValue('hi');
  await expect(page.locator('#account-chip')).toBeVisible();
});

test('a signed-in session survives a page reload', async ({ page }) => {
  await page.goto('/');
  await signIn(page, 'editor@example.test', PASSWORD);
  await expect(page.locator('#account-chip')).toBeVisible();

  await page.reload();
  await expect(page.locator('#account-chip')).toBeVisible();
  await expect(page.locator('#account-chip .account-chip__name')).toContainText('Branch Editor');
  await expect(page.locator('#sign-in-form')).toHaveCount(0);
});
