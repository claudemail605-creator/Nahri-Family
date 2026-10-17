/*
 * Admin panel — a tabbed modal opened from the header by admins only (B1).
 * Tabs in the reference order, built per phase so every tab ships with its
 * tests: users (administration) · branch progress · deletion requests ·
 * recently deleted · activity · import & backup.
 *
 * Structure mirrors the reference `js/admin.js` but in this app's design
 * language: one wide modal whose body re-renders per tab, nested dialogs on
 * the Phase 4 modal stack instead of blocking window.confirm, and honest
 * loading / failure states — never a fake success.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { I18n, MessageKey } from '../../core/i18n';
import type { ProfileRow } from '../../data/auth';
import type { TreeModel } from '../tree/model';
import type { Lang } from '../../core/types';
import { h } from '../../ui/dom';
import { openModal, type ModalHandle } from '../../ui/modal';
import { renderBranchesTab, renderRequestsTab, renderDeletedTab, renderActivityTab } from './tabs';

export interface AdminPanelDeps {
  i18n: I18n;
  client: SupabaseClient;
  isAdmin(): boolean;
  /** The signed-in profile — nullable while the session refreshes. */
  profile(): ProfileRow | null;
  /** The live workspace model (names, branches, deleted rows). */
  getModel(): TreeModel;
  /** Workspace refetch after writes change the tree; optionally selects id. */
  reload(id?: string): Promise<void>;
  toast(message: string): void;
}

export interface AdminTabCtx {
  deps: AdminPanelDeps;
  i18n: I18n;
  lang: Lang;
  /** Scrollable tab body — re-rendered per tab and on language change. */
  body: HTMLElement;
  /** Re-run the active tab (refresh queues / reload after a write). */
  refresh(): void;
}

type TabId = 'branches' | 'requests' | 'deleted' | 'activity';

interface TabDef {
  id: TabId;
  labelKey: MessageKey;
  render(ctx: AdminTabCtx): void;
}

/* Tabs shipped so far (Users and Import & backup land in later chunks of
   Phase 5 — each tab ships with its tests). */
const TABS: readonly TabDef[] = [
  { id: 'branches', labelKey: 'admin.tab.branches', render: renderBranchesTab },
  { id: 'requests', labelKey: 'admin.tab.requests', render: renderRequestsTab },
  { id: 'deleted', labelKey: 'admin.tab.deleted', render: renderDeletedTab },
  { id: 'activity', labelKey: 'admin.tab.activity', render: renderActivityTab },
];

/**
 * Open the admin panel. Admin-only guard here as well as on the header
 * button — deep-linking the export is not a scenario.
 */
export function openAdminPanel(deps: AdminPanelDeps, startTab: TabId = 'branches'): ModalHandle | null {
  if (!deps.isAdmin()) return null;

  const i18n = deps.i18n;
  let currentTab: TabId = TABS.some((tab) => tab.id === startTab) ? startTab : 'branches';

  const tabsBar = h('div', { class: 'admin-tabs', role: 'tablist' });
  const body = h('div', { class: 'admin-body', id: 'admin-body' });

  function renderTabs(): void {
    tabsBar.replaceChildren(
      ...TABS.map((tab) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: 'admin-tab' + (tab.id === currentTab ? ' admin-tab--on' : ''),
            dataset: { tab: tab.id },
            'aria-selected': String(tab.id === currentTab),
          },
          i18n.t(tab.labelKey),
        ),
      ),
    );
  }

  function loadTab(): void {
    const tab = TABS.find((t) => t.id === currentTab);
    if (!tab) return;
    tab.render(ctx);
  }

  const ctx: AdminTabCtx = {
    deps,
    i18n,
    lang: i18n.currentLang(),
    body,
    refresh: loadTab,
  };

  renderTabs();
  loadTab();

  tabsBar.addEventListener('click', (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('button[data-tab]');
    const id = target?.dataset.tab as TabId | undefined;
    if (!id || !TABS.some((t) => t.id === id)) return;
    currentTab = id;
    renderTabs();
    loadTab();
  });

  // Switching language re-renders the tab (labels, names and dates re-localise).
  const unsubscribeLang = i18n.onLanguageChange((lang) => {
    ctx.lang = lang;
    renderTabs();
    loadTab();
  });

  return openModal({
    title: i18n.t('admin.title'),
    subtitle: i18n.t('admin.subtitle'),
    content: h('div', { class: 'admin-shell' }, tabsBar, body),
    dialogClass: 'modal--wide admin-modal',
    closeLabel: i18n.t('admin.close'),
    onClose: unsubscribeLang,
  });
}
