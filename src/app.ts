import type { SupabaseClient } from '@supabase/supabase-js';
import { createI18n, type I18n } from './core/i18n';
import { createAuthData, type AuthData, type ProfileRow } from './data/auth';
import { createAuthController, type AuthController, type AuthState } from './features/auth/controller';
import { mountAuthGate, type AuthGate } from './features/auth/gate';
import {
  currentPageUrl,
  stripAuthParams,
  type AuthLinkInfo,
  type Windowish,
} from './features/auth/link';
import { openProfileForm } from './features/profile/form';
import { openAdminPanel } from './features/admin/modal';
import { exportTreeExcel } from './features/admin/excel-export';
import { clearPhotoCache } from './features/tree/photo';
import { buildTreeWorkspace, type TreeWorkspace } from './features/tree/view';
import { renderAccountChip } from './shell/account';
import { buildHeader } from './shell/header';
import { h } from './ui/dom';
import { createThemeController, type ThemeController } from './ui/theme';
import { ToastHost } from './ui/toast';

export interface AppOptions {
  i18n?: I18n;
  theme?: ThemeController;
  /** Auth-link parameters captured from the URL before the client consumed them. */
  authLink?: AuthLinkInfo;
  /** The one Supabase client; null when it could not be created (with clientError). */
  client?: SupabaseClient | null;
  /** Message when the Supabase client could not be created at all. */
  clientError?: string | null;
  /** Injectable for tests; defaults to the real window. */
  win?: Windowish;
}

export interface AppInstance {
  i18n: I18n;
  theme: ThemeController;
  toasts: ToastHost;
  auth: AuthController;
  gate: AuthGate;
  /** Unsubscribe everything this instance attached (used by tests/teardown). */
  dispose(): void;
}

/**
 * Build the application shell into `root`:
 *   - header (brand, language, theme, account chip);
 *   - #gate-host — the sign-in gate, inheriting the document direction;
 *   - #view-host — the workspace, LTR because the tree canvas lives there;
 *   - the toast layer.
 *
 * Auth gating is pure CSS on `data-auth` (see styles/features.css): the gate
 * is hidden once an active profile is signed in, and the workspace until then.
 */
export function mountApp(root: HTMLElement, options: AppOptions = {}): AppInstance {
  const i18n = options.i18n ?? createI18n();
  const theme = options.theme ?? createThemeController();
  const win: Windowish = options.win ?? window;
  const data: AuthData | null = options.client ? createAuthData(options.client) : null;

  root.replaceChildren();
  root.classList.add('app-shell');

  const header = buildHeader();
  root.append(header.element);

  const gateHost = h('div', { id: 'gate-host', class: 'gate-host' });
  // The tree canvas keeps a left-to-right coordinate system even when the
  // interface is in Urdu: tree geometry is direction-agnostic, and the
  // reference app rendered the canvas LTR too.
  const viewHost = h('div', { id: 'view-host', class: 'view-host', dir: 'ltr' });
  root.append(h('main', { id: 'main-content', class: 'app-main' }, gateHost, viewHost));

  const toastHostEl = h('div', {
    id: 'toast-host',
    class: 'toast-host',
    'aria-live': 'polite',
  });
  root.append(toastHostEl);
  const toasts = new ToastHost(toastHostEl);

  /* ------------------------------- auth ---------------------------------- */

  const auth = createAuthController({
    data,
    link: options.authLink ?? { type: null, error: null },
    redirectTo: currentPageUrl(win),
    stripUrlParams: () => stripAuthParams(win),
    failureReason: options.clientError ?? null,
  });

  const gate = mountAuthGate(gateHost, { i18n, auth });

  /* ---------------------------- workspace -------------------------------- */

  const openEditProfile = (): void => openProfileForm({ i18n, auth });

  /** The admin panel (B1) — only sensible while a workspace is loaded. */
  const openAdmin = (): void => {
    if (!workspace || !auth.isAdmin() || !options.client) return;
    openAdminPanel({
      i18n,
      client: options.client,
      isAdmin: () => auth.isAdmin(),
      profile: () => auth.getState().profile,
      refreshProfile: () => auth.retryProfile(),
      getModel: () => workspace!.getModel(),
      reload: (id?: string) => workspace!.reload(id),
      exportExcel: () => exportTreeExcel({
        i18n,
        getModel: () => workspace!.getModel(),
        isAdmin: () => auth.isAdmin(),
        toast: (message) => {
          toasts.show(message);
        },
      }),
      toast: (message) => {
        toasts.show(message);
      },
    });
  };
  header.adminButton.addEventListener('click', openAdmin);

  /** Export to Excel (H7) — the header entry point, admins only. */
  const exportExcelFromHeader = (): void => {
    if (!workspace) return;
    exportTreeExcel({
      i18n,
      getModel: () => workspace!.getModel(),
      isAdmin: () => auth.isAdmin(),
      toast: (message) => {
        toasts.show(message);
      },
    });
  };
  header.exportButton.addEventListener('click', exportExcelFromHeader);

  let renderedProfile: ProfileRow | null = null;
  let renderedAccount: { profile: ProfileRow | null; isAdmin: boolean } | null = null;
  let renderedUserId: string | null = null;
  let workspace: TreeWorkspace | null = null;

  function renderWorkspace(_profile: ProfileRow): void {
    workspace?.dispose();
    workspace = null;
    // A ready profile implies a working client; the guard keeps the shell
    // honest if that ever changes (viewHost just stays empty).
    if (!options.client) return;
    const instance = buildTreeWorkspace({
      i18n,
      client: options.client,
      permissions: {
        isAdmin: () => auth.isAdmin(),
        isActiveEditor: () => auth.isActiveEditor(),
        branchAccess: () => auth.getState().branchAccess,
        canEditPerson: (personId, personPath) => auth.canEditPerson(personId, personPath),
      },
      onSignOut: () => {
        void auth.signOut();
      },
      toast: (message) => {
        toasts.show(message);
      },
    });
    workspace = instance;
    viewHost.replaceChildren(instance.element);
    i18n.apply();
  }

  function syncShell(state: AuthState): void {
    root.dataset.auth = state.status;
    const ready = state.status === 'ready';
    const profile = ready ? state.profile : null;
    const userId = ready ? (state.session?.user.id ?? null) : null;

    // A different (or no) signed-in user must not inherit signed photo URLs —
    // reference `clearTree()` includes the photo cache (A4 parity).
    if (userId !== renderedUserId) {
      renderedUserId = userId;
      clearPhotoCache();
    }

    if (
      !renderedAccount ||
      renderedAccount.profile !== profile ||
      renderedAccount.isAdmin !== auth.isAdmin()
    ) {
      renderedAccount = { profile, isAdmin: auth.isAdmin() };
      renderAccountChip(header.accountArea, profile, auth.isAdmin(), {
        i18n,
        onOpenProfile: openEditProfile,
      });
    }
    // Admins only: the panel's own open() re-checks (B1).
    header.adminButton.hidden = !(ready && auth.isAdmin());
  header.exportButton.hidden = !(ready && auth.isAdmin());

    if (ready && state.profile && state.profile !== renderedProfile) {
      renderedProfile = state.profile;
      renderWorkspace(state.profile);
    } else if (!ready) {
      renderedProfile = null;
      // Drop the tree on sign-out (reference `clearTree()`): the CSS already
      // hides the workspace, but family data should not stay in the DOM.
      if (workspace) {
        workspace.dispose();
        workspace = null;
        viewHost.replaceChildren();
      }
    }
  }

  const unsubscribeShell = auth.onStateChange(syncShell);
  // The user's saved language wins as soon as the profile is known (reference
  // behaviour: profile.language overrides the stored choice at boot).
  const unsubscribeProfileLanguage = auth.onProfileChange((profile) => {
    if (profile.language) i18n.setLanguage(profile.language);
  });
  /* ----------------------------- header ---------------------------------- */

  header.langSelect.value = i18n.currentLang();
  header.langSelect.addEventListener('change', () => {
    const lang = header.langSelect.value;
    i18n.setLanguage(lang);
    // Persist the choice on the profile when signed in — a signed-out choice
    // only lives in localStorage.
    if (auth.getState().status === 'ready') {
      auth.updateProfile({ language: lang }).catch(() => {
        /* non-fatal — the interface already switched */
      });
    }
  });
  i18n.onLanguageChange((lang) => {
    header.langSelect.value = lang;
  });

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
  syncShell(auth.getState());

  return {
    i18n,
    theme,
    toasts,
    auth,
    gate,
    dispose() {
      unsubscribeShell();
      unsubscribeProfileLanguage();
      if (workspace) {
        workspace.dispose();
        workspace = null;
      }
      gate.dispose();
      auth.dispose();
    },
  };
}
