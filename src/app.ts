import { createI18n, type I18n } from './core/i18n';
import { buildHeader } from './shell/header';
import { h } from './ui/dom';
import { createThemeController, type ThemeController } from './ui/theme';
import { ToastHost } from './ui/toast';

export interface AppOptions {
  i18n?: I18n;
  theme?: ThemeController;
}

export interface AppInstance {
  i18n: I18n;
  theme: ThemeController;
  toasts: ToastHost;
}

/**
 * Build the application shell into `root`: header (brand, language, theme),
 * the LTR view host that will carry the tree canvas, and the toast layer.
 * Data-driven views are mounted into #view-host by later phases (see
 * docs/PLAN.md).
 */
export function mountApp(root: HTMLElement, options: AppOptions = {}): AppInstance {
  const i18n = options.i18n ?? createI18n();
  const theme = options.theme ?? createThemeController();

  root.replaceChildren();
  root.classList.add('app-shell');

  const header = buildHeader();
  root.append(header.element);

  // The tree canvas keeps a left-to-right coordinate system even when the
  // interface is in Urdu: tree geometry is direction-agnostic, and the
  // reference app rendered the canvas LTR too.
  const viewHost = h('div', { id: 'view-host', class: 'view-host', dir: 'ltr' });
  viewHost.append(
    h(
      'div',
      { class: 'boot-panel', role: 'status' },
      h('div', { class: 'boot-panel__spinner', 'aria-hidden': 'true' }),
      h('p', { class: 'boot-panel__text', 'data-i18n': true }, 'generic.loading'),
    ),
  );
  root.append(h('main', { id: 'main-content', class: 'app-main' }, viewHost));

  const toastHostEl = h('div', {
    id: 'toast-host',
    class: 'toast-host',
    'aria-live': 'polite',
  });
  root.append(toastHostEl);
  const toasts = new ToastHost(toastHostEl);

  // --- language switcher ---
  header.langSelect.value = i18n.currentLang();
  header.langSelect.addEventListener('change', () => {
    i18n.setLanguage(header.langSelect.value);
  });
  i18n.onLanguageChange((lang) => {
    header.langSelect.value = lang;
  });

  // --- theme toggle ---
  const syncThemeButton = (): void => {
    header.themeButton.setAttribute('aria-pressed', String(theme.current() === 'dark'));
  };
  header.themeButton.addEventListener('click', () => {
    theme.toggle();
    syncThemeButton();
  });
  syncThemeButton();

  // The engine applied translations before this shell existed; re-apply now
  // that there are elements to translate.
  i18n.apply();

  return { i18n, theme, toasts };
}
