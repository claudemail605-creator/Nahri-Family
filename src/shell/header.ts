import type { Lang } from '../core/types';
import { h, svgIcon } from '../ui/dom';

/** The sticky app header: brand, language switcher, theme toggle. */

export interface HeaderRefs {
  element: HTMLElement;
  langSelect: HTMLSelectElement;
  themeButton: HTMLButtonElement;
}

/* An arch-and-spine mark in the copper accent — the archive motif. */
const BRAND_MARK = `<svg class="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false"><path d="M6.5 26.5V16a9.5 9.5 0 0 1 19 0v10.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M16 26.5V13.8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="16" cy="9.6" r="1.7" fill="currentColor"/></svg>`;

/* Action-oriented icons: the moon offers dark mode, the sun offers light. */
const ICON_MOON = `<svg class="theme-icon theme-icon--moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z"/></svg>`;
const ICON_SUN = `<svg class="theme-icon theme-icon--sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.1M12 19.1v2.1M4.3 4.3l1.5 1.5M18.2 18.2l1.5 1.5M2.8 12h2.1M19.1 12h2.1M4.3 19.7l1.5-1.5M18.2 5.8l1.5-1.5"/></svg>`;

/* Language names are written in their own script — the standard convention. */
const LANGUAGE_OPTIONS: ReadonlyArray<{ value: Lang; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'ur', label: 'اردو' },
  { value: 'hi', label: 'हिन्दी' },
];

export function buildHeader(): HeaderRefs {
  const langLabel = h(
    'label',
    { class: 'visually-hidden', for: 'lang-select', 'data-i18n': true },
    'btnLang',
  );
  const langSelect = h(
    'select',
    { id: 'lang-select', class: 'lang-select', name: 'lang' },
    ...LANGUAGE_OPTIONS.map((option) => h('option', { value: option.value }, option.label)),
  );

  const themeButton = h(
    'button',
    {
      type: 'button',
      id: 'theme-toggle',
      class: 'icon-button',
      'data-i18n': 'btnTheme',
      'data-i18n-attr': 'aria-label',
      'aria-pressed': 'false',
    },
    svgIcon(ICON_MOON),
    svgIcon(ICON_SUN),
  );

  const element = h(
    'header',
    { class: 'app-header' },
    h(
      'div',
      { class: 'app-header__brand' },
      svgIcon(BRAND_MARK),
      h('h1', { class: 'brand-title', 'data-i18n': true }, 'brand.title'),
    ),
    h(
      'div',
      { class: 'app-header__actions' },
      h('div', { class: 'lang-field' }, langLabel, langSelect),
      themeButton,
    ),
  );

  return { element, langSelect, themeButton };
}
