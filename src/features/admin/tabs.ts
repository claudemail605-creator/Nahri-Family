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
  resolveDeletionRequest,
  type ActivityFilter,
  type DeletionRequestRow,
  type RecentlyDeletedRow,
} from '../../data/admin';
import { setPersonDeleted } from '../../data/people';
import { branchPeopleOf, completeness } from '../tree/branch';
import { fieldDiffs } from '../tree/fields';
import { h } from '../../ui/dom';
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
