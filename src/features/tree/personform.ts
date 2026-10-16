import type { SupabaseClient } from '@supabase/supabase-js';
import type { I18n, MessageKey } from '../../core/i18n';
import { getDisplayName } from '../../core/i18n/display';
import {
  diffPayload,
  insertPerson,
  updatePerson,
  type PersonPatch,
  type PersonValues,
} from '../../data/people';
import { confirmDialog } from '../../ui/confirm';
import { h } from '../../ui/dom';
import { openModal } from '../../ui/modal';
import { extractMessage } from '../auth/errors';
import {
  findDuplicate,
  FORM_SECTIONS,
  FORM_FIELDS,
  validateAndBuild,
  valuesForNewChild,
  valuesFromPerson,
  type FieldIssue,
  type FormValues,
} from './fields';
import type { Person } from './model';
import {
  invalidatePhoto,
  photoErrorMessage,
  photoValidationMessage,
  preparePhoto,
  removePhoto,
  signedPhotoUrl,
  uploadPhoto,
  validatePhoto,
} from './photo';
import { genderLabelKey } from './render';

/**
 * The one reusable add/edit person dialog — port of the reference
 * `js/personform.js` on top of the shared modal (focus trap, Escape, scroll
 * lock):
 *
 *   - sections Names / Parents / Spouse / Life events / Notes + photo;
 *   - the tree parent is read-only when adding a child, read-only for editors
 *     when editing, and a searchable picker for admins;
 *   - validation with inline messages; a duplicate name+parent only warns;
 *   - the save button reports progress and the dialog cannot be dismissed
 *     mid-save;
 *   - INSERT sends only the whitelisted columns; UPDATE sends only the fields
 *     that actually changed (plus `parent_id` for an admin move);
 *   - a chosen photo is scaled to 800 px and limited to 3 MB, then uploaded
 *     after the row exists.
 */

export type PersonFormMode = 'edit' | 'addchild' | 'addroot';

export interface PersonFormDeps {
  i18n: I18n;
  client: SupabaseClient;
  isAdmin(): boolean;
  /** Current people list — the parent picker and the duplicate warning. */
  getPeople(): readonly Person[];
  /** Language-aware display label for a person (parent picker). */
  labelOf(person: Person): string;
  toast(message: string): void;
  /** Called after a successful save so the workspace can reload and select. */
  onSaved(personId: string | null): Promise<void> | void;
}

export interface PersonFormOpenOptions {
  mode: PersonFormMode;
  /** Required for `edit`. */
  person?: Person;
  /** Required for `addchild`. */
  parent?: Person;
}

interface FormState {
  mode: PersonFormMode;
  person: Person | null;
  parent: Person | null;
  values: FormValues;
  /** Payload-shaped snapshot taken at open — the changed-fields baseline. */
  original: PersonValues;
  /** Tree parent: fixed for addchild/addroot; pickable by admins when editing. */
  parentId: string | null;
  parentLabel: string;
  file: File | null;
  /** A stored photo the user asked to delete on save. */
  removePhoto: boolean;
  previewUrl: string | null;
  saving: boolean;
}

let seq = 0;

export function openPersonForm(options: PersonFormOpenOptions, deps: PersonFormDeps): void {
  const { i18n } = deps;
  const t = (key: MessageKey): string => i18n.t(key);
  const fmt = (key: MessageKey, vars?: Record<string, string>): string => i18n.fmt(key, vars);

  const person = options.person ?? null;
  const parent = options.parent ?? null;
  const mode = options.mode;

  const values =
    mode === 'edit'
      ? valuesFromPerson(person)
      : mode === 'addchild' && parent
        ? valuesForNewChild(parent)
        : valuesFromPerson(null);
  const originalValues = mode === 'edit' ? valuesFromPerson(person) : valuesFromPerson(null);
  const originalBuilt = validateAndBuild(originalValues);
  const state: FormState = {
    mode,
    person,
    parent,
    values,
    original: originalBuilt.ok ? originalBuilt.payload : {},
    parentId:
      mode === 'addchild' ? (parent?.id ?? null) : mode === 'edit' ? (person?.parentId ?? null) : null,
    parentLabel: '',
    file: null,
    removePhoto: false,
    previewUrl: null,
    saving: false,
  };
  state.parentLabel = labelForId(state.parentId);

  const formId = `person-form-${++seq}`;

  function labelForId(id: string | null): string {
    if (!id) return '';
    const hit = deps.getPeople().find((p) => p.id === id);
    return hit ? optionLabel(hit) : '';
  }

  /** "Name · “nick” · Gen 3 — parent" keeps same-named people apart. */
  function optionLabel(p: Person): string {
    const bits = [deps.labelOf(p)];
    if (p.nick) bits.push(`“${p.nick}”`);
    bits.push(i18n.fmt('chip.gen', { g: p.gen }));
    if (p.parent) bits.push(`— ${deps.labelOf(p.parent)}`);
    return bits.join(' · ');
  }

  /* ------------------------------- elements ------------------------------- */

  const errors = new Map<string, HTMLElement>();
  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();

  function setError(col: string, issue: FieldIssue | null): void {
    const box = errors.get(col);
    if (box) {
      box.hidden = !issue;
      box.textContent = issue ? formatIssue(issue) : '';
    }
    const input = inputs.get(col);
    if (input) {
      if (issue) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function formatIssue(issue: FieldIssue): string {
    const fieldKey = issue.vars?.field as MessageKey | undefined;
    return fieldKey ? i18n.fmt(issue.key, { field: t(fieldKey) }) : t(issue.key);
  }

  function buildField(col: string, key: MessageKey, def: { type?: string; required?: boolean; hint?: MessageKey; rtl?: boolean }): HTMLElement {
    const id = `pf_${col}`;
    const value = state.values[col as keyof FormValues] ?? '';
    const label = h(
      'label',
      { class: 'edit-label', for: id },
      t(key),
      def.required ? h('span', { class: 'edit-req' }, ' *') : null,
    );
    let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (def.type === 'select') {
      const select = h(
        'select',
        { class: 'input edit-input', id },
        h('option', { value: '' }, t('edit.genderPick')),
        h('option', { value: 'Male', selected: value === 'Male' }, t('chip.male')),
        h('option', { value: 'Female', selected: value === 'Female' }, t('chip.female')),
      );
      input = select;
    } else if (def.type === 'textarea') {
      input = h('textarea', {
        class: 'input edit-input',
        id,
        rows: '3',
        placeholder: t('edit.textareaPlaceholder'),
        dir: def.rtl ? 'rtl' : null,
      });
      (input as HTMLTextAreaElement).value = value;
    } else {
      input = h('input', {
        class: 'input edit-input',
        id,
        type: def.type === 'date' ? 'date' : 'text',
        dir: def.rtl ? 'rtl' : null,
        placeholder: def.type === 'date' ? 'YYYY-MM-DD' : null,
        required: def.required ? true : null,
      });
      (input as HTMLInputElement).value = value;
    }
    inputs.set(col, input);
    const error = h('div', { class: 'edit-error', hidden: true });
    errors.set(col, error);
    return h(
      'div',
      { class: 'edit-field', dataset: { field: col } },
      label,
      input,
      def.hint ? h('div', { class: 'edit-hint' }, t(def.hint)) : null,
      error,
    );
  }

  function buildParentBlock(): HTMLElement {
    if (mode === 'addchild') {
      const name = parent ? deps.labelOf(parent) : '';
      const input = h('input', {
        class: 'input edit-input',
        type: 'text',
        id: 'pf_parent',
        readonly: true,
      });
      input.value = name;
      return h(
        'div',
        { class: 'edit-field', dataset: { field: 'parent' } },
        h('label', { class: 'edit-label' }, t('edit.parentField')),
        input,
        h('div', { class: 'edit-hint' }, fmt('edit.parentFixed', { name })),
      );
    }
    if (mode === 'addroot') {
      const input = h('input', { class: 'input edit-input', type: 'text', id: 'pf_parent', readonly: true });
      input.value = t('edit.parentNone');
      return h(
        'div',
        { class: 'edit-field', dataset: { field: 'parent' } },
        h('label', { class: 'edit-label' }, t('edit.parentField')),
        input,
      );
    }
    // edit
    if (!deps.isAdmin()) {
      const input = h('input', { class: 'input edit-input', type: 'text', id: 'pf_parent', readonly: true });
      input.value = person?.parent ? deps.labelOf(person.parent) : '';
      return h(
        'div',
        { class: 'edit-field', dataset: { field: 'parent' } },
        h('label', { class: 'edit-label' }, t('edit.parentField')),
        input,
        h('div', { class: 'edit-hint' }, t('edit.parentAdminOnly')),
      );
    }
    const listId = `${formId}-parent-list`;
    const list = h('datalist', { id: listId });
    for (const p of deps.getPeople()) {
      if (p.id === person?.id) continue;
      list.append(h('option', { value: optionLabel(p) }));
    }
    const input = h('input', {
      class: 'input edit-input',
      id: 'pf_parent',
      type: 'text',
      list: listId,
      autocomplete: 'off',
      placeholder: t('edit.parentNone'),
    });
    input.value = state.parentLabel;
    input.addEventListener('input', () => {
      const text = input.value.trim();
      if (!text) {
        state.parentId = null;
        state.parentLabel = '';
        return;
      }
      const hit = deps.getPeople().find((p) => p.id !== person?.id && optionLabel(p) === text);
      if (hit) {
        state.parentId = hit.id;
        state.parentLabel = text;
      }
    });
    input.addEventListener('blur', () => {
      const text = input.value.trim();
      if (text && !deps.getPeople().some((p) => p.id !== person?.id && optionLabel(p) === text)) {
        // The typed text is not one of the offered people — refuse to guess.
        setError('parent', { key: 'admin.pickPerson' });
        input.value = state.parentLabel;
      } else {
        setError('parent', null);
      }
    });
    const error = h('div', { class: 'edit-error', hidden: true });
    errors.set('parent', error);
    return h(
      'div',
      { class: 'edit-field', dataset: { field: 'parent' } },
      h('label', { class: 'edit-label', for: 'pf_parent' }, t('edit.parentField')),
      input,
      list,
      h('div', { class: 'edit-hint' }, t('edit.parentAdminOnly')),
      error,
    );
  }

  /* --------------------------------- photo --------------------------------- */

  const thumb = h('div', { class: 'photo-thumb', dataset: { ppThumb: '1' } });
  const photoName = h('div', { class: 'edit-hint', dataset: { ppName: '1' } });
  const clearBtn = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', id: 'pp_clear', hidden: true }, t('edit.photoRemove'));
  const fileInput = h('input', {
    type: 'file',
    id: 'pp_file',
    accept: 'image/jpeg,image/png,image/webp',
    hidden: true,
  });
  const chooseBtn = h('button', { type: 'button', class: 'btn btn--sm', id: 'pp_choose' }, t('edit.photoChoose'));

  function releasePreview(): void {
    if (state.previewUrl) {
      URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = null;
    }
  }

  function paintPhoto(): void {
    releasePreview();
    if (state.file) {
      const url = URL.createObjectURL(state.file);
      state.previewUrl = url;
      thumb.replaceChildren(h('img', { alt: '', src: url }));
      clearBtn.hidden = false;
      photoName.textContent = fmt('edit.photoSelected', { name: state.file.name });
      return;
    }
    const hasStored = !!(state.person?.photo_path && !state.removePhoto);
    thumb.replaceChildren(h('span', { class: 'photo-thumb-empty' }, hasStored ? t('photos.loading') : t('edit.photoNone')));
    clearBtn.hidden = !hasStored;
    photoName.textContent = hasStored ? t('edit.photoSavesWith') : '';
  }

  async function paintStoredPhoto(): Promise<void> {
    if (!state.person?.photo_path) return;
    try {
      const url = await signedPhotoUrl(deps.client, state.person.photo_path);
      if (!url || !thumb.isConnected || state.file) return;
      thumb.replaceChildren(h('img', { alt: '', src: url }));
    } catch {
      /* the photo is optional — the empty state is fine */
    }
  }

  function onPickFile(): void {
    const file = fileInput.files?.[0] ?? null;
    fileInput.value = '';
    if (!file) return;
    state.removePhoto = false;
    const check = validatePhoto(file);
    const message = photoValidationMessage(i18n, file, check);
    if (message) {
      deps.toast(message);
      return;
    }
    state.file = file;
    paintPhoto();
  }

  const photoBlock = h(
    'div',
    { class: 'edit-field', dataset: { field: 'photo' } },
    h('label', { class: 'edit-label' }, t('edit.photoChoose')),
    h(
      'div',
      { class: 'photo-row' },
      thumb,
      h(
        'div',
        { class: 'photo-row__actions' },
        chooseBtn,
        clearBtn,
        h('div', { class: 'edit-hint' }, t('edit.photoHint')),
        photoName,
      ),
    ),
    fileInput,
  );

  /* --------------------------------- body ---------------------------------- */

  const body = h('form', { id: formId, class: 'edit-form', novalidate: true });
  for (const section of FORM_SECTIONS) {
    const fieldset = h(
      'fieldset',
      { class: 'edit-section' },
      h('legend', {}, t(section.title)),
    );
    if (section.parentsBlock) fieldset.append(buildParentBlock());
    for (const field of section.fields) {
      fieldset.append(buildField(field.col, field.key, field));
    }
    if (section.photoBlock) fieldset.append(photoBlock);
    body.append(fieldset);
  }

  function collect(): void {
    for (const field of FORM_FIELDS) {
      const input = inputs.get(field.col);
      if (!input) continue;
      state.values[field.col] = input.value;
    }
  }

  body.addEventListener('input', collect);
  body.addEventListener('change', collect);

  /* ------------------------------ title / save ------------------------------ */

  const title =
    mode === 'edit'
      ? fmt('panel.editTitle', { name: person ? getDisplayName(person, i18n.currentLang()) : '' })
      : fmt(mode === 'addchild' ? 'panel.addChildTitle' : 'panel.addRootTitle', {
          name: parent ? getDisplayName(parent, i18n.currentLang()) : '',
        });
  const subtitle =
    mode === 'edit' && person
      ? fmt('panel.editSub', { gen: String(person.gen), gender: t(genderLabelKey(person)) })
      : mode === 'addchild'
        ? t('panel.addChildSub')
        : t('panel.addRootSub');
  const saveBase = mode === 'edit' ? t('panel.save') : mode === 'addchild' ? t('panel.addGo') : t('panel.addRoot');

  /* --------------------------------- save ---------------------------------- */

  async function save(close: () => void, button: HTMLButtonElement): Promise<void> {
    if (state.saving) return;
    collect();
    const built = validateAndBuild(state.values);
    if (!built.ok) {
      for (const field of FORM_FIELDS) setError(field.col, built.issues[field.col] ?? null);
      const box = errors.get(built.firstBad);
      box?.scrollIntoView({ block: 'center' });
      inputs.get(built.firstBad)?.focus();
      deps.toast(t('edit.fixFields'));
      return;
    }
    for (const field of FORM_FIELDS) setError(field.col, null);
    const payload = built.payload;

    const dup = findDuplicate(
      deps.getPeople(),
      String(payload.full_name ?? ''),
      state.parentId,
      mode === 'edit' ? (person?.id ?? null) : null,
    );
    if (dup) {
      const ok = await confirmDialog({
        title: t('edit.dupTitle'),
        message: fmt('edit.dupWarn', { name: deps.labelOf(dup) }),
        confirmLabel: saveBase,
        cancelLabel: t('panel.cancel'),
        closeLabel: t('panel.close'),
      });
      if (!ok) return;
    }

    state.saving = true;
    button.disabled = true;
    button.textContent = `${mode === 'edit' ? t('edit.saving') : t('edit.adding')}`;

    try {
      let personId: string | null = person?.id ?? null;
      let storedPhoto = person?.photo_path ?? null;
      if (mode === 'edit' && person) {
        const changed: PersonPatch = diffPayload(state.original, payload);
        const wantParent = state.parentId || null;
        const hadParent = person.parentId || null;
        if (deps.isAdmin() && wantParent !== hadParent) changed.parent_id = wantParent;
        if (Object.keys(changed).length) await updatePerson(deps.client, person.id, changed);
      } else {
        const created = await insertPerson(deps.client, payload, state.parentId || null);
        personId = created.id ?? null;
        storedPhoto = created.photo_path ?? null;
      }

      if (mode === 'edit' && state.removePhoto && storedPhoto && personId) {
        try {
          await removePhoto(deps.client, personId, storedPhoto);
          storedPhoto = null;
        } catch (err) {
          deps.toast(photoErrorMessage(i18n, err));
        }
      }
      if (state.file && personId) {
        const prepared = await preparePhoto(state.file);
        const key = await uploadPhoto(deps.client, personId, prepared ?? state.file, storedPhoto);
        if (storedPhoto && storedPhoto !== key) invalidatePhoto(storedPhoto);
        invalidatePhoto(key);
      }

      state.saving = false;
      close();
      const newName = String(payload.full_name ?? '').trim();
      await deps.onSaved(personId);
      deps.toast(
        mode === 'edit' ? t('save.changesSaved') : fmt('save.added', { name: newName }),
      );
    } catch (err) {
      const msg = extractMessage(err);
      deps.toast(
        /row-level security|permission|not allowed|forbids|violates|unauthoriz|403/i.test(msg)
          ? t('save.permError')
          : /Only an admin can move a person/.test(msg)
            ? t('save.moveError')
            : /duplicate key|legacy_id/.test(msg)
              ? t('save.foreignKeyError')
              : mode === 'edit'
                ? fmt('save.saveFailed', { msg })
                : fmt('save.addFailed', { msg }),
      );
      state.saving = false;
      button.disabled = false;
      button.textContent = saveBase;
    }
  }

  /* --------------------------------- open ---------------------------------- */

  fileInput.addEventListener('change', onPickFile);
  chooseBtn.addEventListener('click', () => fileInput.click());
  clearBtn.addEventListener('click', () => {
    state.file = null;
    // An existing photo is not discarded by forgetting it here: remember the
    // request and delete both the reference and the object when saving.
    state.removePhoto = !!(state.person && state.person.photo_path);
    paintPhoto();
  });
  paintPhoto();
  if (state.person?.photo_path) void paintStoredPhoto();

  const modal = openModal({
    title,
    subtitle,
    content: body,
    dialogClass: 'modal--wide person-modal',
    closeLabel: t('panel.close'),
    dismissible: () => !state.saving,
    actions: [
      { label: t('panel.cancel'), kind: 'ghost', onClick: (close) => close() },
      {
        // A real submit button for the form above (the reference's form= attribute):
        // clicking it or pressing Enter inside the form runs the same save handler.
        label: saveBase,
        kind: 'accent',
        type: 'submit',
        form: formId,
      },
    ],
    onClose: () => releasePreview(),
  });

  body.addEventListener('submit', (event) => {
    event.preventDefault();
    const button = document.querySelector<HTMLButtonElement>(`button[form="${formId}"]`);
    if (button) void save(() => modal.close(), button);
  });

  const first = inputs.get('full_name');
  if (first) window.setTimeout(() => first.focus(), 0);
}
