import type { SupabaseClient } from '@supabase/supabase-js';
import { ageYears, formatWhen } from '../../core/dates';
import type { I18n } from '../../core/i18n';
import { getDisplayName } from '../../core/i18n/display';
import type { Lang } from '../../core/types';
import { h } from '../../ui/dom';
import { openLightbox } from '../../ui/lightbox';
import { genderClass, type Person, type TreeModel } from './model';
import { photoValidationMessage, validatePhoto } from './photo';
import { genderLabelKey } from './render';

/**
 * The details sheet — the reference panel's sections (Personal / Family /
 * Passing / Relatives / Record / localized names) plus the Phase 4 layers:
 * the action bar (edit, add child, add root, request deletion, soft
 * delete/restore, history), the photo section (signed URL, upload / replace /
 * remove, lightbox) and the change-history box.
 *
 * Everything interactive is delegated to `DetailsActions` (built by
 * `actions.ts`), so this module only renders and reports clicks. The panel
 * never decides permissions itself — `canEditPerson` comes from the same
 * database mirror the RLS uses.
 */

export interface DetailsActions {
  canEditPerson(person: Person): boolean;
  isAdmin(): boolean;
  isActiveEditor(): boolean;
  edit(person: Person): void;
  addChild(person: Person): void;
  addRoot(): void;
  requestDeletion(person: Person): void;
  softDelete(person: Person): Promise<void>;
  restorePerson(person: Person): Promise<void>;
  /** Load + render the audit list into `box`; flips the toggle button's label. */
  toggleHistory(person: Person, box: HTMLElement, toggleBtn: HTMLButtonElement): void;
  /** Signed URL for a stored photo (cached); null when there is nothing. */
  photoUrl(path: string): Promise<string | null>;
  /** Upload a chosen file for the person. Resolves when saved (or throws). */
  uploadPhoto(person: Person, file: File): Promise<void>;
  /** Confirm + remove the stored photo. Resolves when saved (or throws). */
  removePhoto(person: Person): Promise<void>;
}

export interface DetailsPanelDeps {
  i18n: I18n;
  lang: Lang;
  client: SupabaseClient;
  actions: DetailsActions;
  toast(message: string): void;
  onClose(): void;
  /** Relative-button click: select + centre that person. */
  onNavigate(personId: string): void;
}

export function renderDetails(
  host: HTMLElement,
  person: Person,
  model: TreeModel,
  deps: DetailsPanelDeps,
): void {
  const { i18n, lang, actions } = deps;
  const name = getDisplayName(person, lang);
  const kids = model.kids.get(person.id) ?? [];
  const siblings = person.parent
    ? (model.kids.get(person.parent.id) ?? []).filter((x) => x.id !== person.id)
    : [];
  const age = ageYears(person.dob, person.dod);

  function row(label: string, value: string | null | undefined): HTMLElement | null {
    if (value == null || value === '') return null;
    return h(
      'div',
      { class: 'p-row' },
      h('div', { class: 'p-row__k', text: label }),
      h('div', { class: 'p-row__v', text: value }),
    );
  }

  function section(title: string, rows: Array<HTMLElement | null>): HTMLElement | null {
    const kept = rows.filter((r): r is HTMLElement => r !== null);
    if (!kept.length) return null;
    return h('div', { class: 'p-sec' }, h('h5', { text: title }), ...kept);
  }

  function relButtons(list: Person[]): HTMLElement {
    return h(
      'div',
      { class: 'rel' },
      ...list.map((p) =>
        h(
          'button',
          {
            type: 'button',
            class: 'rel__btn',
            dataset: { goto: p.id },
            onclick: () => deps.onNavigate(p.id),
          },
          (p.nick ? p.nick + ' – ' : '') + getDisplayName(p, lang),
        ),
      ),
    );
  }

  /** Run an async action with the button disabled (label swap optional). */
  function busy(button: HTMLButtonElement, label: string | null, task: () => Promise<void>): void {
    const previous = button.textContent;
    button.disabled = true;
    if (label) button.textContent = label;
    void task()
      .catch(() => {
        /* the action layer has already reported the failure */
      })
      .finally(() => {
        if (button.isConnected) {
          button.disabled = false;
          button.textContent = previous;
        }
      });
  }

  function actionButton(
    id: string,
    kind: string,
    label: string,
    onclick: (button: HTMLButtonElement) => void,
  ): HTMLButtonElement {
    return h(
      'button',
      {
        type: 'button',
        class: `btn btn--sm ${kind}`.trim(),
        id,
        onclick: (event: MouseEvent) => onclick(event.currentTarget as HTMLButtonElement),
      },
      label,
    );
  }

  /* ------------------------------- sections ------------------------------- */

  const personal = section(i18n.t('panel.personal'), [
    row(i18n.t('edit.dob'), person.dob_display || person.dob),
    row(
      i18n.t('panel.age'),
      age == null ? null : i18n.fmt(person.dod ? 'panel.ageAtDeath' : 'panel.ageValue', { n: age }),
    ),
    row(i18n.t('edit.pob'), person.pob),
    row(i18n.t('edit.qual'), person.qual),
  ]);

  const family = section(i18n.t('panel.family'), [
    row(i18n.t('edit.father'), person.father),
    row(i18n.t('edit.mother'), person.mother),
    row(i18n.t('edit.spouse'), person.spouse),
    row(i18n.t('edit.spouseFather'), person.spouseFather),
  ]);

  const passing = section(i18n.t('panel.passing'), [
    row(i18n.t('edit.dod'), person.dod_display || person.dod),
    row(i18n.t('edit.burial'), person.burial),
  ]);

  const relatives: Array<HTMLElement | null> = [];
  if (person.parent) {
    relatives.push(
      h('div', { class: 'rel-label', text: i18n.t('panel.parent') }),
      relButtons([person.parent]),
    );
  }
  if (siblings.length) {
    relatives.push(
      h('div', { class: 'rel-label', text: i18n.fmt('panel.siblings', { n: siblings.length }) }),
      relButtons(siblings),
    );
  }
  if (kids.length) {
    relatives.push(
      h('div', { class: 'rel-label', text: i18n.fmt('panel.children', { n: kids.length }) }),
      relButtons(kids),
    );
  }
  const relativesSec = relatives.length
    ? h('div', { class: 'p-sec' }, h('h5', { text: i18n.t('panel.relatives') }), ...relatives)
    : null;

  let lastEditedSlot: HTMLElement | null = null;
  if (person.updated_at) {
    lastEditedSlot = h('div', { class: 'p-row__v', dataset: { lastEdited: '1' } });
    lastEditedSlot.textContent = formatWhen(person.updated_at) ?? '';
  }
  const record = section(i18n.t('panel.record'), [
    row(i18n.t('table.col.id'), person.id),
    row(i18n.t('table.col.legacyId'), person.legacy_id),
    row(i18n.t('edit.parentField'), person.parentId),
    row(i18n.t('table.col.source'), person.source),
    lastEditedSlot
      ? h(
          'div',
          { class: 'p-row' },
          h('div', { class: 'p-row__k', text: i18n.t('panel.lastEdited') }),
          lastEditedSlot,
        )
      : null,
  ]);

  const nameUr = person.name_ur
    ? h(
        'div',
        { class: 'p-sec' },
        h('h5', { text: i18n.t('panel.nameUr') }),
        h('div', { class: 'p-row' }, h('div', { class: 'p-row__v p-row__v--full', dir: 'rtl', text: person.name_ur })),
      )
    : null;
  const nameHi = person.name_hi
    ? h(
        'div',
        { class: 'p-sec' },
        h('h5', { text: i18n.t('panel.nameHi') }),
        h('div', { class: 'p-row' }, h('div', { class: 'p-row__v p-row__v--full', text: person.name_hi })),
      )
    : null;

  /* --------------------------------- photo --------------------------------- */

  const hasPhoto = !!person.photo_path;
  const canManagePhoto = actions.canEditPerson(person) && !person.is_deleted;
  const photoAlt = i18n.fmt('photos.alt', { name });

  const photoImg = h('img', {
    class: 'photo-frame__img',
    id: 'panel-photo-img',
    alt: photoAlt,
    hidden: true,
  });
  const photoEmpty = h(
    'span',
    { class: 'photo-frame__empty', id: 'panel-photo-empty' },
    i18n.t(hasPhoto ? 'photos.loading' : 'photos.none'),
  );
  const photoZoom = h(
    'button',
    {
      type: 'button',
      class: 'photo-frame__zoom',
      id: 'panel-photo-zoom',
      'aria-label': i18n.t('photos.viewLarger'),
      title: i18n.t('photos.viewLarger'),
      hidden: true,
    },
    '⤢',
  );
  const photoFrame = h(
    'div',
    { class: 'photo-frame', id: 'panel-photo-frame' },
    photoImg,
    photoEmpty,
    photoZoom,
  );

  photoImg.addEventListener('click', () => {
    if (!photoImg.hidden && photoImg.src) openLightbox({ src: photoImg.src, alt: photoAlt, closeLabel: i18n.t('panel.close') });
  });
  photoZoom.addEventListener('click', () => {
    if (!photoImg.hidden && photoImg.src) openLightbox({ src: photoImg.src, alt: photoAlt, closeLabel: i18n.t('panel.close') });
  });

  const avatar = h(
    'div',
    { class: `p-avatar p-avatar--${genderClass(person)}`, 'aria-hidden': 'true' },
    person._initials,
    h('img', { class: 'p-avatar__img', id: 'panel-avatar-img', alt: '', hidden: true }),
  );

  if (hasPhoto) {
    void actions
      .photoUrl(person.photo_path as string)
      .then((url) => {
        // The sheet may have moved on to another person while we waited.
        if (!url || host.dataset.personId !== person.id || !photoImg.isConnected) return;
        photoImg.onload = () => {
          photoImg.hidden = false;
          photoEmpty.hidden = true;
          photoZoom.hidden = false;
          const avatarImg = avatar.querySelector('img');
          if (avatarImg instanceof HTMLImageElement) {
            avatarImg.src = url;
            avatarImg.hidden = false;
          }
        };
        photoImg.onerror = () => {
          photoEmpty.textContent = i18n.t('photos.errLoad');
        };
        photoImg.src = url;
      })
      .catch((err: unknown) => {
        console.warn('Could not sign the photo URL:', err);
        photoEmpty.textContent = i18n.t('photos.errLoad');
      });
  }

  const photoActions: Array<HTMLElement | null> = [];
  if (canManagePhoto) {
    const pickInput = h('input', {
      type: 'file',
      id: 'panel-photo-input',
      accept: 'image/jpeg,image/png,image/webp',
      hidden: true,
    });
    const pickBtn = actionButton(
      'panel-photo-pick',
      '',
      i18n.t(hasPhoto ? 'photos.replace' : 'photos.upload'),
      () => pickInput.click(),
    );
    pickInput.addEventListener('change', () => {
      const file = pickInput.files?.[0] ?? null;
      pickInput.value = '';
      if (!file) return;
      const check = validatePhoto(file);
      const message = photoValidationMessage(i18n, file, check);
      if (message) {
        deps.toast(message);
        return;
      }
      busy(pickBtn, i18n.t('photos.uploading'), () => actions.uploadPhoto(person, file));
    });
    photoActions.push(pickBtn, pickInput);
    if (hasPhoto) {
      const removeBtn = actionButton('panel-photo-remove', 'btn--danger', i18n.t('photos.remove'), (button) =>
        busy(button, i18n.t('photos.removing'), () => actions.removePhoto(person)),
      );
      photoActions.push(removeBtn);
    }
  }

  const photoSec = h(
    'div',
    { class: 'p-sec p-photo' },
    h('h5', { text: i18n.t('panel.photo') }),
    photoFrame,
    photoActions.length ? h('div', { class: 'photo-actions' }, ...photoActions.filter((b): b is HTMLElement => !!b)) : null,
  );

  /* ------------------------------- action bar ------------------------------- */

  const canEdit = actions.canEditPerson(person);
  const isAdmin = actions.isAdmin();
  const actionButtons: HTMLElement[] = [];

  if (!person.is_deleted) {
    if (canEdit) {
      actionButtons.push(
        actionButton('panel-edit', '', i18n.t('panel.edit'), () => actions.edit(person)),
        actionButton('panel-add-child', 'btn--primary', i18n.t('panel.addChild'), () => actions.addChild(person)),
      );
    }
    if (isAdmin) {
      actionButtons.push(actionButton('panel-add-root', '', i18n.t('panel.addRoot'), () => actions.addRoot()));
    }
    if (actions.isActiveEditor() && canEdit) {
      actionButtons.push(
        actionButton('panel-request-deletion', '', i18n.t('panel.requestDeletion'), () =>
          actions.requestDeletion(person),
        ),
      );
    }
    if (isAdmin) {
      actionButtons.push(
        actionButton('panel-soft-delete', 'btn--danger', i18n.t('panel.softDelete'), (button) =>
          busy(button, null, () => actions.softDelete(person)),
        ),
      );
    }
  } else if (isAdmin) {
    actionButtons.push(
      actionButton('panel-restore', 'btn--primary', i18n.t('panel.restore'), (button) =>
        busy(button, null, () => actions.restorePerson(person)),
      ),
    );
  }

  const historyBox = h('div', { class: 'p-audit', id: 'panel-history-box', hidden: true });
  let historyButton: HTMLButtonElement | null = null;
  if (canEdit || isAdmin) {
    historyButton = actionButton('panel-history', '', i18n.t('panel.showHistory'), (button) =>
      actions.toggleHistory(person, historyBox, button),
    );
    actionButtons.push(historyButton);
  }

  const actionBar = actionButtons.length
    ? h('div', { class: 'p-actions', id: 'panel-actions' }, ...actionButtons)
    : null;

  /* --------------------------------- head --------------------------------- */

  const tags = h(
    'div',
    { class: 'p-tags' },
    h('span', { class: `tag tag--${genderClass(person)}` }, i18n.t(genderLabelKey(person))),
    h('span', { class: 'tag' }, i18n.fmt('panel.generation', { n: person.gen })),
    person.dod ? h('span', { class: 'tag tag--gray' }, i18n.t('panel.deceased')) : null,
    kids.length ? h('span', { class: 'tag tag--gray' }, i18n.fmt('panel.children', { n: kids.length })) : null,
    person.is_deleted ? h('span', { class: 'tag tag--gray' }, i18n.t('panel.deleted')) : null,
    person.legacy_id
      ? h('span', { class: 'tag tag--gray' }, i18n.fmt('panel.legacy', { id: person.legacy_id }))
      : null,
  );

  const head = h(
    'div',
    { class: 'p-head' },
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn p-close',
        id: 'panel-close',
        'aria-label': i18n.t('panel.close'),
        onclick: () => deps.onClose(),
      },
      '✕',
    ),
    avatar,
    h('h3', { class: 'p-name', text: name }),
    person.nick ? h('div', { class: 'p-nick', text: i18n.fmt('panel.nick', { nick: person.nick }) }) : null,
    tags,
  );

  const bodyParts = [personal, family, passing, relativesSec, record, nameUr, nameHi].filter(
    (s): s is HTMLElement => s !== null,
  );

  host.dataset.personId = person.id;
  const sections: Array<HTMLElement | null> = [
    head,
    actionBar,
    photoSec,
    bodyParts.length
      ? h('div', { class: 'p-body' }, ...bodyParts)
      : h('div', { class: 'p-none', text: i18n.t('panel.noDetails') }),
    historyBox,
  ];
  host.replaceChildren(...sections.filter((node): node is HTMLElement => node !== null));
  host.hidden = false;
  host.scrollTop = 0;

  if (lastEditedSlot && isAdmin) {
    void hydrateLastEdited(lastEditedSlot, person, deps);
  }
}

/** "Last edited … by who" — admin only, and only ever an upgrade of the timestamp. */
async function hydrateLastEdited(
  slot: HTMLElement,
  person: Person,
  deps: DetailsPanelDeps,
): Promise<void> {
  try {
    const { data, error } = await deps.client
      .from('audit_log')
      .select('changed_by_name, changed_at')
      .eq('person_id', person.id)
      .order('changed_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const hit = (data?.[0] ?? null) as { changed_by_name: string | null; changed_at: string | null } | null;
    if (!hit || !slot.isConnected) return;
    const when = formatWhen(hit.changed_at) || formatWhen(person.updated_at) || '';
    slot.textContent = hit.changed_by_name
      ? deps.i18n.fmt('panel.lastEditedBy', { name: hit.changed_by_name, date: when })
      : deps.i18n.fmt('panel.lastEditedOn', { date: when });
  } catch (err) {
    console.warn('Could not read the audit log for last-edited:', err);
  }
}
