import type { Lang } from '../core/types';
import { h, svgIcon } from '../ui/dom';

/** The sticky app header: brand, language switcher, theme toggle, account. */

export interface HeaderRefs {
  element: HTMLElement;
  langSelect: HTMLSelectElement;
  themeButton: HTMLButtonElement;
  /** Admins only — the panel is wired by the app shell. */
  adminButton: HTMLButtonElement;
  /** Admins only (H7) — exports the tree as Excel; wired by the app shell. */
  exportButton: HTMLButtonElement;
  /** The tools modal (extras L1–L4) — every signed-in user; wired by the shell. */
  toolsButton: HTMLButtonElement;
  /** Filled by the shell when a profile is signed in (avatar chip). */
  accountArea: HTMLElement;
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

  const accountArea = h('div', { class: 'account-area', id: 'account-area' });

  /* The admin panel button (B1): hidden unless the profile is an admin.
     A cog-like outline keeps the header's line-icon language. */
  const adminButton = h(
    'button',
    {
      type: 'button',
      id: 'btn-admin',
      class: 'icon-button',
      'data-i18n': 'btnAdmin',
      'data-i18n-attr': 'aria-label',
      hidden: true,
    },
    svgIcon(
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>`,
    ),
  );

  /* The spreadsheet export (H7): admin-only, like the reference's top-bar
     button. A spreadsheet outline in the same style. */
  const exportButton = h(
    'button',
    {
      type: 'button',
      id: 'btn-export',
      class: 'icon-button',
      'data-i18n': 'export.title',
      'data-i18n-attr': 'aria-label',
      hidden: true,
    },
    svgIcon(
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M4 9.5h16M4 15.5h16M10 3.5v17M16 3.5v17" stroke-width="1.4"/></svg>`,
    ),
  );

  /* The tools modal (extras): visible for every signed-in user with a loaded
     tree, like the reference's top-bar tools button (the empty-tree guard
     lives in the tools open()). */
  const toolsButton = h(
    'button',
    {
      type: 'button',
      id: 'btn-tools',
      class: 'icon-button',
      'data-i18n': 'extra.tools',
      'data-i18n-attr': 'aria-label',
      hidden: true,
    },
    svgIcon(
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="9" width="17" height="10.5" rx="2"/><path d="M9 9V7.4A2.4 2.4 0 0 1 11.4 5h1.2A2.4 2.4 0 0 1 15 7.4V9M3.5 13.4h17"/></svg>`,
    ),
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
      adminButton,
      exportButton,
      toolsButton,
      accountArea,
    ),
  );

  return { element, langSelect, themeButton, adminButton, exportButton, toolsButton, accountArea };
}
