import { expect, test } from '@playwright/test';
import { en } from '../../src/core/i18n/dict.en';
import { ur } from '../../src/core/i18n/dict.ur';

test('boots the shell in English with no uncaught errors', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/');

  await expect(page.locator('.brand-title')).toHaveText(en['brand.title']);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('.boot-panel__text')).toHaveText(en['generic.loading']);
  await expect(page.locator('#lang-select')).toHaveValue('en');
  await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', 'false');

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
  await page.locator('#lang-select').selectOption('ur');

  await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('.brand-title')).toHaveText(ur['brand.title']);
  await expect(page.locator('.boot-panel__text')).toHaveText(ur['generic.loading']);

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

test('keyboard users can reach the header controls', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator('#lang-select')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#theme-toggle')).toBeFocused();
});
