import type { I18n } from '../core/i18n';
import { initials } from '../core/names';
import type { ProfileRow } from '../data/auth';
import { clear, h } from '../ui/dom';

/**
 * The header account area: an avatar chip with the signed-in user's name and
 * (for admins) the admin tag. Clicking it opens the profile dialog. The area
 * is empty while signed out.
 */

export interface AccountDeps {
  i18n: I18n;
  onOpenProfile: () => void;
}

export function renderAccountChip(
  host: HTMLElement,
  profile: ProfileRow | null,
  isAdmin: boolean,
  deps: AccountDeps,
): void {
  clear(host);
  if (!profile) return;
  const name = profile.full_name || profile.email || deps.i18n.t('auth.signedIn');
  const chip = h(
    'button',
    {
      type: 'button',
      class: 'account-chip',
      id: 'account-chip',
      // The visible text is the user's own name (never translated), so only
      // the tooltip goes through the dictionary.
      'data-i18n': 'profile.title',
      'data-i18n-attr': 'title',
      onclick: () => deps.onOpenProfile(),
    },
    h('span', { class: 'account-chip__avatar', 'aria-hidden': 'true' }, initials(name)),
    h('span', { class: 'account-chip__name', text: name }),
    isAdmin ? h('span', { class: 'tag tag--admin', 'data-i18n': true }, 'admin.adminTag') : null,
  );
  chip.setAttribute('aria-label', name);
  host.append(chip);
  deps.i18n.apply();
}
