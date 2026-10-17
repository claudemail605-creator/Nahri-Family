import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { en } from '../../src/core/i18n/dict.en';

/*
 * Phase 5 (chunk B) — the admin panel against the mock Supabase server.
 *
 * Coverage:
 *   - B1: the header entry point is admin-only; the panel opens with the
 *     tabs shipped so far (branch progress, deletion requests, recently
 *     deleted, activity).
 *   - H4: branch progress computed live from the fixtures (person-a branch
 *     holds 10 people, none complete; person-l's subtree adds 3).
 *   - F2: approve soft-deletes the person + resolves the request; reject
 *     leaves the person untouched. Both flows assert the real writes.
 *   - F6: the soft-deleted fixture person restores back into their place.
 *   - H5: the activity feed shows field diffs and honours the filters.
 *
 * Races: deletion_requests is a global table in the mock (admins read every
 * session's requests), so assertions are always scoped through the person
 * name rather than by queue-wide counts, and projects use different people.
 */
const PASSWORD = 'test-password-1';
const MOCK = 'http://127.0.0.1:54321';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

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
async function globalWrites(request: APIRequestContext, email: string): Promise<MockWrites> {
  const response = await request.get(`${MOCK}/__mock/writes?email=${encodeURIComponent(email)}`);
  expect(response.ok(), `reading merged writes for ${email}`).toBeTruthy();
  return response.json() as Promise<MockWrites>;
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#sign-in-form')).toBeVisible();
  await page.locator('#sign-in-email').fill(email);
  await page.locator('#sign-in-password').fill(PASSWORD);
  await page.locator('#sign-in-submit').click();
  await expect(page.locator('#view-tree')).toBeVisible();
}

/** Opens the panel through the header button and returns its dialog. */
async function openAdminPanel(page: Page): Promise<void> {
  const button = page.locator('#btn-admin');
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator('.admin-modal')).toBeVisible();
  await expect(page.locator('.admin-modal .modal__title')).toHaveText(en['admin.title']);
}

async function openTab(
  page: Page,
  id: 'users' | 'branches' | 'requests' | 'deleted' | 'activity',
): Promise<void> {
  await page.locator(`.admin-tab[data-tab="${id}"]`).click();
}

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

/** The editor's deletion-request flow straight from the branch tile. */
async function requestDeletion(page: Page, id: string, name: string, reason: string): Promise<void> {
  await page.locator(`[data-tile="${id}"] .tile-name`).click();
  await expect(page.locator('#details .p-name')).toHaveText(name);
  await page.locator('#panel-request-deletion').click();
  const modal = page.locator('.modal-backdrop').last();
  await expect(modal.locator('.modal__title')).toHaveText(
    t('panel.requestDeletionTitle', { name }),
  );
  await page.locator('#dr_reason').fill(reason);
  await clickTopDialog(page, 'accent');
  await expectToast(page, t('save.requestSubmitted'));
}

/** Click an action in the TOP-most dialog (a confirm stacks on the panel). */
async function clickTopDialog(page: Page, kind: 'accent' | 'primary' | 'danger' | 'ghost'): Promise<void> {
  const modal = page.locator('.modal-backdrop').last();
  await expect(modal).toBeVisible();
  await modal.locator(`.modal__actions .btn--${kind}`).click();
}

async function expectToast(page: Page, text: string): Promise<void> {
  await expect(page.locator('#toast-host .toast__message').last()).toHaveText(text);
}

test('only admins get the admin button and the panel opens with the tabs', async ({ page }) => {
  // The editor's header has no admin entry point (B1).
  await signInAs(page, 'editor@example.test');
  await expect(page.locator('#btn-admin')).toBeHidden();

  // Switch accounts and check the panel itself.
  await page.locator('#sign-out').click();
  await signInAs(page, 'admin@example.test');
  await openAdminPanel(page);

  const panel = page.locator('.admin-modal');
  const expected: Array<['users' | 'branches' | 'requests' | 'deleted' | 'activity', string]> = [
    ['users', en['admin.tab.users']],
    ['branches', en['admin.tab.branches']],
    ['requests', en['admin.tab.requests']],
    ['deleted', en['admin.tab.deleted']],
    ['activity', en['admin.tab.activity']],
  ];
  for (const [id, label] of expected) {
    await expect(panel.locator(`.admin-tab[data-tab="${id}"]`)).toHaveText(label);
  }
  await expect(panel.locator('.admin-tab--on')).toHaveText(en['admin.tab.users']);
  // The users tab is live: the invite composer entry point is there (H1).
  await expect(panel.locator('#ad_invite')).toHaveText(en['admin.inviteTitle']);

  // Escape closes the panel like any modal (focus returns to the button).
  await page.keyboard.press('Escape');
  await expect(page.locator('.admin-modal')).toHaveCount(0);
});

test('branch progress lists editors with anchors, counts and sign-in', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await openAdminPanel(page);
  await openTab(page, 'branches');
  const body = page.locator('.admin-modal .admin-body');

  const editorRow = body.locator('.bp-row[data-user="22222222-2222-4222-8222-222222222222"]');
  await expect(editorRow).toBeVisible();
  await expect(editorRow).toContainText('Branch Editor');
  await expect(editorRow).toContainText(en['admin.statusActive']);
  await expect(editorRow).toContainText(`${en['admin.branchAnchor']}: Amir Fixture`);
  await expect(editorRow).toContainText(`${en['admin.branchSignIn']}: ${en['admin.statusSignedIn']}`);
  await expect(editorRow).toContainText(`${en['admin.branchPeople']}: 10`);
  await expect(editorRow).toContainText(`${en['admin.branchComplete']}: 0`);
  await expect(editorRow).toContainText(`${en['admin.branchMissing']}: 10`);

  const twoRow = body.locator('.bp-row[data-user="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]');
  await expect(twoRow).toContainText('Two Branch Editor');
  await expect(twoRow).toContainText(`Assigned branch: Amir Fixture, Laila Fixture`);
  await expect(twoRow).toContainText(`${en['admin.branchPeople']}: 13`);
  await expect(twoRow).toContainText(`${en['admin.branchComplete']}: 0`);
  await expect(twoRow).toContainText(`${en['admin.branchMissing']}: 13`);

  // Editors without an assignment get no row (parity with the reference).
  await expect(body.locator('.bp-row', { hasText: 'No Branch Editor' })).toHaveCount(0);
});

test('approving a deletion request soft-deletes the person', async ({ page, request }, testInfo) => {
  // Distinct person per project keeps the shared queue readable in parallel.
  const target = testInfo.project.name.includes('mobile')
    ? { id: 'person-j', name: 'Jamal Fixture' }
    : { id: 'person-h', name: 'Hamza Fixture' };

  // Setup: the editor asks for the deletion. Cards are scoped by the
  // request's unique reason, so each project gets its own wording.
  await signInAs(page, 'editor@example.test');
  await expect(page.locator('#branch-host .branch-anchor')).toContainText('Amir Fixture');
  const reason = `Duplicate of an older record, approval flow (${testInfo.project.name}).`;
  await requestDeletion(page, target.id, target.name, reason);

  // The admin resolves it from the queue.
  await page.locator('#sign-out').click();
  await signInAs(page, 'admin@example.test');
  await openAdminPanel(page);
  await openTab(page, 'requests');
  const body = page.locator('.admin-modal .admin-body');

  const pending = body.locator('.delreq-pending').filter({ hasText: reason });
  await expect(pending.locator('.delreq-person')).toHaveText(target.name);
  await expect(pending).toContainText('Asked by Branch Editor');
  await expect(pending).toContainText(reason);

  // Approve asks first — with the person's real name in the copy.
  await pending.locator('.btn--danger').click();
  const confirm = page.locator('.modal-backdrop').last();
  await expect(confirm.locator('.modal__title')).toHaveText(en['admin.approveTitle']);
  await expect(confirm.locator('.modal__text')).toHaveText(
    t('admin.approveBody', { person: target.name }),
  );
  await confirm.locator('.btn--danger').click();
  await expectToast(page, en['admin.requestApproved']);

  // The queue re-renders: my pending card is gone, a resolved one replaces
  // it (cards are scoped by the request's unique reason text — the queue is
  // global across projects).
  const updatedBody = page.locator('.admin-modal .admin-body');
  await expect(updatedBody.locator('.delreq-pending').filter({ hasText: reason })).toHaveCount(0);
  const resolved = updatedBody.locator('.delreq-resolved').filter({ hasText: reason });
  await expect(resolved).toHaveCount(1);
  await expect(resolved.locator('.req-tag')).toHaveText(en['panel.action.delete']);
  await expect(resolved).toContainText('Resolved');

  // The writes are exactly what the reference produced: a soft delete plus
  // the resolved request, stamped with the admin that resolved it.
  const writes = await sessionWrites(page, request);
  expect(writes.patches).toContainEqual({ id: target.id, body: { is_deleted: true } });
  expect(
    writes.requestPatches.some(
      (patch) => patch.body.status === 'approved' && patch.body.resolved_by === ADMIN_ID,
    ),
  ).toBe(true);
});

test('rejecting a deletion request leaves the person untouched', async ({ page, request }, testInfo) => {
  const target = testInfo.project.name.includes('mobile')
    ? { id: 'person-h', name: 'Hamza Fixture' }
    : { id: 'person-j', name: 'Jamal Fixture' };

  await signInAs(page, 'editor@example.test');
  await expect(page.locator('#branch-host .branch-anchor')).toContainText('Amir Fixture');
  const reason = `Marked as a test duplicate in the branch (${testInfo.project.name}).`;
  await requestDeletion(page, target.id, target.name, reason);

  await page.locator('#sign-out').click();
  await signInAs(page, 'admin@example.test');
  await openAdminPanel(page);
  await openTab(page, 'requests');

  // Cards are scoped by the request's unique reason: the queue is global.
  const pending = page.locator('.admin-modal .admin-body .delreq-pending').filter({ hasText: reason });
  await expect(pending).toHaveCount(1);
  await expect(pending.locator('.delreq-person')).toHaveText(target.name);

  // Rejecting needs no confirmation — it keeps the person in the tree.
  await pending.locator('button[data-status="rejected"]').click();
  await expectToast(page, en['admin.requestRejected']);

  const resolved = page.locator('.admin-modal .admin-body .delreq-resolved').filter({ hasText: reason });
  await expect(resolved).toHaveCount(1);
  await expect(resolved.locator('.req-tag')).toHaveText(en['admin.reject']);

  const writes = await sessionWrites(page, request);
  expect(writes.patches.some((patch) => patch.id === target.id)).toBe(false);
  expect(writes.requestPatches).toContainEqual(
    expect.objectContaining({ body: expect.objectContaining({ status: 'rejected' }) }),
  );
});

test('recently deleted restores the soft-deleted person back in place', async ({ page, request }) => {
  await signInAs(page, 'admin@example.test');
  await openAdminPanel(page);
  await openTab(page, 'deleted');
  const body = page.locator('.admin-modal .admin-body');

  const row = body.locator('.del-row[data-id="person-k"]');
  await expect(row.locator('.del-name')).toHaveText('Kashif Fixture');
  // The fixture carries no deletion stamp — the wording says so honestly.
  await expect(row).toContainText(`Deleted ${en['admin.never']}`);

  // Restore — the toast, the tab, the workspace and the writes all move.
  await row.locator('.del-actions .btn--ghost').click();
  await expectToast(page, t('admin.restored', { name: 'Kashif Fixture' }));

  const updatedBody = page.locator('.admin-modal .admin-body');
  await expect(updatedBody.locator('.del-row', { hasText: 'Kashif Fixture' })).toHaveCount(0);
  await expect(updatedBody.locator('.admin-note')).toHaveText(en['admin.deletedNone']);

  // The reload re-selected the person: the details sheet is open on them.
  await expect(page.locator('#details .p-name')).toHaveText('Kashif Fixture');

  const writes = await sessionWrites(page, request);
  expect(writes.patches).toContainEqual({ id: 'person-k', body: { is_deleted: false } });
});

test('activity feed shows field diffs and honours its filters', async ({ page }) => {
  await signInAs(page, 'admin@example.test');
  await openAdminPanel(page);
  await openTab(page, 'activity');
  const body = page.locator('.admin-modal .admin-body');

  // The three base audit rows, newest first; the top one is the notes edit.
  const rows = body.locator('.audit-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText(en['panel.action.update']);
  await expect(rows.nth(0)).toContainText('Family Admin');
  await expect(rows.nth(0)).toContainText('Amir Fixture');
  await expect(rows.nth(0)).toContainText('Notes — → Family patriarch (fixture).');
  await expect(rows.nth(1)).toContainText('Full name');
  await expect(rows.nth(1)).toContainText('Amir Fitri');
  await expect(rows.nth(1)).toContainText('Amir Fixture');
  await expect(rows.nth(1)).toContainText('Fixtureabad');
  await expect(rows.nth(2)).toContainText(en['panel.action.insert']);
  await expect(rows.nth(2).locator('.audit-delta')).toHaveCount(0);

  // Filter by action: the insert row alone.
  await body.locator('#fl-action').selectOption('insert');
  await body.locator('#fl-apply').click();
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText(en['panel.action.insert']);

  // Filter by person with no audit rows: the honest empty state.
  await body.locator('#fl-person').selectOption({ label: 'Laila Fixture' });
  await body.locator('#fl-apply').click();
  await expect(body.locator('.admin-note')).toHaveText(en['admin.activityNone']);

  // Clear returns to the full feed.
  await body.locator('#fl-clear').click();
  await expect(rows).toHaveCount(3);
});

test('users tab lists accounts with roles, branches and last sign-in', async ({ page }, testInfo) => {
  await signInAs(page, 'admin@example.test');
  await openAdminPanel(page); // users is the default tab
  const body = page.locator('.admin-modal .admin-body');

  // The mock implements admin-users, so neither banner nor "unknown" shows.
  await expect(body).not.toContainText(en['admin.notDeployed']);
  await expect(body).not.toContainText(en['admin.unknown']);

  const adminRow = body.locator('.admin-user[data-user="11111111-1111-4111-8111-111111111111"]');
  await expect(adminRow).toContainText('Family Admin');
  await expect(adminRow.locator('.tag--admin')).toHaveText(en['admin.adminTag']);
  await expect(adminRow).toContainText(en['admin.you']);
  await expect(adminRow).toContainText(en['admin.inviteRoleAdmin']);
  await expect(adminRow.locator('i')).toHaveText(en['admin.noBranches']);
  // The admin signed in once (the mock stamps password sign-ins): a date
  // value, not "never".
  await expect(adminRow).toContainText(`${en['admin.col.lastSeen']}:`);
  await expect(adminRow).not.toContainText(`${en['admin.col.lastSeen']}: ${en['admin.never']}`);

  const editorRow = body.locator('.admin-user[data-user="22222222-2222-4222-8222-222222222222"]');
  await expect(editorRow).toContainText('Branch Editor');
  await expect(editorRow).toContainText(`${en['admin.col.branches']}: Amir Fixture`);
  await expect(editorRow).toContainText(en['admin.inviteRoleEditor']);
  await expect(editorRow.locator('[data-act="resend"]')).toBeVisible();

  // The fixture invitee's sign-in state is NOT asserted here:
  // auth.spec signs invitee@example.test in (invite-link flow), and the real
  // auth stamps last_sign_in_at globally too. The never-case is proven on a
  // fresh invite — passwordless accounts cannot have signed in.
  const inviteeRow = body.locator('.admin-user[data-user="55555555-5555-4555-8555-555555555555"]');
  await expect(inviteeRow).toContainText('Invited Active');
  await expect(inviteeRow).toContainText(en['admin.inviteRoleEditor']);

  const inactiveRow = body.locator('.admin-user[data-user="66666666-6666-4666-8666-666666666666"]');
  await expect(inactiveRow).toContainText('Invited Inactive');
  await expect(inactiveRow).toContainText(en['admin.inactiveTag']);
  await expect(inactiveRow.locator('[data-act="activate"]')).toBeVisible();

  // A passwordless invite has never signed in: the honest "never" stamp.
  const neverName = `Fresh Never (${testInfo.project.name})`;
  await page.locator('.admin-body #ad_invite').click();
  const inviteDialog = page.locator('.modal-backdrop').last();
  await inviteDialog.locator('#iv_email').fill(`roster-${testInfo.project.name}@test.example`);
  await inviteDialog.locator('#iv_name').fill(neverName);
  await inviteDialog.locator('.modal__actions .btn--primary').click();
  await expectToast(page, t('admin.inviteDone', { email: `roster-${testInfo.project.name}@test.example` }));
  const neverRow = body.locator('.admin-user', { hasText: neverName });
  await expect(neverRow).toContainText(`${en['admin.col.lastSeen']}: ${en['admin.never']}`);
});

test('invite creates an account with the picked branch', async ({ page, request }, testInfo) => {
  const project = testInfo.project.name;
  const email = `invite-${project}@test.example`;
  const fullName = `Fresh Editor (${project})`;

  await signInAs(page, 'admin@example.test');
  await openAdminPanel(page);
  await page.locator('.admin-body #ad_invite').click();

  const dialog = page.locator('.modal-backdrop').last();
  await expect(dialog.locator('.modal__title')).toHaveText(en['admin.inviteTitle']);
  await expect(dialog.locator('.modal__sub')).toHaveText(en['admin.inviteSub']);

  // Client-side validation first: the e-mailformat, then the name.
  await dialog.locator('.modal__actions .btn--primary').click();
  await expect(dialog.locator('.edit-error')).toHaveText(en['admin.emailRequired']);

  await dialog.locator('#iv_email').fill('not-an-e-mail');
  await dialog.locator('.modal__actions .btn--primary').click();
  await expect(dialog.locator('.edit-error')).toHaveText(en['admin.emailInvalid']);

  await dialog.locator('#iv_email').fill(email);
  await dialog.locator('.modal__actions .btn--primary').click();
  await expect(dialog.locator('.edit-error')).toHaveText(en['admin.nameRequired']);

  await dialog.locator('#iv_name').fill(fullName);
  // Review box: the composer spells the pending assignment out.
  await expect(dialog.locator('#iv_review')).toContainText(en['branch.reviewTitle']);
  await expect(dialog.locator('#iv_review')).toContainText(fullName);
  await expect(dialog.locator('#iv_review')).toContainText(en['branch.reviewNoBranches']);

  // The picker labels contain parent names too ("… — Amir Fixture"), so the
  // row is addressed by its value, not by text.
  await dialog.locator('.admin-check-row input[type="checkbox"][value="person-a"]').check();
  await expect(dialog.locator('#iv_review')).toContainText('· 1 branch(es)');
  await expect(dialog.locator('#iv_review')).toContainText('Amir Fixture');

  await dialog.locator('.modal__actions .btn--primary').click();
  await expectToast(page, t('admin.inviteDone', { email }));

  // The roster re-renders with the new account assigned to Amir's branch.
  const body = page.locator('.admin-modal .admin-body');
  const row = body.locator('.admin-user', { hasText: fullName });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(`${en['admin.col.branches']}: Amir Fixture`);
  await expect(row).toContainText(en['admin.inviteRoleEditor']);
  await expect(row).not.toContainText(en['admin.inactiveTag']);

  // The real write went through the function (merged journal view).
  const writes = await globalWrites(request, 'admin@example.test');
  expect(
    writes.functions.some((call) => call.action === 'invite' && call.body.email === email),
  ).toBe(true);
});

test('edit user renames, re-branches and can promote (with confirms)', async ({ page, request }, testInfo) => {
  const project = testInfo.project.name;
  const email = `edit-${project}@test.example`;
  const fullName = `Editable Person (${project})`;
  const renamed = `Renamed Person (${project})`;

  await signInAs(page, 'admin@example.test');
  await openAdminPanel(page);

  // A disposable account, so fixtures stay untouched, then its edit dialog.
  await page.locator('.admin-body #ad_invite').click();
  let dialog = page.locator('.modal-backdrop').last();
  await dialog.locator('#iv_email').fill(email);
  await dialog.locator('#iv_name').fill(fullName);
  await dialog.locator('.modal__actions .btn--primary').click();
  await expectToast(page, t('admin.inviteDone', { email }));

  const row = page.locator('.admin-body .admin-user', { hasText: fullName });
  await expect(row).toHaveCount(1);
  await row.locator('[data-act="edit"]').click();

  dialog = page.locator('.modal-backdrop').last();
  await expect(dialog.locator('.modal__title')).toHaveText(t('admin.editTitle', { name: fullName }));

  // Rename + pick one branch. Branch writes ask first — same as the reference.
  await dialog.locator('#eu_name').fill(renamed);
  await dialog.locator('.admin-check-row input[type="checkbox"][value="person-a"]').check();
  await dialog.locator('.modal__actions .btn--primary').click();

  const confirm = page.locator('.modal-backdrop').last();
  await expect(confirm.locator('.modal__title')).toHaveText(t('admin.editTitle', { name: fullName }));
  await expect(confirm.locator('.modal__text')).toHaveText(
    t('admin.confirmBranches', { name: fullName }),
  );
  await confirm.locator('.modal__actions .btn--primary').click();
  await expectToast(page, en['admin.branchesSaved']);

  const body = page.locator('.admin-modal .admin-body');
  const renamedRow = body.locator('.admin-user', { hasText: renamed });
  await expect(renamedRow).toContainText(`${en['admin.col.branches']}: Amir Fixture`);

  // Promote to admin: a second confirm (the danger kind one) before the write.
  await renamedRow.locator('[data-act="edit"]').click();
  dialog = page.locator('.modal-backdrop').last();
  await dialog.locator('#eu_role').selectOption('admin');
  await dialog.locator('.modal__actions .btn--primary').click();
  const roleConfirm = page.locator('.modal-backdrop').last();
  await expect(roleConfirm.locator('.modal__text')).toHaveText(
    t('admin.confirmRole', { name: renamed }),
  );
  await roleConfirm.locator('.modal__actions .btn--danger').click();
  await expectToast(page, en['admin.branchesSaved']);
  await expect(page.locator('.admin-modal .admin-user', { hasText: renamed }).locator('.tag--admin')).toBeVisible();

  // The actual writes: one profile patch per step + branch insert for the pick.
  const writes = await globalWrites(request, 'admin@example.test');
  const rename = writes.profiles.find((p) => p.body.full_name === renamed);
  expect(rename).toBeTruthy();
  if (rename) {
    expect(writes.branches.some((b) => b.op === 'insert' && b.user_id === rename.id && b.person_id === 'person-a')).toBe(true);
  }
  expect(writes.profiles.some((p) => p.body.role === 'admin' && rename && p.id === rename.id)).toBe(true);
});

test('deactivate asks for confirmation and the flag flips back and forth', async ({ page, request }, testInfo) => {
  const project = testInfo.project.name;
  const email = `toggle-${project}@test.example`;
  const fullName = `Toggle Person (${project})`;

  await signInAs(page, 'admin@example.test');
  await openAdminPanel(page);

  await page.locator('.admin-body #ad_invite').click();
  await page.locator('.modal-backdrop').last().locator('#iv_email').fill(email);
  await page.locator('.modal-backdrop').last().locator('#iv_name').fill(fullName);
  await page.locator('.modal-backdrop').last().locator('.modal__actions .btn--primary').click();
  await expectToast(page, t('admin.inviteDone', { email }));

  const row = page.locator('.admin-body .admin-user', { hasText: fullName });
  await expect(row).toHaveCount(1);

  // Self-protection: the signed-in admin cannot deactivate themselves.
  const adminRow = page.locator(
    '.admin-body .admin-user[data-user="11111111-1111-4111-8111-111111111111"]',
  );
  await adminRow.locator('[data-act="deactivate"]').click();
  await expectToast(page, en['admin.selfActive']);
  await expect(page.locator('.modal-backdrop')).toHaveCount(1); // only the panel

  // Deactivating someone else asks first, then flips the flag.
  await row.locator('[data-act="deactivate"]').click();
  const confirm = page.locator('.modal-backdrop').last();
  await expect(confirm.locator('.modal__text')).toHaveText(
    t('admin.confirmDeactivate', { name: fullName }),
  );
  await confirm.locator('.modal__actions .btn--danger').click();
  await expectToast(page, t('admin.deactivated', { name: fullName }));

  const body = page.locator('.admin-modal .admin-body');
  const toggled = body.locator('.admin-user', { hasText: fullName });
  await expect(toggled).toContainText(en['admin.inactiveTag']);
  await expect(toggled.locator('[data-act="activate"]')).toBeVisible();
  const toggleId = (await toggled.getAttribute('data-user')) ?? '';

  // Activating needs no confirmation (per the reference).
  await toggled.locator('[data-act="activate"]').click();
  await expectToast(page, t('admin.activated', { name: fullName }));

  const writes = await globalWrites(request, 'admin@example.test');
  expect(writes.functions.some((call) => call.action === 'disable' && call.body.user_id === toggleId)).toBe(true);
  expect(writes.functions.some((call) => call.action === 'enable' && call.body.user_id === toggleId)).toBe(true);
});

test('resend e-mail and a temporary password go through the function', async ({ page, request }, testInfo) => {
  const project = testInfo.project.name;
  const email = `passme-${project}@test.example`;
  const fullName = `Password Person (${project})`;

  await signInAs(page, 'admin@example.test');
  await openAdminPanel(page);

  // Resend on the fixture invitee — stateless, no toast-driven writes.
  const inviteeRow = page.locator('.admin-body .admin-user[data-user="55555555-5555-4555-8555-555555555555"]');
  await inviteeRow.locator('[data-act="resend"]').click();
  await expectToast(page, t('admin.resendDone', { email: 'invitee@example.test' }));

  // A fresh passwordless account, then the temp-password dialog on it.
  await page.locator('.admin-body #ad_invite').click();
  const inviteDialog = page.locator('.modal-backdrop').last();
  await inviteDialog.locator('#iv_email').fill(email);
  await inviteDialog.locator('#iv_name').fill(fullName);
  await inviteDialog.locator('.modal__actions .btn--primary').click();
  await expectToast(page, t('admin.inviteDone', { email }));

  const row = page.locator('.admin-body .admin-user', { hasText: fullName });
  await row.locator('[data-act="password"]').click();

  const dialog = page.locator('.modal-backdrop').last();
  await expect(dialog.locator('.modal__title')).toHaveText(
    t('admin.setTempPasswordTitle', { name: fullName }),
  );

  // Too short — the dialogue shows the password length rule inline.
  await dialog.locator('#sp_pw').fill('short');
  await dialog.locator('.modal__actions .btn--primary').click();
  await expect(dialog.locator('.edit-error')).toHaveText(en['auth.pwTooShort']);

  await dialog.locator('#sp_pw').fill('test-password-9');
  await dialog.locator('.modal__actions .btn--primary').click();
  await expectToast(page, t('admin.setTempPasswordDone', { name: fullName }));

  const writes = await globalWrites(request, 'admin@example.test');
  expect(
    writes.functions.some((call) => call.action === 'set_password' && call.body.password === 'test-password-9'),
  ).toBe(true);
  expect(writes.functions.some((call) => call.action === 'resend')).toBe(true);
});

