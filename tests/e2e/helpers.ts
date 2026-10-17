/*
 * Shared E2E helpers — the sign-in flow, the mock's write journals and the
 * toast assertion, used by the admin and tools specs (and later ones).
 * Everything here assumes the preview build served with the mock Supabase
 * server on 127.0.0.1:54321 (`tests/e2e/playwright.config.ts` wires it up).
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { en } from '../../src/core/i18n/dict.en';

export const PASSWORD = 'test-password-1';
export const MOCK = 'http://127.0.0.1:54321';
export const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

/** fmt against the English dictionary (the previews are en-only). */
export const t = (key: keyof typeof en, params: Record<string, string | number> = {}): string => {
  let out: string = en[key];
  for (const [name, value] of Object.entries(params)) out = out.replace(`{${name}}`, String(value));
  return out;
};

export interface MockWrites {
  email: string;
  people: Array<Record<string, unknown> & { id: string }>;
  audit: Array<{ id: number | string; person_id: string; action: string }>;
  deletionRequests: Array<{ person_id: string; reason: string | null; status: string }>;
  requestPatches: Array<{ id: string; body: Record<string, unknown> }>;
  inserts: Array<{ id: string; values: Record<string, unknown> }>;
  patches: Array<{ id: string; body: Record<string, unknown> }>;
  uploads: Array<{ key: string }>;
  removals: Array<{ key: string }>;
  /** Account-level journals (merged view only). */
  functions: Array<{ caller: string; action: string; body: Record<string, unknown> }>;
  profiles: Array<{ caller: string; id: string; body: Record<string, unknown> }>;
  branches: Array<{ caller: string; op: string; user_id: string; person_id?: string }>;
}

/**
 * The merged view by account email: every overlay of that account plus the
 * account-level journals (function actions, profile patches, branch_access
 * writes). Race-free as long as tests only assert rows they created or match
 * with unique values.
 */
export async function globalWrites(request: APIRequestContext, email: string): Promise<MockWrites> {
  const response = await request.get(`${MOCK}/__mock/writes?email=${encodeURIComponent(email)}`);
  expect(response.ok(), `reading merged writes for ${email}`).toBeTruthy();
  return response.json() as Promise<MockWrites>;
}

export async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#sign-in-form')).toBeVisible();
  await page.locator('#sign-in-email').fill(email);
  await page.locator('#sign-in-password').fill(PASSWORD);
  await page.locator('#sign-in-submit').click();
  await expect(page.locator('#view-tree')).toBeVisible();
}

export async function sessionToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i) ?? '';
      if (!key.includes('auth-token')) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? '') as { access_token?: string } | null;
        if (parsed && typeof parsed.access_token === 'string') return parsed.access_token;
      } catch {
        /* not the session blob */
      }
    }
    return null;
  });
  expect(token).toBeTruthy();
  return token as string;
}

export async function sessionWrites(page: Page, request: APIRequestContext): Promise<MockWrites> {
  const token = await sessionToken(page);
  const response = await request.get(`${MOCK}/__mock/writes?token=${encodeURIComponent(token)}`);
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<MockWrites>;
}

export async function expectToast(page: Page, text: string): Promise<void> {
  await expect(page.locator('#toast-host .toast__message').last()).toHaveText(text);
}
