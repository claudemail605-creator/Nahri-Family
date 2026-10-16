/*
 * Capture screenshots of the running app for design review.
 *
 * Usage:
 *   1. Start a server:  npm run e2e:server     (build + preview on :4173)
 *   2. node scripts/screenshots.mjs [baseUrl] [outDir]
 *
 * The script sets the stored language/theme before each capture so every
 * combination is exercised through the app's real persistence path.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const baseUrl = process.argv[2] ?? 'http://localhost:4173';
const outDir = process.argv[3] ?? 'screenshots';
mkdirSync(outDir, { recursive: true });

const shots = [
  { name: 'desktop-en-light', lang: 'en', theme: 'light', viewport: { width: 1280, height: 800 } },
  { name: 'desktop-en-dark', lang: 'en', theme: 'dark', viewport: { width: 1280, height: 800 } },
  { name: 'desktop-ur-light', lang: 'ur', theme: 'light', viewport: { width: 1280, height: 800 } },
  { name: 'desktop-ur-dark', lang: 'ur', theme: 'dark', viewport: { width: 1280, height: 800 } },
  { name: 'mobile-en-light', lang: 'en', theme: 'light', viewport: { width: 390, height: 844 } },
  { name: 'mobile-ur-light', lang: 'ur', theme: 'light', viewport: { width: 390, height: 844 } },
];

const browser = await chromium.launch();
for (const shot of shots) {
  const context = await browser.newContext({ viewport: shot.viewport });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.evaluate(
    ([lang, theme]) => {
      localStorage.setItem('nahri.lang', lang);
      localStorage.setItem('nahri.theme', theme);
    },
    [shot.lang, shot.theme],
  );
  await page.reload();
  await page.waitForTimeout(700); // let web fonts settle
  await page.screenshot({ path: join(outDir, `${shot.name}.png`) });
  await context.close();
  console.log(`captured ${shot.name}`);
}
await browser.close();
console.log(`screenshots written to ${outDir}`);
