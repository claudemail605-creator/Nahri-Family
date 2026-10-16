import type { I18n, MessageKey } from '../../core/i18n';
import { initials } from '../../core/names';
import type { ProfileRow } from '../../data/auth';
import { h } from '../../ui/dom';

/**
 * The signed-in landing view: who you are, your email, role and language,
 * with the two account actions (edit profile, sign out). Until the tree
 * canvas arrives this is the whole workspace — it is also the natural place
 * for archive statistics in a later phase.
 */

export interface ProfileViewDeps {
  i18n: I18n;
  onEdit: () => void;
  onSignOut: () => void;
}

export function buildProfileView(profile: ProfileRow, isAdmin: boolean, deps: ProfileViewDeps): HTMLElement {
  const { i18n } = deps;
  const name = profile.full_name || profile.email || i18n.t('auth.signedIn');
  const lang = (profile.language ?? i18n.currentLang()) as string;
  const langNameKey = `profile.lang.${lang}` as MessageKey;

  function fact(labelKey: MessageKey, value: string, valueClass?: string): HTMLElement {
    return h(
      'div',
      { class: 'profile-fact' },
      h('dt', { class: 'profile-fact__label', 'data-i18n': true }, labelKey),
      h('dd', { class: `profile-fact__value${valueClass ? ` ${valueClass}` : ''}`, text: value }),
    );
  }

  return h(
    'section',
    { class: 'profile-view', 'aria-labelledby': 'profile-view-name' },
    h(
      'div',
      { class: 'profile-view__card' },
      h(
        'header',
        { class: 'profile-head' },
        h('span', { class: 'profile-avatar', 'aria-hidden': 'true' }, initials(name)),
        h(
          'div',
          { class: 'profile-head__text' },
          h(
            'h2',
            { class: 'profile-name', id: 'profile-view-name' },
            name,
            isAdmin ? h('span', { class: 'tag tag--admin', 'data-i18n': true }, 'admin.adminTag') : null,
          ),
          profile.email ? h('p', { class: 'profile-email', text: profile.email }) : null,
        ),
      ),
      h(
        'dl',
        { class: 'profile-facts' },
        fact('profile.nameLabel', name),
        fact('auth.email', profile.email ?? '—'),
        fact('profile.langLabel', i18n.t(langNameKey)),
        fact('admin.profileRole', profile.role ?? '—'),
      ),
      h(
        'div',
        { class: 'profile-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--accent',
            id: 'profile-edit',
            'data-i18n': true,
            onclick: () => deps.onEdit(),
          },
          'profile.edit',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost',
            id: 'sign-out',
            'data-i18n': true,
            onclick: () => deps.onSignOut(),
          },
          'btnSignOut',
        ),
      ),
    ),
  );
}
