import type { SupabaseClient } from '@supabase/supabase-js';
import { formatWhen } from '../../core/dates';
import type { I18n, MessageKey } from '../../core/i18n';
import { getDisplayName } from '../../core/i18n/display';
import type { WorkspacePermissions } from '../../core/permissions';
import {
  fetchAuditLog,
  requestDeletion as submitDeletionRequest,
  setPersonDeleted,
  updatePerson,
  type AuditRow,
} from '../../data/people';
import { confirmDialog } from '../../ui/confirm';
import { h } from '../../ui/dom';
import { openModal } from '../../ui/modal';
import { extractMessage } from '../auth/errors';
import { fieldDiffs, restorePayloadFromAudit } from './fields';
import type { Person, TreeModel } from './model';
import type { DetailsActions } from './panel';
import { openPersonForm } from './personform';
import {
  photoErrorMessage,
  removePhoto as removeStoredPhoto,
  signedPhotoUrl,
  uploadPhoto as uploadStoredPhoto,
} from './photo';

/**
 * Everything the details sheet and the branch workspace ask for beyond
 * rendering: the person form, deletion requests, soft delete / restore, the
 * change history with "restore this version", and the photo flows. Ported
 * from the reference `js/app.js` (startAddChild … restoreVersion) with the
 * same database contract and the same messages; every write goes through
 * `src/data/people.ts` so the whitelist and error mapping live in one place.
 *
 * All failures are reported through `toast` here — callers only manage their
 * own busy states.
 */

export interface WorkspaceActionDeps {
  i18n: I18n;
  client: SupabaseClient;
  permissions: WorkspacePermissions;
  getModel(): TreeModel;
  toast(message: string): void;
  /** Reload all rows, rebuild, re-render; selects `id` (null = nothing). */
  reloadAndSelect(id: string | null, options?: { focus?: boolean }): Promise<void>;
  /** Re-render the details sheet for the current selection. */
  refreshSelected(): void;
  /** Close the details sheet (no animation). */
  closeDetails(): void;
  /** Language-aware label for a person (dialogs and pickers). */
  labelOf(person: Person): string;
}

export function createWorkspaceActions(deps: WorkspaceActionDeps): DetailsActions {
  const { i18n, client, permissions } = deps;
  const t = (key: MessageKey): string => i18n.t(key);
  const displayName = (person: Person): string => getDisplayName(person, i18n.currentLang());

  /** The audit list is open for at most one person at a time. */
  let historyOpenFor: string | null = null;

  /** Any re-render closes the history again (its box is rebuilt fresh). */
  async function reloadAndSelect(id: string | null, options?: { focus?: boolean }): Promise<void> {
    historyOpenFor = null;
    await deps.reloadAndSelect(id, options);
  }

  function refreshSelected(): void {
    historyOpenFor = null;
    deps.refreshSelected();
  }

  /* -------------------------------- the form -------------------------------- */

  function openForm(options: Parameters<typeof openPersonForm>[0]): void {
    openPersonForm(options, {
      i18n,
      client,
      isAdmin: () => permissions.isAdmin(),
      getPeople: () => deps.getModel().people,
      labelOf: deps.labelOf,
      toast: deps.toast,
      onSaved: (personId) => reloadAndSelect(personId, { focus: true }),
    });
  }

  /* ---------------------------- deletion request ---------------------------- */

  function requestDelete(person: Person): void {
    const reason = h('textarea', {
      class: 'input edit-input',
      id: 'dr_reason',
      rows: '4',
      placeholder: t('panel.deletionReasonPlaceholder'),
    });
    const error = h('div', { class: 'edit-error', hidden: true });
    const form = h(
      'form',
      { class: 'edit-form', id: 'dr-form', novalidate: true },
      h(
        'div',
        { class: 'edit-field' },
        h(
          'label',
          { class: 'edit-label', for: 'dr_reason' },
          t('panel.deletionReason'),
          h('span', { class: 'edit-req' }, ' *'),
        ),
        reason,
        error,
      ),
      h('p', { class: 'admin-hint', text: t('panel.requestDeletionNote') }),
    );

    let submitting = false;
    const modal = openModal({
      title: i18n.fmt('panel.requestDeletionTitle', { name: displayName(person) }),
      subtitle: t('panel.requestDeletionSub'),
      content: form,
      closeLabel: t('panel.close'),
      dismissible: () => !submitting,
      actions: [
        { label: t('panel.cancel'), kind: 'ghost', onClick: (close) => close() },
        { label: t('panel.submitRequest'), kind: 'accent', type: 'submit', form: 'dr-form' },
      ],
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (submitting) return;
      const text = reason.value.trim();
      if (!text) {
        error.hidden = false;
        error.textContent = t('edit.fullNameRequired');
        reason.setAttribute('aria-invalid', 'true');
        reason.focus();
        return;
      }
      submitting = true;
      const button = document.querySelector<HTMLButtonElement>('button[form="dr-form"]');
      if (button) button.disabled = true;
      void submitDeletionRequest(client, person.id, text)
        .then(() => {
          modal.close();
          deps.toast(t('save.requestSubmitted'));
          refreshSelected();
        })
        .catch((err: unknown) => {
          const msg = extractMessage(err);
          deps.toast(
            /permission|forbids|not allowed|policy/i.test(msg)
              ? t('save.permError')
              : i18n.fmt('save.deleteRequestFailed', { msg }),
          );
          submitting = false;
          if (button) button.disabled = false;
        });
    });

    window.setTimeout(() => reason.focus(), 0);
  }

  /* ---------------------------- soft delete / restore ---------------------------- */

  /**
   * All (visible) descendants of a person, nearest first — the input to the
   * living-descendant guard. Soft-deleted rows are outside the model unless
   * the admin turned `#show-deleted` on; the guard rule itself (any living,
   * non-deleted descendant refuses the delete) is unaffected.
   */
  function descendantsOf(model: TreeModel, id: string): Person[] {
    const out: Person[] = [];
    const self = model.byId.get(id);
    if (!self) return out;
    const walk = (person: Person): void => {
      for (const child of model.kids.get(person.id) ?? []) {
        out.push(child);
        walk(child);
      }
    };
    walk(self);
    return out;
  }

  async function softDelete(person: Person): Promise<void> {
    const below = descendantsOf(deps.getModel(), person.id);
    const notDeleted = below.filter((d) => !d.is_deleted);
    const living = notDeleted.filter((d) => !d.dod);
    if (living.length) {
      // Refuse: deleting this person would orphan a living relative.
      openModal({
        title: i18n.fmt('panel.deleteBlockedTitle', { name: displayName(person) }),
        content: i18n.fmt('panel.deleteBlocked', { n: notDeleted.length, alive: living.length }),
        closeLabel: t('panel.close'),
        actions: [{ label: t('generic.close'), kind: 'primary', onClick: (close) => close() }],
      });
      return;
    }
    const ok = await confirmDialog({
      title: i18n.fmt('panel.deleteTitle', { name: displayName(person) }),
      message: `${t('panel.deleteConfirm')} ${i18n.fmt('panel.deleteDescendants', { n: below.length })}`,
      confirmLabel: t('panel.softDelete'),
      cancelLabel: t('panel.cancel'),
      kind: 'danger',
      closeLabel: t('panel.close'),
    });
    if (!ok) return;
    try {
      await setPersonDeleted(client, person.id, true);
      deps.closeDetails();
      deps.toast(i18n.fmt('panel.deleteDone', { name: displayName(person) }));
      await reloadAndSelect(null);
    } catch (err) {
      const msg = extractMessage(err);
      deps.toast(
        i18n.fmt('panel.deleteFailed', { msg: /Only an admin/.test(msg) ? t('save.deleteRestoreError') : msg }),
      );
      refreshSelected();
    }
  }

  async function restorePerson(person: Person): Promise<void> {
    try {
      await setPersonDeleted(client, person.id, false);
      deps.toast(t('save.restored'));
      await reloadAndSelect(person.id, { focus: false });
    } catch (err) {
      deps.toast(i18n.fmt('panel.deleteFailed', { msg: extractMessage(err) }));
      refreshSelected();
    }
  }

  /* ------------------------------- the history ------------------------------- */

  function toggleHistory(person: Person, box: HTMLElement, toggleBtn: HTMLButtonElement): void {
    if (historyOpenFor === person.id) {
      historyOpenFor = null;
      box.replaceChildren();
      box.hidden = true;
      toggleBtn.textContent = t('panel.showHistory');
      return;
    }
    historyOpenFor = person.id;
    box.hidden = false;
    toggleBtn.textContent = t('panel.hideHistory');
    void loadHistory(person, box);
  }

  async function loadHistory(person: Person, box: HTMLElement): Promise<void> {
    box.replaceChildren(h('div', { class: 'p-none', text: t('panel.historyLoading') }));
    try {
      const rows = await fetchAuditLog(client, person.id);
      if (historyOpenFor !== person.id || !box.isConnected) return;
      const title = h('h5', { class: 'hist-title', text: t('panel.history') });
      box.replaceChildren(
        title,
        ...(rows.length
          ? rows.map((row) => historyRow(row, person))
          : [h('div', { class: 'p-none', text: t('panel.historyNone') })]),
      );
    } catch (err) {
      if (!box.isConnected) return;
      box.replaceChildren(
        h('div', { class: 'p-none', text: i18n.fmt('panel.historyFailed', { msg: extractMessage(err) }) }),
      );
    }
  }

  function historyRow(record: AuditRow, person: Person): HTMLElement {
    const known = ['insert', 'update', 'delete', 'restore', 'hard_delete'];
    const actionLabel = known.includes(record.action)
      ? t(`panel.action.${record.action}` as MessageKey)
      : record.action;
    const when = formatWhen(record.changed_at) || '—';
    const who =
      record.changed_by_name || (record.changed_by ? '#' + String(record.changed_by).slice(0, 8) : '—');
    const diffs = fieldDiffs(record.old_data, record.new_data);
    const canRestore = record.action === 'update' && !!record.old_data && permissions.canEditPerson(person.id, person.path);

    return h(
      'div',
      { class: 'audit-row' },
      h(
        'div',
        { class: 'audit-meta' },
        h('span', { class: `audit-action audit-action--${record.action}`, text: actionLabel }),
        h('span', { text: ` · ${who} · ${when}` }),
      ),
      diffs.length
        ? h(
            'details',
            { class: 'audit-details' },
            h('summary', { text: i18n.fmt('panel.changedFields', { n: diffs.length }) }),
            ...diffs.map((d) =>
              h(
                'div',
                { class: 'change-row' },
                h('b', { text: i18n.t(d.labelKey) }),
                ' ',
                h('span', { class: 'change-old', text: d.before === '' ? '—' : d.before }),
                ' → ',
                h('span', { class: 'change-new', text: d.after === '' ? '—' : d.after }),
              ),
            ),
          )
        : null,
      canRestore
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn btn--sm',
              dataset: { restoreVersion: String(record.id) },
              onclick: (event: MouseEvent) =>
                void restoreVersion(person, record, event.currentTarget as HTMLButtonElement),
            },
            t('panel.restoreVersion'),
          )
        : null,
    );
  }

  async function restoreVersion(
    person: Person,
    record: AuditRow,
    button: HTMLButtonElement,
  ): Promise<void> {
    if (!record.old_data) return;
    const ok = await confirmDialog({
      title: t('panel.restoreVersion'),
      message: i18n.fmt('panel.restoreConfirm', { when: formatWhen(record.changed_at) || '' }),
      confirmLabel: t('panel.restoreVersion'),
      cancelLabel: t('panel.cancel'),
      closeLabel: t('panel.close'),
    });
    if (!ok) return;
    const payload = restorePayloadFromAudit(record.old_data, permissions.isAdmin());
    button.disabled = true;
    try {
      await updatePerson(client, person.id, payload);
      deps.toast(t('panel.restoreDone'));
      await reloadAndSelect(person.id, { focus: false });
    } catch (err) {
      deps.toast(i18n.fmt('panel.restoreFailed', { msg: extractMessage(err) }));
      if (button.isConnected) button.disabled = false;
    }
  }

  /* ---------------------------------- photos --------------------------------- */

  async function uploadPersonPhoto(person: Person, file: File): Promise<void> {
    try {
      await uploadStoredPhoto(client, person.id, file, person.photo_path);
      deps.toast(t('photos.uploaded'));
      await reloadAndSelect(person.id, { focus: false });
    } catch (err) {
      deps.toast(photoErrorMessage(i18n, err));
      throw err;
    }
  }

  async function removePersonPhoto(person: Person): Promise<void> {
    const ok = await confirmDialog({
      title: t('photos.remove'),
      message: t('photos.removeConfirm'),
      confirmLabel: t('photos.remove'),
      cancelLabel: t('panel.cancel'),
      kind: 'danger',
      closeLabel: t('panel.close'),
    });
    if (!ok) return;
    try {
      await removeStoredPhoto(client, person.id, person.photo_path);
      deps.toast(t('photos.removed'));
      await reloadAndSelect(person.id, { focus: false });
    } catch (err) {
      deps.toast(photoErrorMessage(i18n, err));
      throw err;
    }
  }

  /* --------------------------------- the object --------------------------------- */

  return {
    canEditPerson: (person) => permissions.canEditPerson(person.id, person.path),
    isAdmin: () => permissions.isAdmin(),
    isActiveEditor: () => permissions.isActiveEditor(),
    edit: (person) => openForm({ mode: 'edit', person }),
    addChild: (person) => openForm({ mode: 'addchild', parent: person }),
    addRoot: () => openForm({ mode: 'addroot' }),
    requestDeletion: (person) => requestDelete(person),
    softDelete: (person) => softDelete(person),
    restorePerson: (person) => restorePerson(person),
    toggleHistory,
    photoUrl: (path) => signedPhotoUrl(client, path),
    uploadPhoto: (person, file) => uploadPersonPhoto(person, file),
    removePhoto: (person) => removePersonPhoto(person),
  };
}
