import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { en } from '../../src/core/i18n/dict.en';

/*
 * Phase 4 end-to-end coverage — editing, photos, deletion and the branch
 * workspace, against the mock Supabase server:
 *
 *   - writes are isolated per access token (fresh sign-in = pristine fixtures),
 *     so the tests can run fully parallel as the same fixture accounts;
 *   - every assertion about what was written uses `/__mock/writes?token=…`
 *     scoped to THIS browser session, so parallel tests cannot interfere;
 *   - fixture family (see tests/mock/supabase-server.mjs): person-a 'Amir
 *     Fixture' is the editor's branch anchor and has 9 living descendants;
 *     person-n 'Naveed Fixture' and person-m 'Mariam Fixture' are childless
 *     leaves fit for soft delete.
 */
const PASSWORD = 'test-password-1';
const MOCK = 'http://127.0.0.1:54321';

/** A real 1×1 PNG so the browser-downscale + upload path runs for real. */
const PNG_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const t = (key: keyof typeof en, params: Record<string, string | number> = {}): string => {
  let out: string = en[key];
  for (const [name, value] of Object.entries(params)) out = out.replace(`{${name}}`, String(value));
  return out;
};

interface MockWrites {
  email: string;
  people: Array<Record<string, unknown> & { id: string }>;
  audit: Array<{ id: number | string; person_id: string; action: string }>;
  deletionRequests: Array<{ person_id: string; reason: string | null; status: string }>;
  inserts: Array<{ id: string; values: Record<string, unknown> }>;
  patches: Array<{ id: string; body: Record<string, unknown> }>;
  uploads: Array<{ key: string }>;
  removals: Array<{ key: string }>;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#sign-in-form')).toBeVisible();
  await page.locator('#sign-in-email').fill(email);
  await page.locator('#sign-in-password').fill(PASSWORD);
  await page.locator('#sign-in-submit').click();
  // The workspace toolbar is view-agnostic: admins land on the tree, editors
  // on the branch workspace.
  await expect(page.locator('#view-tree')).toBeVisible();
}

async function signInAdmin(page: Page, total = 13): Promise<void> {
  await signIn(page, 'admin@example.test');
  await expect(page.locator('#result-count')).toHaveText(t('table.resultCount.all', { n: total }));
}

async function signInEditor(page: Page): Promise<void> {
  await signIn(page, 'editor@example.test');
  await expect(page.locator('#branch-host .branch-anchor')).toContainText('Amir Fixture');
}

async function openCard(page: Page, id: string): Promise<void> {
  // The tree is a pan/zoom canvas — not every card is inside the visible area,
  // so select by keyboard (the cards are real buttons).
  const card = page.locator(`.pcard:not([data-spouse])[data-person-id="${id}"]`);
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#details')).toBeVisible();
}

/** The session's own write overlay — race-free under parallel tests. */
async function sessionToken(page: Page): Promise<string> {
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

async function sessionWrites(page: Page, request: APIRequestContext): Promise<MockWrites> {
  const token = await sessionToken(page);
  const response = await request.get(`${MOCK}/__mock/writes?token=${encodeURIComponent(token)}`);
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<MockWrites>;
}

/** Click an action in the TOP-most dialog (confirm dialogs stack on forms). */
async function clickModal(page: Page, kind: 'accent' | 'primary' | 'danger' | 'ghost'): Promise<void> {
  const modal = page.locator('.modal-backdrop').last();
  await expect(modal).toBeVisible();
  await modal.locator(`.modal__actions .btn--${kind}`).click();
}

async function expectToast(page: Page, text: string): Promise<void> {
  await expect(page.locator('#toast-host .toast__message').last()).toHaveText(text);
}

/** On phones the sidebar is a drawer; open it before touching its controls. */
async function toggleShowDeleted(page: Page, testInfo: TestInfo, on: boolean): Promise<void> {
  const mobile = testInfo.project.name.includes('mobile');
  const toggle = page.locator('#filters-toggle');
  if (mobile) {
    // The open details sheet covers the drawer's lower controls on a phone.
    if (await page.locator('#panel-close').isVisible()) await page.locator('#panel-close').click();
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  }
  const box = page.locator('#show-deleted');
  if (on) await box.check();
  else await box.uncheck();
  if (mobile && (await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
}

/** Upload a tiny PNG through the details sheet's file input. */
async function uploadPixel(page: Page, name = 'portrait.png'): Promise<void> {
  await page.setInputFiles('#panel-photo-input', { name, mimeType: 'image/png', buffer: PNG_PIXEL });
  await expectToast(page, t('photos.uploaded'));
}

/* ----------------------------------- adds ----------------------------------- */

test('admin adds a new root from the details sheet', async ({ page, request }) => {
  await signInAdmin(page);
  await openCard(page, 'person-a');
  await page.locator('#panel-add-root').click();
  await expect(page.locator('.person-modal')).toBeVisible();
  await expect(page.locator('#pf_parent')).toHaveValue(t('edit.parentNone'));

  await page.locator('#pf_full_name').fill('Zainab Newroot');
  await page.locator('#pf_gender').selectOption('Female');
  await clickModal(page, 'accent');

  await expectToast(page, t('save.added', { name: 'Zainab Newroot' }));
  await expect(page.locator('#details .p-name')).toHaveText('Zainab Newroot');
  await expect(page.locator('#result-count')).toHaveText(t('table.resultCount.all', { n: 14 }));

  const writes = await sessionWrites(page, request);
  const insert = writes.inserts.find((row) => row.values.full_name === 'Zainab Newroot');
  expect(insert).toBeTruthy();
  expect(insert!.values).toMatchObject({ full_name: 'Zainab Newroot', gender: 'Female', parent_id: null });
  // Never part of a client insert — the database owns these.
  expect('path' in insert!.values).toBe(false);
  expect('created_by' in insert!.values).toBe(false);
  expect('updated_by' in insert!.values).toBe(false);
});

test('the form refuses to save without a name or gender', async ({ page }) => {
  await signInAdmin(page);
  await openCard(page, 'person-a');
  await page.locator('#panel-add-root').click();

  await clickModal(page, 'accent');
  await expectToast(page, t('edit.fixFields'));
  await expect(page.locator('.edit-field[data-field="full_name"] .edit-error')).toBeVisible();

  await page.locator('#pf_full_name').fill('Half Person');
  await clickModal(page, 'accent');
  await expect(page.locator('.edit-field[data-field="gender"] .edit-error')).toBeVisible();
  await expect(page.locator('.person-modal')).toBeVisible();
});

test('admin edits a person; only the changed fields are written', async ({ page, request }) => {
  await signInAdmin(page);
  await openCard(page, 'person-b');
  await page.locator('#panel-edit').click();
  await expect(page.locator('#pf_full_name')).toHaveValue('Bahadur Fixture');

  await page.locator('#pf_nick_name').fill('Badoo');
  await page.locator('#pf_qualification').fill('B.Sc.');
  await clickModal(page, 'accent');

  await expectToast(page, t('save.changesSaved'));
  await expect(page.locator('#details .p-nick')).toContainText('Badoo');

  const writes = await sessionWrites(page, request);
  const patch = writes.patches.find((row) => row.id === 'person-b');
  expect(patch).toBeTruthy();
  // The minimal diff: nothing blank written over untouched columns.
  expect(patch!.body).toEqual({ nick_name: 'Badoo', qualification: 'B.Sc.' });
});

test('a duplicate child name warns first; cancelling keeps the form, confirming saves', async ({
  page,
  request,
}) => {
  await signInAdmin(page);
  await openCard(page, 'person-a');
  await page.locator('#panel-add-child').click();
  await expect(page.locator('#pf_parent')).toHaveValue('Amir Fixture');

  await page.locator('#pf_full_name').fill('Bahadur Fixture');
  await page.locator('#pf_gender').selectOption('Male');

  // First attempt: the warning dialog appears on top of the still-living form.
  await clickModal(page, 'accent');
  await expect(page.locator('.modal-backdrop').last().locator('.modal__text')).toContainText(
    t('edit.dupWarn', { name: 'Bahadur Fixture' }),
  );
  await clickModal(page, 'ghost'); // cancel
  await expect(page.locator('.person-modal')).toBeVisible();
  let writes = await sessionWrites(page, request);
  expect(
    writes.inserts.filter((row) => row.values.full_name === 'Bahadur Fixture'),
  ).toHaveLength(0);

  // Second attempt: confirm the duplicate and it saves under person-a.
  await clickModal(page, 'accent');
  await clickModal(page, 'primary');
  await expectToast(page, t('save.added', { name: 'Bahadur Fixture' }));
  writes = await sessionWrites(page, request);
  const inserted = writes.inserts.filter((row) => row.values.full_name === 'Bahadur Fixture');
  expect(inserted).toHaveLength(1);
  expect(inserted[0]!.values).toMatchObject({ parent_id: 'person-a', gender: 'Male' });
});

test('admin moves a person with the parent picker', async ({ page, request }) => {
  await signInAdmin(page);
  await openCard(page, 'person-e');
  await page.locator('#panel-edit').click();

  const laila = await page.locator('datalist option[value^="Laila Fixture"]').first().getAttribute('value');
  expect(laila).toBeTruthy();
  await page.locator('#pf_parent').fill(laila as string);
  await page.locator('#pf_parent').blur();
  await clickModal(page, 'accent');

  await expectToast(page, t('save.changesSaved'));
  await expect(page.locator('#details')).toContainText('person-l');

  const writes = await sessionWrites(page, request);
  const patch = writes.patches.find((row) => row.id === 'person-e');
  expect(patch).toBeTruthy();
  expect(patch!.body).toEqual({ parent_id: 'person-l' });
});

/* ---------------------------------- branch ---------------------------------- */

test('editor adds a child from their branch tile', async ({ page, request }) => {
  await signInEditor(page);
  await expect(page.locator('#br_grid .branch-tile')).toHaveCount(10);

  await page.locator('[data-tile="person-a"] [data-act="addchild"]').click();
  await expect(page.locator('#pf_parent')).toHaveValue('Amir Fixture');
  await page.locator('#pf_full_name').fill('Noor Fixture');
  await page.locator('#pf_gender').selectOption('Female');
  await clickModal(page, 'accent');

  await expectToast(page, t('save.added', { name: 'Noor Fixture' }));
  await expect(page.locator('#br_grid .branch-tile')).toHaveCount(11);
  await expect(page.locator('#br_grid .tile-name', { hasText: 'Noor Fixture' })).toHaveCount(1);
  await expect(page.locator('#result-count')).toHaveText(t('table.resultCount.all', { n: 14 }));

  const writes = await sessionWrites(page, request);
  const insert = writes.inserts.find((row) => row.values.full_name === 'Noor Fixture');
  expect(insert).toBeTruthy();
  // The child is born into the anchor's branch with the parent's own text
  // fields guessed from the reference rules.
  expect(insert!.values).toMatchObject({
    parent_id: 'person-a',
    fathers_name: 'Amir Fixture',
    mothers_name: 'Fatima Fixture',
    gender: 'Female',
  });
});

test('the branch workspace guides the editor', async ({ page }) => {
  await signInEditor(page);

  // Honest live progress from the saved fields: nobody in the fixture branch
  // has a photo or a nickname yet, so all 10 tiles need details.
  await expect(page.locator('.branch-stat b')).toHaveText(['10', '0', '10']);
  await expect(page.locator('#br_grid .branch-tile')).toHaveCount(10);

  await page.locator('.seg__btn[data-f="done"]').click();
  await expect(page.locator('#br_grid .branch-tile')).toHaveCount(0);
  await expect(page.locator('#br_next')).toBeVisible();
  await page.locator('#br_next').click();
  await expectToast(page, t('branch.everythingShown'));

  await page.locator('.seg__btn[data-f="all"]').click();
  await expect(page.locator('#br_grid .branch-tile')).toHaveCount(10);

  // "Start" highlights the first relative needing details.
  await page.locator('#br_start').click();
  await expect(page.locator('[data-tile="person-a"]')).toHaveClass(/branch-tile--highlight/);

  // A tile opens the details sheet with the editor's action bar.
  await page.locator('[data-tile="person-a"] .tile-name').click();
  await expect(page.locator('#details .p-name')).toHaveText('Amir Fixture');
  await expect(page.locator('#panel-edit')).toBeVisible();
  await expect(page.locator('#panel-add-child')).toBeVisible();
  await expect(page.locator('#panel-request-deletion')).toBeVisible();
  await expect(page.locator('#panel-soft-delete')).toHaveCount(0);
  await expect(page.locator('#panel-add-root')).toHaveCount(0);
  await expect(page.locator('#panel-history')).toBeVisible();
  await page.locator('#panel-close').click();

  // Back to the tree; the choice persists across a reload.
  await page.locator('#br_back-tree-2').click();
  await expect(page.locator('#tree-stage')).toBeVisible();
  await expect(page.locator('#branch-host')).toBeHidden();
  await expect(page.locator('#view-tree')).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.locator('#tree-stage')).toBeVisible();
  await expect(page.locator('#branch-host')).toBeHidden();
  await expect(page.locator('#view-tree')).toHaveAttribute('aria-pressed', 'true');
});

test('an editor with two branches can switch between them', async ({ page }) => {
  await signIn(page, 'twobranch@example.test');
  await expect(page.locator('#branch-host .branch-anchor')).toContainText('Amir Fixture');

  // The chooser lists both assigned anchors; the first is active.
  const chooser = page.locator('.branch-choose [data-branch]');
  await expect(chooser).toHaveCount(2);
  await expect(page.locator('#br_grid .branch-tile')).toHaveCount(10);

  await page.locator('[data-branch="person-l"]').click();
  await expect(page.locator('#branch-host .branch-anchor')).toContainText('Laila Fixture');
  await expect(page.locator('#br_grid .branch-tile')).toHaveCount(3);
  await expect(page.locator('.branch-stat b').first()).toHaveText('3');
});

test('the add-spouse tile action edits the spouse text on the same record', async ({
  page,
  request,
}) => {
  await signInEditor(page);
  await page.locator('[data-tile="person-h"] [data-act="addspouse"]').click();
  await expect(page.locator('#pf_full_name')).toHaveValue('Hamza Fixture');

  await page.locator('#pf_spouse_name').fill('Rukhsana Fixture');
  await clickModal(page, 'accent');
  await expectToast(page, t('save.changesSaved'));

  const writes = await sessionWrites(page, request);
  const patch = writes.patches.find((row) => row.id === 'person-h');
  expect(patch?.body).toEqual({ spouse_name: 'Rukhsana Fixture' });
});

test('an editor with no assignment sees the honest no-access message', async ({ page }) => {
  await signIn(page, 'nobranch@example.test');
  await expect(page.locator('#branch-host .branch-hero h2')).toHaveText(t('branch.noAssignmentTitle'));
  // Reading the tree stays available.
  await page.locator('#br_open-tree').click();
  await expect(page.locator('#tree-stage')).toBeVisible();
});

test('admin never sees the branch tab', async ({ page }) => {
  await signInAdmin(page);
  await expect(page.locator('#view-branch')).toBeHidden();
  await expect(page.locator('#branch-host')).toBeHidden();
});

/* ---------------------------------- photos ---------------------------------- */

test('admin uploads a photo; it appears on the card and in the panel', async ({ page, request }) => {
  await signInAdmin(page);
  await openCard(page, 'person-a');
  await expect(page.locator('#panel-photo-empty')).toHaveText(t('photos.none'));

  await uploadPixel(page);

  // The panel reloads with the signed photo and the zoom control.
  await expect(page.locator('#panel-photo-img')).toBeVisible();
  await expect(page.locator('#panel-photo-zoom')).toBeVisible();
  await expect(page.locator('#panel-photo-remove')).toBeVisible();
  // …and the tree card hydrates its own photo through the batch signer.
  await expect(page.locator('.pcard[data-person-id="person-a"] img.pcard__photo')).toBeVisible();

  // The lightbox opens over the sheet and closes on Escape.
  await page.locator('#panel-photo-zoom').click();
  await expect(page.locator('.lightbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.lightbox')).toHaveCount(0);

  const writes = await sessionWrites(page, request);
  expect(writes.uploads).toHaveLength(1);
  const key = writes.uploads[0]!.key;
  expect(key).toMatch(/^person-a\/\d+\.png$/);
  const patch = writes.patches.find((row) => row.id === 'person-a');
  expect(patch?.body).toEqual({ photo_path: key });
});

test('admin removes a photo', async ({ page, request }) => {
  await signInAdmin(page);
  await openCard(page, 'person-a');
  await uploadPixel(page, 'to-remove.png');
  await expect(page.locator('#panel-photo-img')).toBeVisible();

  await page.locator('#panel-photo-remove').click();
  await expect(page.locator('.modal-backdrop').last().locator('.modal__text')).toHaveText(
    t('photos.removeConfirm'),
  );
  await clickModal(page, 'danger');

  await expectToast(page, t('photos.removed'));
  await expect(page.locator('#panel-photo-empty')).toHaveText(t('photos.none'));
  await expect(page.locator('#panel-photo-img')).toBeHidden();
  await expect(page.locator('.pcard[data-person-id="person-a"] img.pcard__photo')).toHaveCount(0);

  const writes = await sessionWrites(page, request);
  const key = writes.uploads[0]!.key;
  expect(writes.removals.some((row) => row.key === key)).toBe(true);
  const patches = writes.patches.filter((row) => row.id === 'person-a').map((row) => row.body);
  expect(patches).toContainEqual({ photo_path: key });
  expect(patches).toContainEqual({ photo_path: null });
});

test('the edit form carries a photo through the same save (choose, then remove)', async ({
  page,
  request,
}) => {
  await signInAdmin(page);
  await openCard(page, 'person-b');
  await page.locator('#panel-edit').click();
  await page.setInputFiles('#pp_file', { name: 'form-photo.png', mimeType: 'image/png', buffer: PNG_PIXEL });
  await expect(page.locator('.person-modal [data-pp-name]')).toContainText('form-photo.png');
  await clickModal(page, 'accent');
  await expectToast(page, t('save.changesSaved'));

  let writes = await sessionWrites(page, request);
  const key = writes.uploads[0]!.key;
  expect(key).toMatch(/^person-b\/\d+\.png$/);
  expect(writes.patches.find((row) => row.id === 'person-b')?.body).toEqual({ photo_path: key });

  // Re-open: the stored photo is offered with a remove control that clears
  // the column on save and deletes the object.
  await page.locator('#panel-edit').click();
  await expect(page.locator('#pp_clear')).toBeVisible();
  await page.locator('#pp_clear').click();
  await expect(page.locator('.person-modal [data-pp-name]')).toHaveText('');
  await clickModal(page, 'accent');
  // Both saves produce the same toast text, so anchor on the sheet's photo
  // state — it only re-renders after the removal round-trip finished.
  await expect(page.locator('#panel-photo-empty')).toHaveText(t('photos.none'));

  writes = await sessionWrites(page, request);
  expect(writes.removals.some((row) => row.key === key)).toBe(true);
  const patches = writes.patches.filter((row) => row.id === 'person-b').map((row) => row.body);
  expect(patches).toContainEqual({ photo_path: null });
});

/* -------------------------------- deletions --------------------------------- */

test('soft delete refuses to orphan living relatives', async ({ page, request }) => {
  await signInAdmin(page);
  await openCard(page, 'person-a');
  await page.locator('#panel-soft-delete').click();

  // 9 non-deleted descendants, 8 of them living — the refusal reports both.
  await expect(page.locator('.modal-backdrop').last().locator('.modal__text')).toHaveText(
    t('panel.deleteBlocked', { n: 9, alive: 8 }),
  );
  await clickModal(page, 'primary'); // close

  await expect(page.locator('.pcard:not([data-spouse])[data-person-id="person-a"]')).toBeVisible();
  const writes = await sessionWrites(page, request);
  expect(writes.patches).toHaveLength(0);
});

test('admin deletes and restores a childless person', async ({ page, request }, testInfo) => {
  await signInAdmin(page);
  await openCard(page, 'person-n');
  await page.locator('#panel-soft-delete').click();
  await clickModal(page, 'danger');

  await expectToast(page, t('panel.deleteDone', { name: 'Naveed Fixture' }));
  await expect(page.locator('#details')).toBeHidden();
  await expect(page.locator('#result-count')).toHaveText(t('table.resultCount.all', { n: 12 }));
  await expect(page.locator('.pcard[data-person-id="person-n"]')).toHaveCount(0);

  // Reveal deleted people, then restore from the panel (the card can sit
  // outside the pan/zoom viewport, so select it by keyboard).
  await toggleShowDeleted(page, testInfo, true);
  await expect(page.locator('.pcard[data-person-id="person-n"]')).toBeVisible();
  await page.locator('.pcard:not([data-spouse])[data-person-id="person-n"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#details')).toBeVisible();
  await expect(page.locator('#panel-restore')).toBeVisible();
  await expect(page.locator('#panel-edit')).toHaveCount(0);
  await page.locator('#panel-restore').click();

  await expectToast(page, t('save.restored'));
  await expect(page.locator('#panel-restore')).toHaveCount(0);
  await expect(page.locator('#panel-edit')).toBeVisible();
  await expect(page.locator('#details .p-tags')).not.toContainText(t('panel.deleted'));

  // Back to the default view: the person is part of the family again.
  await toggleShowDeleted(page, testInfo, false);
  await expect(page.locator('.pcard:not([data-spouse])[data-person-id="person-n"]')).toBeVisible();
  await expect(page.locator('#result-count')).toHaveText(t('table.resultCount.all', { n: 13 }));

  const writes = await sessionWrites(page, request);
  const patches = writes.patches.filter((row) => row.id === 'person-n').map((row) => row.body);
  expect(patches).toContainEqual({ is_deleted: true });
  expect(patches).toContainEqual({ is_deleted: false });
});

test('editor submits a deletion request', async ({ page, request }) => {
  await signInEditor(page);
  await page.locator('[data-tile="person-h"] .tile-name').click();
  await expect(page.locator('#details .p-name')).toHaveText('Hamza Fixture');

  await page.locator('#panel-request-deletion').click();
  const modal = page.locator('.modal-backdrop').last();
  await expect(modal.locator('.modal__title')).toHaveText(
    t('panel.requestDeletionTitle', { name: 'Hamza Fixture' }),
  );

  // A reason is required.
  await clickModal(page, 'accent');
  await expect(modal.locator('.edit-error')).toBeVisible();

  await page.locator('#dr_reason').fill('Duplicate of an older family record.');
  await clickModal(page, 'accent');
  await expectToast(page, t('save.requestSubmitted'));
  await expect(page.locator('.modal')).toHaveCount(0);

  const writes = await sessionWrites(page, request);
  expect(writes.deletionRequests).toHaveLength(1);
  expect(writes.deletionRequests[0]).toMatchObject({
    person_id: 'person-h',
    reason: 'Duplicate of an older family record.',
    status: 'pending',
  });
});

/* --------------------------------- history ---------------------------------- */

test('the history shows who changed what, and a version can be restored', async ({
  page,
  request,
}) => {
  await signInAdmin(page);
  await openCard(page, 'person-a');
  // The newest audit row drives the "last edited by" line.
  await expect(page.locator('[data-last-edited]')).toContainText('Family Admin');

  await page.locator('#panel-history').click();
  const box = page.locator('#panel-history-box');
  await expect(box).toBeVisible();
  await expect(box.locator('.audit-row')).toHaveCount(3);
  await expect(box.locator('.audit-row').first().locator('.audit-meta')).toContainText('Family Admin');
  await expect(box.locator('.audit-row').first()).toContainText(t('panel.action.update'));

  // The 2025-12-15 update has an old_data snapshot → "restore this version".
  await box.locator('[data-restore-version="2"]').click();
  await expect(page.locator('.modal-backdrop').last().locator('.modal__title')).toHaveText(
    t('panel.restoreVersion'),
  );
  await clickModal(page, 'primary');

  await expectToast(page, t('panel.restoreDone'));
  await expect(page.locator('#details .p-name')).toHaveText('Amir Fitri');

  // The restore writes the snapshot back — and nothing it must not touch.
  const writes = await sessionWrites(page, request);
  const patch = writes.patches.find((row) => row.id === 'person-a');
  expect(patch?.body).toEqual({
    full_name: 'Amir Fitri',
    place_of_birth: null,
    qualification: null,
  });
});
