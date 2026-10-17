import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { en } from '../../src/core/i18n/dict.en';

/*
 * Phase 3 end-to-end coverage — the tree workspace against the mock Supabase
 * server, whose `people` fixtures are a fictional five-generation family:
 *
 *   13 visible people (14 rows; `person-k` is soft-deleted) in two root
 *   groups, five generations, spouse-text pairs on five people.
 *
 * Accounts: admin@example.test (deleted toggle), editor@example.test
 * (no deleted rows, no toggle), fail@example.test (load-error test only —
 * `/__mock/fail-people` is scoped to that account so parallel tests cannot
 * consume the injected failure).
 */
const PASSWORD = 'test-password-1';
const MOCK = 'http://127.0.0.1:54321';

const t = (key: keyof typeof en, params: Record<string, string | number> = {}): string => {
  let out: string = en[key];
  for (const [name, value] of Object.entries(params)) out = out.replace(`{${name}}`, String(value));
  return out;
};

async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#sign-in-form')).toBeVisible();
  await page.locator('#sign-in-email').fill(email);
  await page.locator('#sign-in-password').fill(PASSWORD);
  await page.locator('#sign-in-submit').click();
  // The workspace toolbar is view-agnostic: admins land on the tree, editors
  // on their branch workspace (Phase 4).
  await expect(page.locator('#view-tree')).toBeVisible();
}

async function waitForTree(page: Page, total = 13): Promise<void> {
  await expect(page.locator('#result-count')).toHaveText(t('table.resultCount.all', { n: total }));
}

/** On phones the sidebar is a drawer; open it before clicking its controls. */
async function openFiltersOnMobile(page: Page, testInfo: TestInfo): Promise<void> {
  if (testInfo.project.name.includes('mobile')) {
    await page.locator('#filters-toggle').click();
  }
}

const worldScale = (page: Page): Promise<number> =>
  page.locator('#tree-world').evaluate((el) => {
    const match = /scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform);
    return match ? Number(match[1]) : Number.NaN;
  });

test('renders the family tree with generation bands and spouse cards', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await waitForTree(page);
  await expect(page.locator('#tree-world .tree-node')).toHaveCount(13);
  // Even generations only (0, 2, 4).
  await expect(page.locator('#tree-world .band')).toHaveCount(3);
  // The canvas fills the workspace down to the viewport edge (guards a flex
  // regression that collapsed the stage to its minimum height on mobile).
  const stage = (await page.locator('#tree-stage').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(stage.y + stage.height).toBeGreaterThanOrEqual(viewport.height - 2);
  await expect(page.locator('.pcard:not([data-spouse])[data-person-id="person-a"]')).toContainText('Amir Fixture');
  // Spouse text is drawn as a card beside the person, not as a tree node.
  await expect(page.locator('.pcard--spouse[data-person-id="person-a"]')).toContainText('Fatima Fixture');
  // The soft-deleted fixture is not drawn by default.
  await expect(page.locator('#tree-world .pcard', { hasText: 'Kashif Fixture' })).toHaveCount(0);
});

test('admin can reveal soft-deleted people', async ({ page }, testInfo) => {
  await signInAs(page, 'admin@example.test');
  await waitForTree(page);
  await openFiltersOnMobile(page, testInfo);
  await page.locator('#show-deleted').check();
  await expect(page.locator('#result-count')).toHaveText(t('table.resultCount.all', { n: 14 }));
  await expect(page.locator('.pcard[data-person-id="person-k"]')).toContainText('Kashif Fixture');
  await page.locator('#show-deleted').uncheck();
  await waitForTree(page);
});

test('editor lands in the branch workspace; the tree still hides deleted people', async ({ page }) => {
  await signInAs(page, 'editor@example.test');

  // Phase 4: a branch-limited editor starts in their guided workspace (K1).
  await expect(page.locator('#branch-host')).toBeVisible();
  await expect(page.locator('#view-branch')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#branch-host .branch-anchor')).toContainText('Amir Fixture');

  // Choosing the tree persists and shows the same family without deleted rows.
  await page.locator('#view-tree').click();
  await waitForTree(page);
  await expect(page.locator('#show-deleted')).toHaveCount(0);
  await expect(page.locator('#tree-world .pcard', { hasText: 'Kashif Fixture' })).toHaveCount(0);
  await expect(page.locator('#tree-world .tree-node')).toHaveCount(13);
});

test('selecting a card opens the details sheet and relatives navigate', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await waitForTree(page);
  await page.locator('.pcard:not([data-spouse])[data-person-id="person-a"]').click();

  const details = page.locator('#details');
  await expect(details).toBeVisible();
  await expect(details.locator('.p-name')).toHaveText('Amir Fixture');
  await expect(details).toContainText(t('panel.ageAtDeath', { n: 74 }));
  await expect(details).toContainText(t('panel.children', { n: 3 }));
  await expect(details).toContainText('Fixtureabad');
  // Admin-only: the audit fixture upgrades the Record row to "by Family Admin".
  await expect(details.locator('[data-last-edited]')).toContainText('Family Admin');

  // A relative button selects and centres that person (and pulses the card).
  await details.locator('.rel__btn', { hasText: 'Bahadur Fixture' }).click();
  await expect(details.locator('.p-name')).toHaveText('Bahadur Fixture');
  await expect(page.locator('.pcard:not([data-spouse])[data-person-id="person-b"]')).toHaveClass(/selected/);
  await expect(page.locator('.pcard:not([data-spouse])[data-person-id="person-b"]')).toHaveClass(/pulse/);

  // Closing plays the exit animation and still tears the sheet down (the
  // animated close is timer-driven, so this guards the finish path).
  await details.locator('.p-close').click();
  await expect(details).toBeHidden();
  await expect(page.locator('#details .p-name')).toHaveCount(0);
});

test('search filters the tree; an impossible search shows the honest empty state', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await waitForTree(page);
  await page.locator('#tree-search').fill('gul');
  await expect(page.locator('#result-count')).toHaveText(
    t('table.resultCount.filtered', { shown: 1, n: 13 }),
  );
  await expect(page.locator('#tree-world .tree-node')).toHaveCount(1);
  await expect(page.locator('#tree-world .pcard', { hasText: 'Gul Fixture' })).toBeVisible();

  await page.locator('#tree-search').fill('zzzz');
  await expect(page.locator('#empty-note')).toHaveText(t('empty.msg'));
  await expect(page.locator('#tree-world .tree-node')).toHaveCount(0);

  await page.locator('#tree-search').fill('');
  await waitForTree(page);
});

test('generation chips and status filters narrow the tree, reset clears them', async ({ page }, testInfo) => {
  await signInAs(page, 'admin@example.test');
  await waitForTree(page);
  await openFiltersOnMobile(page, testInfo);

  await page.locator('#filter-gens .chip[data-gen="4"]').click();
  await expect(page.locator('#result-count')).toHaveText(
    t('table.resultCount.filtered', { shown: 2, n: 13 }),
  );
  await page.locator('#reset-filters').click();
  await waitForTree(page);

  await page.selectOption('#filter-status', 'deceased');
  await expect(page.locator('#result-count')).toHaveText(
    t('table.resultCount.filtered', { shown: 4, n: 13 }),
  );
  await page.locator('#reset-filters').click();
  await waitForTree(page);

  // Branch: everyone under Bahadur Fixture.
  await page.selectOption('#filter-branch', 'person-b');
  await expect(page.locator('#result-count')).toHaveText(
    t('table.resultCount.filtered', { shown: 7, n: 13 }),
  );
});

test('collapse hides a subtree, keeps the card anchored, and expands again', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await waitForTree(page);

  const card = page.locator('.pcard:not([data-spouse])[data-person-id="person-a"]');
  const before = await card.boundingBox();
  const toggle = page.locator('.tree-node:has(.pcard:not([data-spouse])[data-person-id="person-a"]) .tg');
  await toggle.click();

  await expect(page.locator('#tree-world .tree-node')).toHaveCount(4); // a's subtree: 3 kids + 6 descendants
  await expect(toggle).toHaveText('+ 3');
  const after = await card.boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  // The clicked card stays where it was on screen (keep-position rule).
  expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(2);

  await toggle.click();
  await expect(page.locator('#tree-world .tree-node')).toHaveCount(13);

  // Expand all / collapse all: a full collapse leaves only the two roots.
  await page.locator('#collapse-all').click();
  await expect(page.locator('#tree-world .tree-node')).toHaveCount(2);
  await page.locator('#expand-all').click();
  await expect(page.locator('#tree-world .tree-node')).toHaveCount(13);
});

test('table view shows all 23 columns, sorts, and selects', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await waitForTree(page);
  await page.locator('#view-table').click();

  const table = page.locator('#table-host .tree-table');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveCount(23);
  await expect(table.locator('tbody tr')).toHaveCount(13);

  // Sort by generation: ascending first, flips on the second click.
  await table.locator('th[data-key="gen"] .th-btn').click();
  await expect(table.locator('th[data-key="gen"]')).toHaveAttribute('aria-sort', 'ascending');
  await expect(table.locator('tbody tr').first()).toHaveAttribute('data-id', 'person-a');
  await table.locator('th[data-key="gen"] .th-btn').click();
  await expect(table.locator('th[data-key="gen"]')).toHaveAttribute('aria-sort', 'descending');
  await expect(table.locator('tbody tr').first()).toHaveAttribute('data-id', 'person-h');

  // Row click opens the same details sheet as the tree.
  await table.locator('tbody tr[data-id="person-c"]').click();
  await expect(page.locator('#details .p-name')).toHaveText('Saima Fixture');

  await page.locator('#view-tree').click();
  await expect(page.locator('#tree-stage')).toBeVisible();
});

test('table view paginates rows (G6)', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await waitForTree(page);
  await page.locator('#view-table').click();

  const table = page.locator('#table-host .tree-table');
  const pager = page.locator('#table-host .table-pager');
  // The 13 fixtures fit the default page (50) — the footer still reports it.
  await expect(table.locator('tbody tr')).toHaveCount(13);
  await expect(pager.locator('.tp-range')).toHaveText(
    t('table.pagerInfo', { from: 1, to: 13, total: 13 }),
  );
  await expect(pager.locator('button[data-dir="-1"]')).toBeDisabled();
  await expect(pager.locator('button[data-dir="1"]')).toBeDisabled();

  // Shrink to 10 rows per page — the 13 fixtures spread over two pages.
  await pager.locator('.tp-per').selectOption('10');
  await expect(table.locator('tbody tr')).toHaveCount(10);
  await expect(pager.locator('.tp-range')).toHaveText(
    t('table.pagerInfo', { from: 1, to: 10, total: 13 }),
  );
  await expect(pager.locator('button[data-dir="-1"]')).toBeDisabled();
  await expect(pager.locator('button[data-dir="1"]')).toBeEnabled();

  // Page 2 holds the remaining three rows, arrows flipped.
  await pager.locator('button[data-dir="1"]').click();
  await expect(table.locator('tbody tr')).toHaveCount(3);
  await expect(pager.locator('.tp-range')).toHaveText(
    t('table.pagerInfo', { from: 11, to: 13, total: 13 }),
  );
  await expect(pager.locator('button[data-dir="1"]')).toBeDisabled();
  await expect(pager.locator('button[data-dir="-1"]')).toBeEnabled();

  // Selection still works from page 2: the sheet opens, the row marks .sel.
  await table.locator('tbody tr').first().click();
  await expect(page.locator('#details .p-name')).toBeVisible();
  await expect(table.locator('tbody tr.sel')).toHaveCount(1);

  // On phones the sheet covers the pager — close it (mirrors edit.spec).
  await page.locator('#panel-close').click();
  await expect(page.locator('#details')).toBeHidden();

  // Back to page 1: ten rows again, no stale selection marker.
  await pager.locator('button[data-dir="-1"]').click();
  await expect(table.locator('tbody tr')).toHaveCount(10);
  await expect(table.locator('tbody tr.sel')).toHaveCount(0);
});

test('zoom buttons change the scale', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await waitForTree(page);
  const before = await worldScale(page);
  await page.locator('#zoom-in').click();
  expect(await worldScale(page)).toBeGreaterThan(before);
  await page.locator('#zoom-out').click();
  expect(await worldScale(page)).toBeCloseTo(before, 5);
});

test('double-clicking the canvas zooms in (eased)', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await waitForTree(page);
  const before = await worldScale(page);
  await page.locator('#tree-stage').dblclick({ position: { x: 200, y: 150 } });
  // The zoom is animated, so poll until the tween has passed the old scale.
  await expect.poll(() => worldScale(page)).toBeGreaterThan(before);
});

test('motion: chrome animates, and reduced motion switches it off', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await waitForTree(page);
  /** First computed animation duration of the element, in ms. */
  const animationMs = (selector: string): Promise<number> =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => {
        const raw = getComputedStyle(el).animationDuration.split(',')[0]!.trim();
        const value = parseFloat(raw);
        return raw.endsWith('ms') ? value : value * 1000;
      });

  // Entrance animations are actually defined (sheet slide, card settle-in)…
  expect(await animationMs('.details')).toBeGreaterThan(100);
  expect(await animationMs('.tree-node')).toBeGreaterThan(100);

  // …and collapse to nothing under prefers-reduced-motion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await animationMs('.details')).toBeLessThan(5);
  expect(await animationMs('.tree-node')).toBeLessThan(5);
});

test('hovering a card shows the tooltip (desktop)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'hover is a desktop interaction');
  await signInAs(page, 'admin@example.test');
  await waitForTree(page);
  await page.locator('.pcard:not([data-spouse])[data-person-id="person-b"]').hover();
  const tip = page.locator('#tree-tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Bahadur Fixture');
  await expect(tip).toContainText(t('tooltip.genShort', { n: 1 }));
  await expect(tip).toContainText('Khadija Fixture');
});

test('keyboard: a focused card opens on Enter', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await waitForTree(page);
  await page.locator('.pcard[data-person-id="person-c"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#details .p-name')).toHaveText('Saima Fixture');
});

test('focusing a filtered-out relative clears the filters with a toast', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await waitForTree(page);
  await page.locator('#tree-search').fill('gul');
  await expect(page.locator('#tree-world .tree-node')).toHaveCount(1);

  await page.locator('.pcard[data-person-id="person-g"]').click();
  await page.locator('#details .rel__btn', { hasText: 'Dawood Fixture' }).click();

  await expect(page.locator('#toast-host')).toContainText(t('generic.filtersCleared'));
  await waitForTree(page);
  await expect(page.locator('.pcard:not([data-spouse])[data-person-id="person-d"]')).toHaveClass(/selected/);
  await expect(page.locator('#tree-search')).toHaveValue('');
});

test('a failed load shows the retry banner and recovers', async ({ page, request }) => {
  const injected = await request.post(`${MOCK}/__mock/fail-people`, {
    data: { email: 'fail@example.test', times: 1 },
  });
  expect(injected.ok()).toBeTruthy();

  await signInAs(page, 'fail@example.test');
  const banner = page.locator('#load-error');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Couldn't load:");
  await expect(page.locator('#tree-world .tree-node')).toHaveCount(0);

  await page.locator('#load-retry').click();
  await waitForTree(page);
  await expect(banner).toBeHidden();
});
