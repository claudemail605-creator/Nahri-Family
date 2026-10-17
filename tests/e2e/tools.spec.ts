/*
 * Phase 6 tools (extras L1–L4) — the tools modal against the mock fixtures.
 *
 * Coverage:
 *   - the modal opens for any signed-in user (not admin-gated) with the
 *     three reference tabs and the print/PNG actions in the head;
 *   - L1 kinship: the walker names grandson and Phupho and reads the chain
 *     out loud around the common ancestor;
 *   - L2 upcoming: with the clock pinned to 2026-10-17 exactly one fixture
 *     birthday is in window (Dawood, Nov 5), and its goto-person closes the
 *     tools and selects the person on the tree;
 *   - L3 statistics: the bars recount the visible fixture (generations
 *     2/5/2/2/2, gender 6/6/1, places, most children, oldest/youngest);
 *   - L4 print fills the print head and calls window.print (stubbed), and
 *     the PNG downloads a dated file and closes the modal.
 */
import { expect, test, type Page } from '@playwright/test';
import { en } from '../../src/core/i18n/dict.en';
import { signInAs, t } from './helpers';

async function openTools(page: Page): Promise<void> {
  await expect(page.locator('#btn-tools')).toBeVisible();
  await page.locator('#btn-tools').click();
  await expect(page.locator('.extra-modal')).toBeVisible();
  await expect(page.locator('.extra-modal .modal__title')).toHaveText(en['extra.tools']);
}

test('the tools open for any signed-in user with the reference tabs', async ({ page }) => {
  // An editor (not an admin) proves the tools are not admin-gated (L row).
  await signInAs(page, 'editor@example.test');
  await openTools(page);
  for (const [tab, key] of [
    ['related', 'extra.tab.related'],
    ['birthdays', 'extra.tab.birthdays'],
    ['stats', 'extra.tab.stats'],
  ] as Array<['related' | 'birthdays' | 'stats', keyof typeof en]>) {
    await expect(page.locator(`.extra-modal .admin-tab[data-tab="${tab}"]`)).toHaveText(en[key]);
  }
  await expect(page.locator('.extra-modal #ex_print')).toHaveText(en['extra.printPage']);
  await expect(page.locator('.extra-modal #ex_png')).toHaveText(en['extra.printPng']);
});

test('kinship: grandson through the father, Phupho through the chain', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await openTools(page);

  // Dawood → Hamza: the common ancestor IS Dawood; Hamza is 2 below.
  await page.locator('#ex_a').selectOption('person-d');
  await page.locator('#ex_b').selectOption('person-h');
  await page.locator('#ex_go').click();
  await expect(page.locator('.rel-term')).toHaveText(en['kin.grandson']);
  await expect(page.locator('.rel-result')).toContainText(
    t('extra.relatedCommon', { name: 'Dawood Fixture' }),
  );
  await expect(page.locator('.rel-result')).toContainText(
    t('extra.relatedBelow', { name: 'Hamza Fixture', n: 2, root: 'Dawood Fixture' }),
  );
  await expect(page.locator('.rel-chain')).toHaveText('Dawood Fixture → Farid Fixture → Hamza Fixture');

  // Hamza → Gul: father's sister (Phupho) — the branch travels the father.
  await page.locator('#ex_a').selectOption('person-h');
  await page.locator('#ex_b').selectOption('person-g');
  await page.locator('#ex_go').click();
  await expect(page.locator('.rel-term')).toHaveText(en['kin.fathersSister']);
  await expect(page.locator('.rel-result')).toContainText(
    t('extra.relatedCommon', { name: 'Dawood Fixture' }),
  );
  await expect(page.locator('.rel-chain')).toHaveText(
    'Hamza Fixture → Farid Fixture → Dawood Fixture → Gul Fixture',
  );
});

test('upcoming: one birthday in window; its goto-person selects the tree person', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  // Pin the clock so the 30-day window is deterministic forever (the app
  // reads `new Date()` when the list is built).
  await page.clock.setFixedTime(new Date('2026-10-17T12:00:00Z'));
  await openTools(page);
  await page.locator('.extra-modal .admin-tab[data-tab="birthdays"]').click();

  const rows = page.locator('.extra-modal .upcoming-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.locator('.upcoming-when')).toHaveText(t('extra.inDays', { n: 19 }));
  await expect(rows.locator('.upcoming-who')).toHaveText('Dawood Fixture');
  await expect(rows.locator('.upcoming-extra')).toHaveText(
    `${t('extra.birthdayTurns', { age: 76 })} · 05/11`,
  );

  // Clicking the name closes the tools and selects that person on the tree.
  await rows.locator('.upcoming-who').click();
  await expect(page.locator('.extra-modal')).toHaveCount(0);
  await expect(page.locator('#details .p-name')).toHaveText('Dawood Fixture');
});

test('statistics: the bars recount the visible fixture', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await page.clock.setFixedTime(new Date('2026-10-17T12:00:00Z'));
  await openTools(page);
  await page.locator('.extra-modal .admin-tab[data-tab="stats"]').click();
  const dialog = page.locator('.extra-modal');

  // Generations 0..4 hold 2/5/2/2/2 visible people.
  const genBlock = dialog.locator('.stat-block', { hasText: en['extra.statsByGen'] });
  await expect(genBlock.locator('.bar-row')).toHaveCount(5);
  await expect(genBlock.locator('.bar-row').nth(0).locator('.bar-value')).toHaveText('2');
  await expect(genBlock.locator('.bar-row').nth(1).locator('.bar-value')).toHaveText('5');
  await expect(genBlock.locator('.bar-row').nth(3).locator('.bar-value')).toHaveText('2');

  // Gender split 6 / 6 / 1 (Jamal has no gender on record).
  const genderBlock = dialog.locator('.stat-block', { hasText: en['extra.statsGender'] });
  const genderValues = genderBlock.locator('.bar-value');
  await expect(genderValues).toHaveText(['6', '6', '1']);

  // Oldest (Laila, 1900) / youngest (Inaya, 2008) at the pinned clock.
  const ageBlock = dialog.locator('.stat-block', {
    hasText: `${en['extra.statsOldest']} / ${en['extra.statsYoungest']}`,
  });
  await expect(ageBlock).toContainText('Laila Fixture');
  await expect(ageBlock).toContainText(t('extra.statsAge', { n: 126 }));
  await expect(ageBlock).toContainText('Inaya Fixture');
  await expect(ageBlock).toContainText(t('extra.statsAge', { n: 17 }));

  // Places and children: Fixtureabad twice, Karachi once.
  const placeBlock = dialog.locator('.stat-block', { hasText: en['extra.statsPlaces'] });
  await expect(placeBlock.locator('.bar-row')).toHaveCount(2);
  await expect(placeBlock.locator('.bar-row').nth(0).locator('.bar-value')).toHaveText('2');
  await expect(placeBlock.locator('.bar-row').nth(1).locator('.bar-value')).toHaveText('1');
  await expect(placeBlock).toContainText('Fixtureabad');
  await expect(placeBlock).toContainText('Karachi');
  const childBlock = dialog.locator('.stat-block', { hasText: en['extra.statsChildren'] });
  const topChildRow = childBlock.locator('.upcoming-row').first();
  await expect(topChildRow).toContainText('Amir Fixture');
  await expect(topChildRow).toContainText(t('panel.children', { n: 3 }));
});

test('print: fills the print head and calls the print dialog', async ({ page }) => {
  // Stub the native dialog before any app script runs.
  await page.addInitScript(() => {
    (window as unknown as { __printed?: boolean; print(): void }).print = () => {
      (window as unknown as { __printed?: boolean }).__printed = true;
    };
  });
  await signInAs(page, 'admin@example.test');
  await openTools(page);
  await page.locator('#ex_print').click();

  // The modal closes before the print dialog measures the page.
  await expect(page.locator('.extra-modal')).toHaveCount(0);
  await expect.poll(() =>
    page.evaluate(() => (window as unknown as { __printed?: boolean }).__printed === true),
  ).toBe(true);

  const head = await page.locator('#print-head').textContent();
  expect(head).toContain(en['brand.title']);
  // The printed page says where the data came from, in the reader's language.
  expect(head).toContain(t('source.supabase'));
});

test('png: downloads a dated picture of the tree and closes the tools', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await openTools(page);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#ex_png').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^Nahri_Family_Tree_\d{4}-\d{2}-\d{2}\.png$/);
  // The reference closes the modal only on success — mirrored here.
  await expect(page.locator('.extra-modal')).toHaveCount(0);
});
