import type { I18n } from '../../core/i18n';
import { h } from '../../ui/dom';
import { openModal } from '../../ui/modal';
import type { AuthController } from '../auth/controller';
import { extractMessage } from '../auth/errors';

/**
 * Edit-own-profile dialog: full name + language. Ported from the reference
 * `_showProfileEdit()` but built on the shared modal (focus trap, Escape,
 * backdrop dismissal). The name is required; a save that the server refuses
 * (RLS) reports the permission message instead of a raw error.
 */

export interface ProfileFormDeps {
  i18n: I18n;
  auth: AuthController;
}

export function openProfileForm(deps: ProfileFormDeps): void {
  const { i18n, auth } = deps;
  const profile = auth.getState().profile;
  if (!profile) return;

  const nameInput = h('input', {
    class: 'input',
    id: 'profile-name',
    name: 'name',
    type: 'text',
    autocomplete: 'name',
  });
  nameInput.value = profile.full_name ?? '';

  const langSelect = h(
    'select',
    { class: 'input', id: 'profile-language', name: 'language' },
    h('option', { value: 'en', 'data-i18n': true }, 'profile.lang.en'),
    h('option', { value: 'ur', 'data-i18n': true }, 'profile.lang.ur'),
    h('option', { value: 'hi', 'data-i18n': true }, 'profile.lang.hi'),
  );
  langSelect.value = profile.language ?? i18n.currentLang();

  const message = h('p', { class: 'form-msg', role: 'status' });

  const note = h(
    'p',
    { class: 'modal__text profile-form__note', 'data-i18n': true },
    auth.isAdmin() ? 'admin.editUsersNote' : 'admin.editUsersNoteNonAdmin',
  );

  const content = h(
    'div',
    { class: 'profile-form' },
    note,
    h('label', { class: 'field-label', for: 'profile-name', 'data-i18n': true }, 'profile.nameLabel'),
    nameInput,
    h(
      'label',
      { class: 'field-label', for: 'profile-language', 'data-i18n': true },
      'profile.langLabel',
    ),
    langSelect,
    message,
  );

  openModal({
    title: i18n.t('profile.title'),
    content,
    closeLabel: i18n.t('generic.close'),
    actions: [
      { label: i18n.t('profile.cancel'), kind: 'ghost', onClick: (close) => close() },
      {
        label: i18n.t('profile.save'),
        kind: 'accent',
        onClick: (_close, button) => {
          const name = nameInput.value.trim();
          const language = langSelect.value;
          message.className = 'form-msg';
          message.textContent = '';
          if (!name) {
            message.className = 'form-msg form-msg--error';
            message.textContent = i18n.t('profile.nameRequired');
            nameInput.focus();
            return;
          }
          button.disabled = true;
          button.textContent = i18n.t('profile.save') + '…';
          auth
            .updateProfile({ full_name: name, language })
            .then(() => {
              message.className = 'form-msg form-msg--ok';
              message.textContent = i18n.t('profile.updated');
              button.disabled = false;
              button.textContent = i18n.t('profile.save');
            })
            .catch((err: unknown) => {
              const raw = extractMessage(err);
              message.className = 'form-msg form-msg--error';
              message.textContent = /forbids|permission/i.test(raw)
                ? i18n.t('admin.profilePermError')
                : i18n.fmt('admin.profileFailed', { msg: raw });
              button.disabled = false;
              button.textContent = i18n.t('profile.save');
            });
        },
      },
    ],
  });

  i18n.apply();
  nameInput.focus();
}
