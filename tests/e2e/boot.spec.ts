import { expect, test } from '@playwright/test';
import { en } from '../../src/core/i18n/dict.en';
import { ur } from '../../src/core/i18n/dict.ur';

test('boots the shell with the sign-in gate and no uncaught errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/');

  await expect(page.locator('.brand-title')).toHaveText(en['brand.title']);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('#lang-select')).toHaveValue('en');
  await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', 'false');

  // Signed out: the gate shows the sign-in form and the workspace stays hidden.
  await expect(page.locator('#sign-in-form')).toBeVisible();
  await expect(page.locator('.gate-title').first()).toHaveText(en['auth.signIn']);
  await expect(page.locator('#view-host')).toBeHidden();

  // The tree canvas host — and everything inside it — stays LTR.
  const canvasDirection = await page
    .locator('#view-host')
    .evaluate((el) => getComputedStyle(el).direction);
  expect(canvasDirection).toBe('ltr');

  expect(pageErrors).toEqual([]);
});

test('language switcher translates the shell, flips direction, keeps the canvas LTR, and persists', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#sign-in-form')).toBeVisible();
  await page.locator('#lang-select').selectOption('ur');

  await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.brand-title')).toHaveText(ur['brand.title']);
  await expect(page.locator('.gate-title').first()).toHaveText(ur['auth.signIn']);

  // The gate follows the document direction; the canvas host does not.
  const gateDirection = await page
    .locator('#gate-host')
    .evaluate((el) => getComputedStyle(el).direction);
  expect(gateDirection).toBe('rtl');
  const canvasDirection = await page
    .locator('#view-host')
    .evaluate((el) => getComputedStyle(el).direction);
  expect(canvasDirection).toBe('ltr');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#lang-select')).toHaveValue('ur');
  await expect(page.locator('.brand-title')).toHaveText(ur['brand.title']);
});

test('theme toggle switches palette and persists', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('a first visit follows the OS dark preference', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await context.close();
});

test('keyboard users move from the focused email field through the gate and back to the header', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#sign-in-email')).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(page.locator('#sign-in-password')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-pw-toggle="sign-in-password"]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#sign-in-submit')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#sign-in-forgot')).toBeFocused();

  // Tab leaves the gate and the keyboard ring returns to the header. Chromium
  // sometimes parks focus on the browser chrome for one press before the wrap,
  // so advance until the first header control receives focus.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    const activeId = await page.evaluate(() => document.activeElement?.id ?? '');
    if (activeId === 'lang-select') break;
  }
  await expect(page.locator('#lang-select')).toBeFocused();
});
