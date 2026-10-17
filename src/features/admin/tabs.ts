/**
 * The admin panel's tab renderers (Phase 5, chunks B–D).
 *
 * Every tab renders honest states: a "Loading." note immediately, then
 * either the data, the empty state, or the failure — mirroring the
 * reference `js/admin.js` tabs but built with DOM helpers and this app's
 * design tokens. Writes go through the data layer; confirmations use the
 * modal stack (never a blocking window.confirm).
 */
import { extractMessage } from '../auth/errors';
import { getDisplayName } from '../../core/i18n/display';
import type { MessageKey } from '../../core/i18n';
import type { ProfileRow } from '../../data/auth';
import {
  EMPTY_ACTIVITY_FILTER,
  fetchActivity,
  fetchBranchAccess,
  fetchDeletionRequests,
  fetchLastSignInTimes,
  fetchProfiles,
  fetchRecentlyDeleted,
  inviteAccount,
  resendAccountEmail,
  replaceBranchAccess,
  resolveDeletionRequest,
  setAccountActive,
  setAccountPassword,
  updateProfile,
  invokeAdminUsers,
  type ActivityFilter,
  type AdminUserRow,
  type DeletionRequestRow,
  type RecentlyDeletedRow,
} from '../../data/admin';
import { setPersonDeleted } from '../../data/people';
import { branchPeopleOf, completeness } from '../tree/branch';
import { fieldDiffs } from '../tree/fields';
import type { Person } from '../tree/model';
import { h } from '../../ui/dom';
import { openModal } from '../../ui/modal';
import { confirmDialog } from '../../ui/confirm';
import type { AdminTabCtx } from './modal';

/* --------------------------------- helpers -------------------------------- */

function t(ctx: AdminTabCtx): (key: MessageKey, vars?: Record<string, string | number>) => string {
  return (key, vars) => (vars ? ctx.i18n.fmt(key, vars) : ctx.i18n.t(key));
}

function note(ctx: AdminTabCtx, key: MessageKey): HTMLElement {
  return h('div', { class: 'admin-note', text: ctx.i18n.t(key) });
}

function failure(ctx: AdminTabCtx, err: unknown, key: MessageKey = 'admin.loadFailed'): HTMLElement {
  return h(
    'div',
    { class: 'admin-note admin-note--error' },
    ctx.i18n.fmt(key, { msg: extractMessage(err) }),
  );
}

/**
 * Guard every async fill: the panel can close (or switch tabs) before the
 * network answers, and nothing should paint into a body that is gone.
 */
function connected(ctx: AdminTabCtx, render: () => void): void {
  if (ctx.body.isConnected) render();
}

function fmtWhen(ctx: AdminTabCtx, iso: string | null | undefined): string {
  if (!iso) return ctx.i18n.t('admin.never');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ctx.i18n.t('admin.never');
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Person name: model first (language-aware), profile by id, then a stub. */
function personName(ctx: AdminTabCtx, id: string | null, profiles: ProfileRow[]): string {
  if (!id) return '—';
  const person = ctx.deps.getModel().byId.get(id);
  if (person) return getDisplayName(person, ctx.lang);
  const profile = profiles.find((u) => u.id === id);
  if (profile) return profile.full_name || profile.email || '';
  return String(id).slice(0, 8);
}

function statusChip(label: string, tone: 'ok' | 'off'): HTMLElement {
  return h('span', { class: `chip chip--status chip--${tone}`, text: label });
}

/* --------------------------------- users ---------------------------------- */

/** The users tab's cached function answer, per panel instance. */
interface SignInState {
  map: Map<string, string | null>;
  /** Any failure to read last sign-ins (usually "function not deployed"). */
  missing: boolean;
}

const signInState = new WeakMap<AdminTabCtx, SignInState>();

/* ------------------------------- small parts ------------------------------ */

/** "Name · "nick" · Gen 3 — parent", language-aware (personform's pattern). */
function pickerLabel(ctx: AdminTabCtx, p: Person): string {
  const bits = [getDisplayName(p, ctx.lang)];
  if (p.nick) bits.push(`“${p.nick}”`);
  bits.push(ctx.i18n.fmt('chip.gen', { g: p.gen }));
  if (p.parent) bits.push(`— ${getDisplayName(p.parent, ctx.lang)}`);
  return bits.join(' · ');
}

/**
 * Branch picker: a filter box over a scrollable checkbox list of people —
 * the reference's branchPickerHtml, as real elements.
 */
function branchPicker(ctx: AdminTabCtx, selected: readonly string[]): HTMLElement {
  const T = t(ctx);
  const model = ctx.deps.getModel();
  const chosen = new Set(selected);
  const people = model.people
    .filter((p) => !p.is_deleted)
    .sort((a, b) => a.gen - b.gen || (a.name ?? '').localeCompare(b.name ?? ''));

  const filter = h('input', {
    class: 'input edit-input',
    type: 'search',
    id: 'bp_filter',
    placeholder: T('admin.inviteBranchesSearch'),
    autocomplete: 'off',
  });
  const rows = people.map((p) =>
    h(
      'label',
      { class: 'admin-check-row branch-item', dataset: { name: p._hay } },
      h('input', { type: 'checkbox', value: p.id, checked: chosen.has(p.id) }),
      h('span', { text: pickerLabel(ctx, p) }),
    ),
  );
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    for (const row of rows) row.hidden = !!q && !row.dataset.name?.includes(q);
  });

  return h(
    'div',
    { class: 'edit-field admin-branchpick' },
    h('label', { class: 'edit-label', text: T('admin.inviteBranches') }),
    filter,
    h('div', { class: 'admin-branchpick-list' }, ...rows),
  );
}

function readBranchPicker(root: HTMLElement): string[] {
  const picks: string[] = [];
  for (const box of root.querySelectorAll<HTMLInputElement>('.admin-check-row input[type=checkbox]')) {
    if (box.checked && box.value && box.value !== 'on') picks.push(box.value);
  }
  return picks;
}

/* ------------------------------- the accounts ------------------------------ */

function userCard(
  ctx: AdminTabCtx,
  u: ProfileRow,
  branchIds: readonly string[],
  lastSignIn: Map<string, string | null>,
  functionMissing: boolean,
  meId: string | null,
): HTMLElement {
  const T = t(ctx);
  const model = ctx.deps.getModel();
  const branchNames = branchIds.map((id) => {
    const person = model.byId.get(id);
    return person ? getDisplayName(person, ctx.lang) : String(id).slice(0, 8);
  });
  const name = u.full_name || u.email || '';
  const isMe = meId !== null && u.id === meId;
  // "never" would be a lie when the admin-users function is not deployed:
  // the browser simply cannot read auth.users.last_sign_in_at without it.
  const seenWhen =
    lastSignIn.has(u.id) && lastSignIn.get(u.id)
      ? fmtWhen(ctx, lastSignIn.get(u.id) as string)
      : T('admin.never');
  const lastSeen = functionMissing ? T('admin.unknown') : seenWhen;

  return h(
    'div',
    { class: 'admin-user', dataset: { user: u.id } },
    h(
      'div',
      { class: 'admin-user-main' },
      h(
        'div',
        { class: 'admin-user-name' },
        name,
        u.role === 'admin' ? h('span', { class: 'tag tag--admin', text: T('admin.adminTag') }) : null,
        u.active ? null : h('span', { class: 'tag tag--gray', text: T('admin.inactiveTag') }),
        isMe ? h('span', { class: 'tag tag--gray', text: T('admin.you') }) : null,
      ),
      h('div', { class: 'admin-user-email', text: u.email ?? '' }),
      h(
        'div',
        { class: 'admin-user-meta' },
        u.role === 'admin' ? T('admin.inviteRoleAdmin') : T('admin.inviteRoleEditor'),
      ),
      h(
        'div',
        { class: 'admin-user-meta' },
        h('b', { text: `${T('admin.col.branches')}: ` }),
        branchNames.length ? branchNames.join(', ') : h('i', { text: T('admin.noBranches') }),
      ),
      h(
        'div',
        { class: 'admin-user-meta' },
        h('b', { text: `${T('admin.col.lastSeen')}: ` }),
        lastSeen,
      ),
    ),
    h(
      'div',
      { class: 'admin-user-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost',
          dataset: { act: 'edit' },
          onclick: () => openEditUser(ctx, u, branchIds),
        },
        T('admin.editUser'),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost',
          dataset: { act: 'resend' },
          onclick: () => {
            void resendInvite(ctx, u);
          },
        },
        T('admin.resendInvite'),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost',
          dataset: { act: 'password' },
          onclick: () => openSetPassword(ctx, u),
        },
        T('admin.setTempPassword'),
      ),
      u.active
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn btn--danger',
              dataset: { act: 'deactivate' },
              onclick: () => {
                void changeActive(ctx, u, false);
              },
            },
            T('admin.deactivate'),
          )
        : h(
            'button',
            {
              type: 'button',
              class: 'btn btn--ghost',
              dataset: { act: 'activate' },
              onclick: () => {
                void changeActive(ctx, u, true);
              },
            },
            T('admin.activate'),
          ),
    ),
  );
}

/**
 * The account roster (H1–H3): invite, edit name/role/branches, a temporary
 * password, resend the invite e-mail and activate/deactivate. Everything an
 * RLS admin may write goes through REST; anything that needs the service-role
 * key goes through the vendored admin-users function. When it is missing the
 * tab says so (banner + "unknown" last-seen) while activate/deactivate still
 * degrade gracefully, exactly like the reference.
 */
export function renderUsersTab(ctx: AdminTabCtx): void {
  const T = t(ctx);
  ctx.body.replaceChildren(note(ctx, 'admin.usersLoading'));
  void (async () => {
    try {
      const [profiles, rows] = await Promise.all([
        fetchProfiles(ctx.deps.client),
        fetchBranchAccess(ctx.deps.client),
      ]);
      const branches = new Map<string, string[]>();
      for (const row of rows) {
        const list = branches.get(row.user_id) ?? [];
        list.push(row.person_id);
        branches.set(row.user_id, list);
      }

      let state = signInState.get(ctx);
      if (!state) {
        const signIn = new Map<string, string | null>();
        try {
          const data = await invokeAdminUsers<{ users?: AdminUserRow[] }>(ctx.deps.client, 'list');
          for (const u of data.users ?? []) signIn.set(u.id, u.last_sign_in_at ?? null);
          state = { map: signIn, missing: false };
        } catch {
          // The reference treats any list failure as "function missing": the
          // column reads "unknown" and the banner explains why.
          state = { map: signIn, missing: true };
        }
        signInState.set(ctx, state);
      }
      const info: SignInState = state;
      const meId = ctx.deps.profile()?.id ?? null;
      const cards = profiles.map((u) =>
        userCard(ctx, u, branches.get(u.id) ?? [], info.map, info.missing, meId),
      );

      connected(ctx, () => {
        ctx.body.replaceChildren(
          h(
            'div',
            { class: 'admin-users-body' },
            info.missing ? h('div', { class: 'admin-note', text: T('admin.notDeployed') }) : null,
            h(
              'div',
              { class: 'admin-bar' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--primary',
                  id: 'ad_invite',
                  onclick: () => openInvite(ctx),
                },
                T('admin.inviteTitle'),
              ),
            ),
            profiles.length
              ? h('div', { class: 'admin-list' }, ...cards)
              : h('div', { class: 'admin-note', text: T('admin.noUsers') }),
          ),
        );
      });
    } catch (err) {
      connected(ctx, () => ctx.body.replaceChildren(failure(ctx, err, 'admin.usersFailed')));
    }
  })();
}

/* ------------------------------ user management ----------------------------- */

let dialogSeq = 0;

function formError(): HTMLElement {
  return h('div', { class: 'edit-error', hidden: true });
}

function showError(box: HTMLElement, message: string): void {
  box.textContent = message;
  box.hidden = false;
}

/** Field row: label above input (the personform's edit-field pattern). */
function field(label: string, input: HTMLElement, id: string, required = false): HTMLElement {
  return h(
    'div',
    { class: 'edit-field' },
    h(
      'label',
      { class: 'edit-label', for: id },
      label,
      required ? h('span', { class: 'edit-req', text: ' *' }) : null,
    ),
    input,
  );
}

/** The invite composer (H1): name, e-mail, role, branch picker + live review. */
function openInvite(ctx: AdminTabCtx): void {
  const T = t(ctx);
  const error = formError();
  const emailInput = h('input', {
    class: 'input edit-input',
    id: 'iv_email',
    type: 'email',
    autocomplete: 'off',
  });
  const nameInput = h('input', {
    class: 'input edit-input',
    id: 'iv_name',
    type: 'text',
    autocomplete: 'off',
  });
  const roleSelect = h(
    'select',
    { class: 'input edit-input', id: 'iv_role' },
    h('option', { value: 'editor' }, T('admin.inviteRoleEditor')),
    h('option', { value: 'admin' }, T('admin.inviteRoleAdmin')),
  );
  const picker = branchPicker(ctx, []);
  const sendMail = h('input', { type: 'checkbox', id: 'iv_mail' });
  sendMail.checked = true;
  const review = h('div', { class: 'branch-note', id: 'iv_review' });

  const formId = `admin-user-form-${++dialogSeq}`;
  const form = h(
    'form',
    { id: formId, class: 'edit-form', novalidate: true },
    field(`${T('admin.inviteEmail')}`, emailInput, 'iv_email', true),
    field(`${T('admin.inviteName')}`, nameInput, 'iv_name', true),
    field(T('admin.inviteRole'), roleSelect, 'iv_role'),
    picker,
    h('label', { class: 'admin-check-row' }, sendMail, h('span', { text: T('admin.inviteSendMail') })),
    review,
    error,
  );

  let saving = false;

  function paintReview(): void {
    const model = ctx.deps.getModel();
    const role = roleSelect.value === 'admin' ? T('admin.inviteRoleAdmin') : T('admin.inviteRoleEditor');
    const picks = readBranchPicker(picker).map((id) => {
      const person = model.byId.get(id);
      return person ? getDisplayName(person, ctx.lang) : String(id).slice(0, 8);
    });
    review.replaceChildren(
      h('b', { text: T('branch.reviewTitle') }),
      h(
        'div',
        {},
        T('branch.reviewLine', {
          name: nameInput.value || '…',
          email: emailInput.value || '…',
          role,
          n: picks.length,
        }),
      ),
      picks.length
        ? h('div', {}, picks.join(' · '))
        : h('div', {}, h('i', { text: T('branch.reviewNoBranches') })),
    );
  }
  form.addEventListener('input', paintReview);
  form.addEventListener('change', paintReview);
  paintReview();

  const modal = openModal({
    title: T('admin.inviteTitle'),
    subtitle: T('admin.inviteSub'),
    content: form,
    dialogClass: 'modal--wide admin-user-modal',
    closeLabel: T('panel.close'),
    dismissible: () => !saving,
    actions: [
      { label: T('panel.cancel'), kind: 'ghost', onClick: (close) => close() },
      { label: T('admin.inviteSend'), kind: 'primary', type: 'submit', form: formId },
    ],
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    const fullName = nameInput.value.trim();
    if (!email) return showError(error, T('admin.emailRequired'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError(error, T('admin.emailInvalid'));
    if (!fullName) return showError(error, T('admin.nameRequired'));
    saving = true;
    void (async () => {
      try {
        const sendEmail = sendMail.checked;
        const outcome = await inviteAccount(ctx.deps.client, {
          email,
          fullName,
          role: roleSelect.value === 'admin' ? 'admin' : 'editor',
          branchPersonIds: readBranchPicker(picker),
          sendEmail,
        });
        if (sendEmail || !outcome.temporaryPassword) {
          ctx.deps.toast(T('admin.inviteDone', { email }));
        } else {
          // The password is shown once — the composer re-words it verbatim.
          ctx.deps.toast(T('admin.inviteNoMail', { pw: outcome.temporaryPassword }));
        }
        modal.close();
        ctx.refresh();
      } catch (err) {
        saving = false;
        showError(error, extractMessage(err) || T('admin.inviteFailed'));
      }
    })();
  });
}

/** Edit name / role / branches (H2). Everything REST-writable happens here. */
function openEditUser(ctx: AdminTabCtx, u: ProfileRow, branchIds: readonly string[]): void {
  const T = t(ctx);
  const isMe = ctx.deps.profile()?.id === u.id;
  const error = formError();
  const nameInput = h('input', {
    class: 'input edit-input',
    id: 'eu_name',
    type: 'text',
    autocomplete: 'off',
  });
  nameInput.value = u.full_name ?? '';
  const roleSelect = h(
    'select',
    { class: 'input edit-input', id: 'eu_role' },
    h('option', { value: 'editor', selected: u.role !== 'admin' }, T('admin.inviteRoleEditor')),
    h('option', { value: 'admin', selected: u.role === 'admin' }, T('admin.inviteRoleAdmin')),
  );
  if (isMe) roleSelect.setAttribute('disabled', '');
  const picker = branchPicker(ctx, branchIds);

  const formId = `admin-user-form-${++dialogSeq}`;
  const form = h(
    'form',
    { id: formId, class: 'edit-form', novalidate: true },
    field(T('admin.inviteName'), nameInput, 'eu_name'),
    field(T('admin.inviteRole'), roleSelect, 'eu_role'),
    isMe ? h('div', { class: 'edit-hint', text: T('admin.selfRole') }) : null,
    picker,
    error,
  );

  let saving = false;

  const modal = openModal({
    title: T('admin.editTitle', { name: u.full_name || u.email || '' }),
    content: form,
    dialogClass: 'modal--wide admin-user-modal',
    closeLabel: T('panel.close'),
    dismissible: () => !saving,
    actions: [
      { label: T('panel.cancel'), kind: 'ghost', onClick: (close) => close() },
      { label: T('admin.profileSave'), kind: 'primary', type: 'submit', form: formId },
    ],
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const fullName = nameInput.value.trim();
      if (!fullName) return showError(error, T('admin.nameRequired'));
      // The self-row's role cannot change (the select is disabled); sending
      // 'editor' would demote the caller, so keep the account's own role.
      const role: 'admin' | 'editor' = isMe
        ? u.role === 'admin'
          ? 'admin'
          : 'editor'
        : roleSelect.value === 'admin'
          ? 'admin'
          : 'editor';
      const picks = readBranchPicker(picker);

      // Phase 5C parity: confirm before rewriting someone's branches and
      // before handing out admin rights (plain window.confirm there).
      const before = [...branchIds].sort().join(',');
      const after = [...picks].sort().join(',');
      if (before !== after) {
        const ok = await confirmDialog({
          title: T('admin.editTitle', { name: u.full_name || u.email || '' }),
          message: T('admin.confirmBranches', { name: u.full_name || u.email || '' }),
          confirmLabel: T('admin.profileSave'),
          cancelLabel: T('panel.cancel'),
          closeLabel: T('panel.close'),
        });
        if (!ok) return;
      }
      if (!isMe && u.role !== 'admin' && role === 'admin') {
        const ok = await confirmDialog({
          title: T('admin.inviteRoleAdmin'),
          message: T('admin.confirmRole', { name: u.full_name || u.email || '' }),
          confirmLabel: T('admin.profileSave'),
          cancelLabel: T('panel.cancel'),
          kind: 'danger',
          closeLabel: T('panel.close'),
        });
        if (!ok) return;
      }

      saving = true;
      try {
        await updateProfile(ctx.deps.client, u.id, { full_name: fullName, role });
        try {
          await replaceBranchAccess(ctx.deps.client, u.id, picks);
        } catch (err) {
          // The profile edit landed; the branches did not — say both things.
          showError(error, extractMessage(err) || T('admin.branchesSaveFailed'));
          saving = false;
          return;
        }
        ctx.deps.toast(T('admin.branchesSaved'));
        modal.close();
        if (isMe) ctx.deps.refreshProfile?.();
        ctx.refresh();
      } catch (err) {
        saving = false;
        const raw = extractMessage(err);
        showError(
          error,
          /permission|policy/i.test(raw) ? T('admin.profilePermError') : raw || T('admin.profileFailed'),
        );
      }
    })();
  });
}

/** H3: activate/deactivate, guarded (no self-deactivation, confirm first). */
async function changeActive(ctx: AdminTabCtx, u: ProfileRow, active: boolean): Promise<void> {
  const T = t(ctx);
  const name = u.full_name || u.email || '';
  if (!active && ctx.deps.profile()?.id === u.id) {
    ctx.deps.toast(T('admin.selfActive'));
    return;
  }
  if (!active) {
    const ok = await confirmDialog({
      title: T('admin.deactivate'),
      message: T('admin.confirmDeactivate', { name }),
      confirmLabel: T('admin.deactivate'),
      cancelLabel: T('panel.cancel'),
      kind: 'danger',
      closeLabel: T('panel.close'),
    });
    if (!ok) return;
  }
  try {
    await setAccountActive(ctx.deps.client, u.id, active);
    ctx.deps.toast(active ? T('admin.activated', { name }) : T('admin.deactivated', { name }));
    ctx.refresh();
  } catch (err) {
    ctx.deps.toast(T('admin.changeFailed', { msg: extractMessage(err) }));
  }
}

/** Fresh invite / recovery e-mail through the function. */
async function resendInvite(ctx: AdminTabCtx, u: ProfileRow): Promise<void> {
  const T = t(ctx);
  try {
    await resendAccountEmail(ctx.deps.client, u.id);
    ctx.deps.toast(T('admin.resendDone', { email: u.email ?? '' }));
  } catch (err) {
    ctx.deps.toast(extractMessage(err) || T('admin.changeFailed', { msg: 'admin-users' }));
  }
}

/** A temporary sign-in password for a relative without e-mail. */
function openSetPassword(ctx: AdminTabCtx, u: ProfileRow): void {
  const T = t(ctx);
  const error = formError();
  const pwInput = h('input', {
    class: 'input edit-input',
    id: 'sp_pw',
    type: 'text',
    autocomplete: 'off',
  });

  const formId = `admin-user-form-${++dialogSeq}`;
  const form = h(
    'form',
    { id: formId, class: 'edit-form', novalidate: true },
    field(T('admin.tempPasswordLabel'), pwInput, 'sp_pw'),
    error,
  );

  let saving = false;

  const modal = openModal({
    title: T('admin.setTempPasswordTitle', { name: u.full_name || u.email || '' }),
    subtitle: T('admin.setTempPasswordSub'),
    content: form,
    dialogClass: 'admin-user-modal',
    closeLabel: T('panel.close'),
    dismissible: () => !saving,
    actions: [
      { label: T('panel.cancel'), kind: 'ghost', onClick: (close) => close() },
      { label: T('admin.setTempPassword'), kind: 'primary', type: 'submit', form: formId },
    ],
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const password = pwInput.value;
    if (password.length < 8) return showError(error, T('auth.pwTooShort'));
    saving = true;
    void (async () => {
      try {
        await setAccountPassword(ctx.deps.client, u.id, password);
        ctx.deps.toast(T('admin.setTempPasswordDone', { name: u.full_name || u.email || '' }));
        modal.close();
      } catch (err) {
        saving = false;
        showError(error, extractMessage(err));
      }
    })();
  });
}

/* ------------------------------ branch progress ---------------------------- */

/**
 * Branch progress (H4): for every editor with an assignment, how many
 * people their branch holds and how complete the saved records are —
 * computed live from the workspace model, exactly like the reference. The
 * sign-in column comes from the admin-users function when it is deployed;
 * "unknown" otherwise.
 */
export function renderBranchesTab(ctx: AdminTabCtx): void {
  const T = t(ctx);
  ctx.body.replaceChildren(note(ctx, 'generic.loading'));
  void (async () => {
    try {
      const [profiles, rows] = await Promise.all([
        fetchProfiles(ctx.deps.client),
        fetchBranchAccess(ctx.deps.client),
      ]);
      const branches = new Map<string, string[]>();
      for (const row of rows) {
        const list = branches.get(row.user_id) ?? [];
        list.push(row.person_id);
        branches.set(row.user_id, list);
      }
      // The Edge Function may be missing — the column then reads "unknown".
      const lastSignIn = await fetchLastSignInTimes(ctx.deps.client);
      const model = ctx.deps.getModel();

      const cards: HTMLElement[] = [];
      for (const u of profiles) {
        if (u.role !== 'editor') continue; // admins have no assignment
        const anchorIds = (branches.get(u.id) ?? []).filter((id) => model.byId.has(id));
        if (!anchorIds.length) continue;

        let total = 0;
        let done = 0;
        const anchors: string[] = [];
        const seen = new Set<string>();
        for (const anchorId of anchorIds) {
          const anchor = model.byId.get(anchorId);
          if (anchor) anchors.push(getDisplayName(anchor, ctx.lang));
          for (const p of branchPeopleOf(model, anchorId)) {
            if (seen.has(p.id)) continue;
            seen.add(p.id);
            if (p.is_deleted) continue;
            total += 1;
            const comp = completeness(p, model.kids.get(p.id) ?? []);
            if (!comp.missing.length) done += 1;
          }
        }

        const known = lastSignIn.get(u.id);
        const signInText =
          known === undefined
            ? T('admin.unknown')
            : known
              ? T('admin.statusSignedIn')
              : T('admin.statusNotSignedIn');

        cards.push(
          h(
            'div',
            { class: 'bp-row', dataset: { user: u.id } },
            h(
              'div',
              { class: 'bp-main' },
              h(
                'div',
                { class: 'bp-name' },
                u.full_name || u.email || '',
                statusChip(
                  u.active ? T('admin.statusActive') : T('admin.inactiveTag'),
                  u.active ? 'ok' : 'off',
                ),
              ),
              h('div', { class: 'bp-meta', text: u.email ?? '' }),
              h(
                'div',
                { class: 'bp-meta' },
                h('b', { text: `${T('admin.branchAnchor')}: ` }),
                anchors.length ? anchors.join(', ') : '—',
              ),
              h(
                'div',
                { class: 'bp-meta' },
                h('b', { text: `${T('admin.branchSignIn')}: ` }),
                signInText,
              ),
            ),
            h(
              'div',
              { class: 'bp-stats' },
              h('span', {}, T('admin.branchPeople'), ': ', h('b', { text: String(total) })),
              h('span', { class: 'bp-ok' }, T('admin.branchComplete'), ': ', h('b', { text: String(done) })),
              h(
                'span',
                { class: 'bp-miss' },
                T('admin.branchMissing'),
                ': ',
                h('b', { text: String(total - done) }),
              ),
            ),
          ),
        );
      }

      connected(ctx, () => {
        ctx.body.replaceChildren(
          h('p', { class: 'admin-hint', text: T('admin.branchesSub') }),
          cards.length
            ? h('div', { class: 'admin-list' }, ...cards)
            : h('div', { class: 'admin-note', text: T('admin.branchesNone') }),
        );
      });
    } catch (err) {
      connected(ctx, () => {
        ctx.body.replaceChildren(failure(ctx, err));
      });
    }
  })();
}

/* ----------------------------- deletion requests --------------------------- */

/**
 * The deletion queue (F2): pending requests first with approve/reject, then
 * resolved ones read-only. Approving soft-deletes the person first (a
 * living-descendant orphan still fails through the DB guard and surfaces
 * honestly), then marks the request.
 */
export function renderRequestsTab(ctx: AdminTabCtx): void {
  const T = t(ctx);
  ctx.body.replaceChildren(note(ctx, 'generic.loading'));
  void (async () => {
    try {
      const [requests, profiles] = await Promise.all([
        fetchDeletionRequests(ctx.deps.client),
        fetchProfiles(ctx.deps.client),
      ]);
      const pend = requests.filter((r) => r.status === 'pending');
      const rest = requests.filter((r) => r.status !== 'pending');

      const card = (r: DeletionRequestRow): HTMLElement => {
        const name = personName(ctx, r.person_id, profiles);
        const actions =
          r.status === 'pending'
            ? h(
                'div',
                { class: 'delreq-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--danger',
                    dataset: { status: 'approved' },
                    onclick: () => {
                      void resolveRequest(ctx, r, profiles, 'approved');
                    },
                  },
                  T('admin.approve'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--ghost',
                    dataset: { status: 'rejected' },
                    onclick: () => {
                      void resolveRequest(ctx, r, profiles, 'rejected');
                    },
                  },
                  T('admin.reject'),
                ),
              )
            : h(
                'span',
                {
                  class: 'req-tag',
                  text: r.status === 'approved' ? T('panel.action.delete') : T('admin.reject'),
                },
              );

        return h(
          'div',
          {
            class: `delreq-row ${r.status === 'pending' ? 'delreq-pending' : 'delreq-resolved'}`,
            dataset: { req: r.id },
          },
          h(
            'div',
            { class: 'delreq-text' },
            h('div', { class: 'delreq-person', text: name }),
            h(
              'div',
              { class: 'delreq-meta' },
              T('admin.requestBy', {
                name: personName(ctx, r.requested_by, profiles),
                when: fmtWhen(ctx, r.created_at),
              }),
            ),
            h(
              'div',
              { class: 'delreq-reason' },
              h('b', { text: `${T('admin.requestReason')}: ` }),
              r.reason || T('admin.requestNoReason'),
            ),
            r.status === 'pending'
              ? null
              : h('div', { class: 'delreq-meta' }, T('admin.requestResolved', { when: fmtWhen(ctx, r.resolved_at) })),
          ),
          actions,
        );
      };

      connected(ctx, () => {
        // Pending first, then resolved — the reference's queue order.
        const parts: HTMLElement[] = pend.length
          ? pend.map(card)
          : [h('div', { class: 'admin-note', text: T('admin.requestsNone') })];
        if (rest.length) parts.push(h('div', { class: 'admin-sep' }), ...rest.map(card));
        ctx.body.replaceChildren(h('div', { class: 'admin-list' }, ...parts));
      });
    } catch (err) {
      connected(ctx, () => {
        ctx.body.replaceChildren(failure(ctx, err));
      });
    }
  })();
}

async function resolveRequest(
  ctx: AdminTabCtx,
  row: DeletionRequestRow,
  profiles: ProfileRow[],
  status: 'approved' | 'rejected',
): Promise<void> {
  const T = t(ctx);
  if (status === 'approved') {
    const ok = await confirmDialog({
      title: T('admin.approveTitle'),
      message: T('admin.approveBody', { person: personName(ctx, row.person_id, profiles) }),
      confirmLabel: T('admin.approve'),
      cancelLabel: T('panel.cancel'),
      kind: 'danger',
      closeLabel: T('panel.close'),
    });
    if (!ok) return;
  }
  try {
    if (status === 'approved') {
      await setPersonDeleted(ctx.deps.client, row.person_id, true);
    }
    await resolveDeletionRequest(ctx.deps.client, row.id, status, ctx.deps.profile()?.id ?? null);
    ctx.deps.toast(status === 'approved' ? T('admin.requestApproved') : T('admin.requestRejected'));
    ctx.refresh();
    await ctx.deps.reload();
  } catch (err) {
    ctx.deps.toast(T('admin.resolveFailed', { msg: extractMessage(err) }));
  }
}

/* ----------------------------- recently deleted ---------------------------- */

/**
 * Recently deleted (F6): every soft-deleted person with a restore action.
 * Restoring puts the person back exactly where they were (the path never
 * changes), then re-selects them in the workspace.
 */
export function renderDeletedTab(ctx: AdminTabCtx): void {
  const T = t(ctx);
  ctx.body.replaceChildren(note(ctx, 'generic.loading'));
  void (async () => {
    try {
      const deleted = await fetchRecentlyDeleted(ctx.deps.client);
      connected(ctx, () => {
        const rows = deleted.map((p) => deletedRow(ctx, p));
        ctx.body.replaceChildren(
          h('p', { class: 'admin-hint', text: T('admin.deletedNote') }),
          deleted.length
            ? h('div', { class: 'admin-list' }, ...rows)
            : h('div', { class: 'admin-note', text: T('admin.deletedNone') }),
        );
      });
    } catch (err) {
      connected(ctx, () => ctx.body.replaceChildren(failure(ctx, err)));
    }
  })();
}

function deletedRow(ctx: AdminTabCtx, row: RecentlyDeletedRow): HTMLElement {
  const T = t(ctx);
  return h(
    'div',
    { class: 'del-row', dataset: { id: row.id } },
    h(
      'div',
      { class: 'del-main' },
      h('div', { class: 'del-name', text: row.full_name ?? '' }),
      h(
        'div',
        { class: 'del-meta' },
        T('admin.deletedWhen', { when: fmtWhen(ctx, row.updated_at) }),
        row.legacy_id ? ` · legacy ${row.legacy_id}` : '',
      ),
    ),
    h(
      'div',
      { class: 'del-actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--ghost',
          onclick: () => {
            void restoreRow(ctx, row);
          },
        },
        T('admin.restore'),
      ),
    ),
  );
}

async function restoreRow(ctx: AdminTabCtx, row: RecentlyDeletedRow): Promise<void> {
  const T = t(ctx);
  try {
    await setPersonDeleted(ctx.deps.client, row.id, false);
    ctx.deps.toast(T('admin.restored', { name: row.full_name ?? '' }));
    ctx.refresh();
    await ctx.deps.reload(row.id);
  } catch (err) {
    ctx.deps.toast(T('admin.restoreFailed', { msg: extractMessage(err) }));
  }
}

/* --------------------------------- activity -------------------------------- */

const ACTION_KEYS: ReadonlyArray<string> = ['insert', 'update', 'delete', 'restore', 'hard_delete'];

/**
 * The activity feed (H5): the newest 100 audit rows across the whole tree,
 * with user / person / action / date-range filters and old → new field
 * diffs, exactly as the reference computed them.
 */
export function renderActivityTab(ctx: AdminTabCtx): void {
  const T = t(ctx);
  let filter: ActivityFilter = { ...EMPTY_ACTIVITY_FILTER };
  ctx.body.replaceChildren(note(ctx, 'generic.loading'));

  async function run(): Promise<void> {
    ctx.body.replaceChildren(note(ctx, 'generic.loading'));
    try {
      const [activity, profiles] = await Promise.all([
        fetchActivity(ctx.deps.client, filter),
        fetchProfiles(ctx.deps.client),
      ]);
      const model = ctx.deps.getModel();

      const userOptions = profiles.map((u) =>
        h('option', { value: u.id, selected: filter.user === u.id }, u.full_name || u.email || u.id),
      );
      const personOptions = model.people
        .filter((p) => !p.is_deleted)
        .map((p) => h('option', { value: p.id, selected: filter.person === p.id }, getDisplayName(p, ctx.lang)));
      const actionOptions = ACTION_KEYS.map((a) =>
        h(
          'option',
          { value: a, selected: filter.action === a },
          ctx.i18n.t(`panel.action.${a}` as MessageKey),
        ),
      );

      const filters = h(
        'div',
        { class: 'admin-filters' },
        h(
          'label',
          {},
          T('admin.filterUser'),
          h(
            'select',
            { class: 'input', id: 'fl-user' },
            h('option', { value: '' }, T('status.everyone')),
            ...userOptions,
          ),
        ),
        h(
          'label',
          {},
          T('admin.filterPerson'),
          h(
            'select',
            { class: 'input', id: 'fl-person' },
            h('option', { value: '' }, T('status.everyone')),
            ...personOptions,
          ),
        ),
        h(
          'label',
          {},
          T('admin.filterAction'),
          h(
            'select',
            { class: 'input', id: 'fl-action' },
            h('option', { value: '' }, T('status.everyone')),
            ...actionOptions,
          ),
        ),
        h(
          'label',
          {},
          T('admin.filterFrom'),
          h('input', { class: 'input', type: 'date', id: 'fl-from', value: filter.from }),
        ),
        h(
          'label',
          {},
          T('admin.filterTo'),
          h('input', { class: 'input', type: 'date', id: 'fl-to', value: filter.to }),
        ),
        h('button', { type: 'button', class: 'btn btn--primary', id: 'fl-apply' }, T('admin.filterApply')),
        h('button', { type: 'button', class: 'btn btn--ghost', id: 'fl-clear' }, T('admin.filterClear')),
      );

      const deltas = (row: (typeof activity)[number]): HTMLElement | null => {
        if (row.action === 'insert') return null;
        const rows = fieldDiffs(row.old_data, row.new_data).map((change) =>
          h(
            'div',
            { class: 'change-row' },
            h('b', { text: ctx.i18n.t(change.labelKey) }),
            ' ',
            h('span', { class: 'change-old', text: change.before === '' ? '—' : change.before }),
            ' → ',
            h('span', { class: 'change-new', text: change.after === '' ? '—' : change.after }),
          ),
        );
        return rows.length ? h('div', { class: 'audit-delta' }, ...rows) : null;
      };

      const auditRows = activity.map((row) =>
        h(
          'div',
          { class: 'audit-row' },
          h(
            'div',
            { class: 'audit-meta' },
            h(
              'span',
              { class: `audit-action ${row.action}` },
              ctx.i18n.t(`panel.action.${row.action}` as MessageKey),
            ),
            ' · ',
            row.changed_by_name || '—',
            ' · ',
            fmtWhen(ctx, row.changed_at),
            row.person_id ? ` · ${personName(ctx, row.person_id, profiles)}` : '',
          ),
          deltas(row),
        ),
      );

      connected(ctx, () => {
        ctx.body.replaceChildren(
          filters,
          h('p', { class: 'admin-hint', text: T('admin.activitySub') }),
          activity.length
            ? h('div', { class: 'admin-list' }, ...auditRows)
            : h('div', { class: 'admin-note', text: T('admin.activityNone') }),
        );
      });

      ctx.body.querySelector('#fl-apply')?.addEventListener('click', () => {
        filter = {
          user: ctx.body.querySelector<HTMLSelectElement>('#fl-user')?.value ?? '',
          person: ctx.body.querySelector<HTMLSelectElement>('#fl-person')?.value ?? '',
          action: ctx.body.querySelector<HTMLSelectElement>('#fl-action')?.value ?? '',
          from: ctx.body.querySelector<HTMLInputElement>('#fl-from')?.value ?? '',
          to: ctx.body.querySelector<HTMLInputElement>('#fl-to')?.value ?? '',
        };
        void run();
      });
      ctx.body.querySelector('#fl-clear')?.addEventListener('click', () => {
        filter = { ...EMPTY_ACTIVITY_FILTER };
        void run();
      });
    } catch (err) {
      connected(ctx, () => ctx.body.replaceChildren(failure(ctx, err)));
    }
  }

  void run();
}
