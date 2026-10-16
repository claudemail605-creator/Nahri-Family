import type { SupabaseClient } from '@supabase/supabase-js';
import type { I18n, MessageKey } from '../../core/i18n';
import { getDisplayName } from '../../core/i18n/display';
import { fetchAllPeople } from '../../data/people';
import { h } from '../../ui/dom';
import { extractMessage } from '../auth/errors';import {
  computeVisibility,
  createFilters,
  filtersActive,
  resetFilters,
  type FilterState,
  type Visibility,
} from './filters';
import { layoutTree, NODE_H, type LayoutResult } from './layout';
import { buildModel, toPerson, type Person, type TreeModel } from './model';
import { PanZoomController } from './panzoom';
import { renderDetails } from './panel';
import { genderLabelKey, renderTreeInto } from './render';
import { renderTable, sortPeople, type TableColumnKey, type TableSort } from './table';

/**
 * The tree workspace: everything between the shell header and the details
 * sheet — data loading (paged, real rows only), the model rebuild, filters
 * and visibility, the canvas with one pan/zoom controller, selection, the
 * table view, and the honest states around them (loading / empty / error
 * banner with retry — never a fake tree).
 *
 * The stage and world elements are created once; re-renders replace the
 * world's content so the pan/zoom controller keeps its element reference.
 * View-resetting actions (filter change, expand/collapse all, view switch)
 * re-fit the tree; single-node toggles keep the clicked card stationary.
 */

export interface TreeWorkspaceDeps {
  i18n: I18n;
  client: SupabaseClient;
  isAdmin: boolean;
  onSignOut(): void;
  toast(message: string): void;
}

export interface TreeWorkspace {
  element: HTMLElement;
  dispose(): void;
}

type ViewMode = 'tree' | 'table';

export function buildTreeWorkspace(deps: TreeWorkspaceDeps): TreeWorkspace {
  const { i18n, client, isAdmin } = deps;
  let disposed = false;

  /* ------------------------------- state --------------------------------- */

  let all: Person[] = [];
  let model: TreeModel = buildModel([], false);
  const filters: FilterState = createFilters();
  let vis: Visibility = computeVisibility(model, filters);
  const collapsed = new Set<string>();
  let selectedId: string | null = null;
  let view: ViewMode = 'tree';
  let showDeleted = false;
  let sort: TableSort | null = null;
  let layout: LayoutResult | null = null;
  let fitted = false;
  let loading = true; // start hidden-until-loaded so the empty note never flashes at boot
  let errorMessage: string | null = null;
  let pulseTimer: number | null = null;

  /* ------------------------------- elements ------------------------------ */

  const search = h('input', {
    id: 'tree-search',
    class: 'tw-search',
    type: 'search',
    placeholder: i18n.t('search.placeholder'),
    'aria-label': i18n.t('search.placeholder'),
  });

  const viewTreeBtn = h(
    'button',
    { type: 'button', class: 'tw-tab', id: 'view-tree', 'aria-pressed': 'true' },
    i18n.t('view.tree'),
  );
  const viewTableBtn = h(
    'button',
    { type: 'button', class: 'tw-tab', id: 'view-table', 'aria-pressed': 'false' },
    i18n.t('view.table'),
  );

  const countEl = h('span', { id: 'result-count', class: 'tw-count' });

  const zoomOutBtn = h('button', {
    type: 'button',
    class: 'icon-btn',
    id: 'zoom-out',
    title: i18n.t('zoom.out'),
    'aria-label': i18n.t('zoom.out'),
  }, '−');
  const zoomInBtn = h('button', {
    type: 'button',
    class: 'icon-btn',
    id: 'zoom-in',
    title: i18n.t('zoom.in'),
    'aria-label': i18n.t('zoom.in'),
  }, '+');
  const zoomFitBtn = h('button', {
    type: 'button',
    class: 'icon-btn',
    id: 'zoom-fit',
    title: i18n.t('zoom.fit'),
    'aria-label': i18n.t('zoom.fit'),
  }, '⤢');
  const expandAllBtn = h(
    'button',
    { type: 'button', class: 'btn btn--ghost btn--sm', id: 'expand-all' },
    i18n.t('expand.all'),
  );
  const collapseAllBtn = h(
    'button',
    { type: 'button', class: 'btn btn--ghost btn--sm', id: 'collapse-all' },
    i18n.t('collapse.all'),
  );

  const filtersToggleBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn--ghost btn--sm',
      id: 'filters-toggle',
      'aria-expanded': 'false',
      title: i18n.t('btnFilters'),
    },
    i18n.t('btnFilters'),
  );

  const signOutBtn = h(
    'button',
    { type: 'button', class: 'btn btn--ghost btn--sm', id: 'sign-out' },
    i18n.t('btnSignOut'),
  );

  /* ------------------------------- sidebar ------------------------------- */

  function fieldWrap(labelKey: MessageKey, control: HTMLElement): HTMLElement {
    const labelText = i18n.t(labelKey);
    const controlId = control.id;
    const label = controlId
      ? h('label', { class: 'tw-field__label', for: controlId, text: labelText })
      : h('span', { class: 'tw-field__label', text: labelText });
    return h('div', { class: 'tw-field' }, label, control);
  }

  function makeSelect(id: string, options: Array<{ value: string; label: string }>): HTMLSelectElement {
    const sel = h('select', { id, class: 'input tw-select' });
    for (const opt of options) sel.append(h('option', { value: opt.value }, opt.label));
    return sel;
  }

  const genChips = h('div', { class: 'chip-row', id: 'filter-gens' });
  const genderChips = h('div', { class: 'chip-row', id: 'filter-genders' });

  const statusSel = makeSelect('filter-status', [
    { value: '', label: i18n.t('status.everyone') },
    { value: 'living', label: i18n.t('status.living') },
    { value: 'deceased', label: i18n.t('status.deceased') },
  ]);
  const branchSel = makeSelect('filter-branch', [{ value: '', label: i18n.t('filter.allBranches') }]);
  const pobSel = makeSelect('filter-pob', [{ value: '', label: i18n.t('filter.anyPlace') }]);
  const qualSel = makeSelect('filter-qual', [{ value: '', label: i18n.t('filter.anyQual') }]);
  const hasSel = makeSelect('filter-has', [
    { value: '', label: i18n.t('has.anything') },
    { value: 'dob', label: i18n.t('has.dob') },
    { value: 'spouse', label: i18n.t('has.spouse') },
    { value: 'children', label: i18n.t('has.children') },
    { value: 'nochildren', label: i18n.t('has.nochildren') },
  ]);

  const showDeletedCb = h('input', { type: 'checkbox', id: 'show-deleted' });
  const showDeletedRow = h(
    'label',
    { class: 'tw-check', for: 'show-deleted' },
    showDeletedCb,
    h('span', {}, i18n.t('filter.showDeleted')),
  );

  const resetBtn = h(
    'button',
    { type: 'button', class: 'btn btn--ghost btn--sm', id: 'reset-filters' },
    i18n.t('btnReset'),
  );

  const statPeople = h('span', { class: 'stat', id: 'stat-people' });
  const statGens = h('span', { class: 'stat', id: 'stat-generations' });
  const statDeceased = h('span', { class: 'stat', id: 'stat-deceased' });

  const sidebar = h(
    'aside',
    { id: 'tree-filters', class: 'tw-sidebar' },
    h('h2', { class: 'tw-sidebar__title' }, i18n.t('sidebar.filters')),
    h('div', { class: 'tw-stats' }, statPeople, statGens, statDeceased),
    fieldWrap('label.generation', genChips),
    fieldWrap('label.gender', genderChips),
    fieldWrap('label.status', statusSel),
    fieldWrap('label.branch', branchSel),
    fieldWrap('label.pob', pobSel),
    fieldWrap('label.qual', qualSel),
    fieldWrap('label.has', hasSel),
    isAdmin ? showDeletedRow : null,
    resetBtn,
  );

  /* -------------------------------- main --------------------------------- */

  const errorMsg = h('span', { class: 'load-error__msg' });
  const retryBtn = h(
    'button',
    { type: 'button', class: 'btn btn--sm', id: 'load-retry' },
    i18n.t('generic.retry'),
  );
  const errorBox = h(
    'div',
    { id: 'load-error', class: 'load-error', role: 'alert', hidden: true },
    errorMsg,
    retryBtn,
  );

  const emptyNote = h('div', { id: 'empty-note', class: 'tw-empty', hidden: true });

  const world = h('div', { id: 'tree-world', class: 'tree-world' });
  const tooltip = h('div', { id: 'tree-tooltip', class: 'tooltip', hidden: true, 'aria-hidden': 'true' });
  const stage = h(
    'div',
    {
      id: 'tree-stage',
      class: 'tree-stage',
      tabindex: '0',
      role: 'region',
      dir: 'ltr',
      'aria-label': i18n.t('view.tree'),
    },
    world,
    tooltip,
  );

  const tableHost = h('div', { id: 'table-host', class: 'tw-table', hidden: true });
  const detailsHost = h('aside', { id: 'details', class: 'details', hidden: true });

  // Coordinates live entirely in the transform. Browsers may still try to
  // "scroll" the stage to reveal a focused or clicked card (overflow: clip
  // stops this on modern engines; this guard covers the rest) — a scrolled
  // stage would silently break every screen-to-world calculation.
  stage.addEventListener('scroll', () => {
    if (stage.scrollLeft || stage.scrollTop) {
      stage.scrollLeft = 0;
      stage.scrollTop = 0;
    }
  });

  const toolbar = h(
    'div',
    { class: 'tw-toolbar' },
    search,
    h(
      'div',
      { class: 'tw-tabs', role: 'group' },
      viewTreeBtn,
      viewTableBtn,
    ),
    countEl,
    h('div', { class: 'tw-toolbar__spacer' }),
    h(
      'div',
      { class: 'tw-tools', id: 'tree-tools' },
      zoomOutBtn,
      zoomInBtn,
      zoomFitBtn,
      expandAllBtn,
      collapseAllBtn,
    ),
    filtersToggleBtn,
    signOutBtn,
  );

  const main = h('div', { class: 'tw-main' }, errorBox, emptyNote, stage, tableHost);
  const element = h('section', { class: 'tree-workspace' }, toolbar, h('div', { class: 'tw-body' }, sidebar, main, detailsHost));

  /* ------------------------------ pan / zoom ----------------------------- */

  const panzoom = new PanZoomController(stage, world, {
    onTap(card) {
      const id = card.dataset.personId;
      if (id) select(id);
    },
  });

  /* ------------------------------ loading -------------------------------- */

  async function load(): Promise<void> {
    loading = true;
    errorMessage = null;
    renderError();
    try {
      const rows = await fetchAllPeople(client, { admin: isAdmin });
      if (disposed) return;
      all = rows.map((row) => toPerson(row)).filter((p): p is Person => p !== null);
      loading = false;
      rebuild();
      refresh(true);
      if (!all.length) {
        deps.toast(i18n.t('generic.emptyTree'));
      }
    } catch (err) {
      if (disposed) return;
      loading = false;
      const msg = extractMessage(err);
      const key: MessageKey = /invalid_token|JWT/.test(msg)
        ? 'generic.sessionExpired'
        : /not found.+table|table.+not found/i.test(msg)
          ? 'generic.noTable'
          : 'generic.loadFailed';
      errorMessage = i18n.fmt(key, { msg });
      deps.toast(errorMessage);
      renderError();
      refresh(false);
    }
  }

  function renderError(): void {
    if (errorMessage) {
      errorMsg.textContent = errorMessage;
      errorBox.hidden = false;
    } else {
      errorBox.hidden = true;
      errorMsg.textContent = '';
    }
  }

  function rebuild(): void {
    model = buildModel(all, showDeleted);
    for (const id of [...collapsed]) if (!model.byId.has(id)) collapsed.delete(id);
    if (selectedId && !model.byId.has(selectedId)) selectedId = null;
  }

  /* ------------------------------ rendering ------------------------------ */

  function refresh(refit: boolean): void {
    hideTooltip();
    // The canvas stays LTR; the chrome flips with Urdu.
    element.dir = i18n.currentLang() === 'ur' ? 'rtl' : 'ltr';
    element.dataset.view = view;
    vis = computeVisibility(model, filters);
    if (view === 'tree') {
      renderTree(refit);
      tableHost.hidden = true;
      stage.hidden = false;
    } else {
      renderTableView();
      tableHost.hidden = false;
      stage.hidden = true;
    }
    syncSidebar();
    updateCounts();
    updateEmptyNote();
  }

  function renderTree(refit: boolean): void {
    layout = layoutTree(vis.vRoots, vis.vKids, collapsed);
    renderTreeInto(world, {
      i18n,
      lang: i18n.currentLang(),
      model,
      visibleKids: vis.vKids,
      collapsed,
      layout,
      selectedId,
    });
    if (layout.pos.size && (refit || !fitted)) {
      fitTree();
      fitted = true;
    }
    syncSelection();
  }

  function fitTree(): void {
    if (!layout || !layout.pos.size) return;
    const roots = vis.vRoots.filter((r) => layout!.pos.has(r.id));
    const first = roots[0] ? layout.pos.get(roots[0].id) : null;
    panzoom.fit(layout.width, layout.height, {
      multiRoot: roots.length > 1,
      focus: first ? { x: first.x + first.w / 2, y: first.y } : null,
    });
  }

  function renderTableView(): void {
    const source = vis.visible
      ? model.people.filter((p) => vis.matchSet.has(p.id))
      : model.people;
    renderTable(tableHost, sortPeople(source, sort), {
      i18n,
      lang: i18n.currentLang(),
      selectedId,
      visibleIds: null,
      sort,
      onSort: (key: TableColumnKey) => {
        sort = { key, dir: sort && sort.key === key ? (sort.dir === 1 ? -1 : 1) : 1 };
        renderTableView();
      },
      onSelect: (id: string) => select(id),
    });
  }

  function syncSidebar(): void {
    // generation chips
    const maxGen = model.people.reduce((m, p) => Math.max(m, p.gen), 0);
    const gens = model.people.length ? Array.from({ length: maxGen + 1 }, (_, i) => i) : [];
    genChips.replaceChildren(
      ...gens.map((g) => {
        const btn = h(
          'button',
          {
            type: 'button',
            class: `chip chip--gen${filters.gens.has(g) ? ' chip--on' : ''}`,
            'aria-pressed': String(filters.gens.has(g)),
            dataset: { gen: String(g) },
          },
          i18n.fmt('chip.gen', { g }),
        );
        return btn;
      }),
    );
    genderChips.replaceChildren(
      ...(['male', 'female'] as const).map((gender) => {
        const on = filters.genders.has(gender);
        return h(
          'button',
          {
            type: 'button',
            class: `chip chip--${gender}${on ? ' chip--on' : ''}`,
            'aria-pressed': String(on),
            dataset: { gender },
          },
          i18n.t(gender === 'male' ? 'chip.male' : 'chip.female'),
        );
      }),
    );

    // option lists that depend on the data (keep the current choice when possible)
    const fill = (sel: HTMLSelectElement, allLabel: string, values: string[]): void => {
      const current = sel.value;
      sel.replaceChildren(
        h('option', { value: '' }, allLabel),
        ...values.map((v) => h('option', { value: v }, v)),
      );
      sel.value = values.includes(current) ? current : '';
    };
    const uniq = (key: 'pob' | 'qual'): string[] =>
      [...new Set(model.people.map((p) => p[key]).filter((v): v is string => !!v))].sort((a, b) =>
        a.localeCompare(b),
      );
    fill(pobSel, i18n.t('filter.anyPlace'), uniq('pob'));
    fill(qualSel, i18n.t('filter.anyQual'), uniq('qual'));
    const branchCurrent = branchSel.value;
    branchSel.replaceChildren(
      h('option', { value: '' }, i18n.t('filter.allBranches')),
      ...model.people
        .slice()
        .sort((a, b) => getDisplayName(a, i18n.currentLang()).localeCompare(getDisplayName(b, i18n.currentLang())))
        .map((p) => h('option', { value: p.id }, getDisplayName(p, i18n.currentLang()))),
    );
    branchSel.value = model.byId.has(branchCurrent) ? branchCurrent : '';

    statusSel.value = filters.status;
    hasSel.value = filters.has;
    showDeletedCb.checked = showDeleted;
  }

  function updateCounts(): void {
    const total = model.people.length;
    const shown = vis.visible ? vis.matchSet.size : total;
    countEl.textContent = vis.visible
      ? i18n.fmt('table.resultCount.filtered', { shown, n: total })
      : i18n.fmt('table.resultCount.all', { n: total });
    const generations = total ? model.people.reduce((m, p) => Math.max(m, p.gen), 0) + 1 : 0;
    const deceased = model.people.filter((p) => p.dod).length;
    statPeople.textContent = `${i18n.t('stats.people')}: ${total}`;
    statGens.textContent = `${i18n.t('stats.generations')}: ${generations}`;
    statDeceased.textContent = `${i18n.t('stats.deceased')}: ${deceased}`;
  }

  function updateEmptyNote(): void {
    if (loading || errorMessage) {
      emptyNote.hidden = true;
      return;
    }
    if (!model.people.length) {
      emptyNote.textContent = i18n.t('generic.emptyTree');
      emptyNote.hidden = false;
      return;
    }
    if (filtersActive(filters) && vis.matchSet.size === 0) {
      emptyNote.textContent = i18n.t('empty.msg');
      emptyNote.hidden = false;
      return;
    }
    emptyNote.hidden = true;
  }

  /* ------------------------------ selection ------------------------------ */

  function syncSelection(): void {
    for (const el of world.querySelectorAll('.pcard.selected')) el.classList.remove('selected');
    if (!selectedId) return;
    const card = world.querySelector<HTMLElement>(`.pcard[data-person-id="${cssEscape(selectedId)}"]`);
    card?.classList.add('selected');
  }

  function select(id: string, options: { focus?: boolean } = {}): void {
    selectedId = id;
    hideTooltip();
    syncSelection();
    for (const row of tableHost.querySelectorAll('tr.sel')) row.classList.remove('sel');
    const tr = tableHost.querySelector<HTMLElement>(`tr[data-id="${cssEscape(id)}"]`);
    tr?.classList.add('sel');
    const person = model.byId.get(id);
    if (person) {
      renderDetails(detailsHost, person, model, {
        i18n,
        lang: i18n.currentLang(),
        client,
        isAdmin,
        onClose: () => closeDetails(),
        onNavigate: (personId) => select(personId, { focus: true }),
      });
    } else {
      closeDetails();
    }
    if (options.focus) focusPerson(id);
  }

  function closeDetails(): void {
    selectedId = null;
    detailsHost.hidden = true;
    detailsHost.removeAttribute('data-person-id');
    detailsHost.replaceChildren();
    syncSelection();
    for (const row of tableHost.querySelectorAll('tr.sel')) row.classList.remove('sel');
  }

  /** Expand ancestors, drop hiding filters, centre, and pulse. */
  function focusPerson(id: string): void {
    const person = model.byId.get(id);
    if (!person) return;
    for (let c = person.parent; c; c = c.parent) collapsed.delete(c.id);
    if (vis.visible && !vis.visible.has(id)) {
      resetFilters(filters);
      search.value = '';
      deps.toast(i18n.t('generic.filtersCleared'));
    }
    if (view !== 'tree') setView('tree');
    refresh(false);
    const v = layout?.pos.get(id);
    if (!v) return;
    panzoom.centreOn(v.x + v.w / 2, v.y + NODE_H / 2);
    const card = world.querySelector<HTMLElement>(`.pcard[data-person-id="${cssEscape(id)}"]`);
    if (card) {
      card.classList.add('pulse');
      if (pulseTimer != null) window.clearTimeout(pulseTimer);
      pulseTimer = window.setTimeout(() => card.classList.remove('pulse'), 1400);
    }
  }

  /* ------------------------------- tooltip ------------------------------- */

  function tipRow(label: string, value: string | number | null | undefined): HTMLElement | null {
    if (value == null || value === '') return null;
    return h('div', { class: 'tip-row' }, h('dt', {}, label), h('dd', {}, String(value)));
  }

  function showTooltip(person: Person, anchor: HTMLElement, spouseCard: boolean): void {
    const lang = i18n.currentLang();
    const name = getDisplayName(person, lang);
    const kids = model.kids.get(person.id) ?? [];
    let head: HTMLElement;
    let rows: Array<HTMLElement | null>;
    if (spouseCard) {
      head = h(
        'div',
        { class: 'tip-head' },
        h('h4', {}, person.spouse ?? ''),
        h('div', { class: 'tip-sub' }, i18n.fmt('panel.spouseOf', { name })),
      );
      rows = [
        tipRow(i18n.t('edit.spouseFather'), person.spouseFather),
        kids.length ? tipRow(i18n.t('tooltip.children'), kids.length) : null,
      ];
    } else {
      head = h(
        'div',
        { class: 'tip-head' },
        h('h4', {}, name),
        h(
          'div',
          { class: 'tip-sub' },
          (person.nick ? i18n.fmt('panel.nick', { nick: person.nick }) + ' · ' : '') +
            i18n.t(genderLabelKey(person)),
        ),
      );
      rows = [
        tipRow(i18n.t('tooltip.generation'), i18n.fmt('tooltip.genShort', { n: person.gen })),
        tipRow(i18n.t('edit.spouse'), person.spouse),
        tipRow(
          i18n.t('tooltip.born'),
          [person.dob_display || person.dob, person.pob].filter(Boolean).join(' · '),
        ),
        tipRow(i18n.t('edit.qual'), person.qual),
        tipRow(i18n.t('tooltip.died'), person.dod_display || person.dod),
        kids.length ? tipRow(i18n.t('tooltip.children'), kids.length) : null,
      ];
    }
    tooltip.replaceChildren(
      head,
      h('dl', { class: 'tip-dl' }, ...rows.filter((r): r is HTMLElement => r !== null)),
      h(
        'div',
        { class: 'tip-more' },
        spouseCard ? i18n.fmt('tooltip.spouseMore', { name }) : i18n.t('tooltip.more'),
      ),
    );
    tooltip.hidden = false;

    const stageRect = stage.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    let x = rect.right - stageRect.left + 12;
    let y = rect.top - stageRect.top;
    const w = tooltip.offsetWidth;
    const hgt = tooltip.offsetHeight;
    if (x + w > stage.clientWidth - 10) x = Math.max(10, rect.left - stageRect.left - w - 24);
    if (y + hgt > stage.clientHeight - 10) y = stage.clientHeight - hgt - 10;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${Math.max(10, y)}px`;
  }

  function hideTooltip(): void {
    tooltip.hidden = true;
  }

  /* -------------------------------- events ------------------------------- */

  search.addEventListener('input', () => {
    filters.q = search.value.trim();
    refresh(true);
  });

  viewTreeBtn.addEventListener('click', () => setView('tree'));
  viewTableBtn.addEventListener('click', () => setView('table'));

  function setView(target: ViewMode): void {
    view = target;
    viewTreeBtn.setAttribute('aria-pressed', String(target === 'tree'));
    viewTableBtn.setAttribute('aria-pressed', String(target === 'table'));
    refresh(false);
  }

  zoomInBtn.addEventListener('click', () => panzoom.zoomBy(1.25));
  zoomOutBtn.addEventListener('click', () => panzoom.zoomBy(1 / 1.25));
  zoomFitBtn.addEventListener('click', () => fitTree());
  expandAllBtn.addEventListener('click', () => {
    collapsed.clear();
    refresh(true);
  });
  collapseAllBtn.addEventListener('click', () => {
    for (const p of model.people) if ((model.kids.get(p.id) ?? []).length) collapsed.add(p.id);
    refresh(true);
  });

  filtersToggleBtn.addEventListener('click', () => {
    const open = element.classList.toggle('tw--filters-open');
    filtersToggleBtn.setAttribute('aria-expanded', String(open));
  });

  resetBtn.addEventListener('click', () => {
    resetFilters(filters);
    search.value = '';
    refresh(true);
  });

  genChips.addEventListener('click', (event) => {
    const chip = (event.target as Element | null)?.closest<HTMLElement>('[data-gen]');
    if (!chip?.dataset.gen) return;
    const gen = Number(chip.dataset.gen);
    if (filters.gens.has(gen)) filters.gens.delete(gen);
    else filters.gens.add(gen);
    refresh(true);
  });

  genderChips.addEventListener('click', (event) => {
    const chip = (event.target as Element | null)?.closest<HTMLElement>('[data-gender]');
    const gender = chip?.dataset.gender;
    if (gender !== 'male' && gender !== 'female') return;
    if (filters.genders.has(gender)) filters.genders.delete(gender);
    else filters.genders.add(gender);
    refresh(true);
  });

  statusSel.addEventListener('change', () => {
    filters.status = statusSel.value as FilterState['status'];
    refresh(true);
  });
  branchSel.addEventListener('change', () => {
    filters.branch = branchSel.value;
    if (filters.branch) collapsed.delete(filters.branch);
    refresh(true);
  });
  pobSel.addEventListener('change', () => {
    filters.pob = pobSel.value;
    refresh(true);
  });
  qualSel.addEventListener('change', () => {
    filters.qual = qualSel.value;
    refresh(true);
  });
  hasSel.addEventListener('change', () => {
    filters.has = hasSel.value as FilterState['has'];
    refresh(true);
  });
  showDeletedCb.addEventListener('change', () => {
    showDeleted = showDeletedCb.checked;
    rebuild();
    refresh(true);
  });

  retryBtn.addEventListener('click', () => {
    void load();
  });

  signOutBtn.addEventListener('click', () => deps.onSignOut());

  // Collapse toggles (delegated; the buttons are real <button>s so keyboard
  // and click semantics come from the browser).
  world.addEventListener('click', (event) => {
    const tg = (event.target as Element | null)?.closest<HTMLElement>('.tg[data-toggle]');
    if (tg?.dataset.toggle) toggleCollapse(tg.dataset.toggle);
  });

  // Keyboard selection on cards (Enter / Space).
  world.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = (event.target as Element | null)?.closest<HTMLElement>('.pcard[data-person-id]');
    if (card?.dataset.personId) {
      event.preventDefault();
      select(card.dataset.personId);
    }
  });

  // Hover tooltips (desktop).
  world.addEventListener('mouseover', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const card = target?.closest<HTMLElement>('.pcard[data-person-id]');
    if (!card) return;
    const person = card.dataset.personId ? model.byId.get(card.dataset.personId) : null;
    if (person) showTooltip(person, card, card.dataset.spouse === '1');
  });
  world.addEventListener('mouseout', (event) => {
    const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (related && world.contains(related)) return;
    hideTooltip();
  });
  stage.addEventListener('pointerdown', () => hideTooltip());

  /** Collapse/expand a node; the clicked card stays where it is on screen. */
  function toggleCollapse(id: string): void {
    const before = world
      .querySelector<HTMLElement>(`.pcard[data-person-id="${cssEscape(id)}"]`)
      ?.getBoundingClientRect();
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    hideTooltip();
    vis = computeVisibility(model, filters);
    renderTree(false);
    updateCounts();
    updateEmptyNote();
    if (before) {
      const after = world
        .querySelector<HTMLElement>(`.pcard[data-person-id="${cssEscape(id)}"]`)
        ?.getBoundingClientRect();
      if (after) {
        const t = panzoom.transform;
        panzoom.set({
          tx: t.tx - (after.left - before.left),
          ty: t.ty - (after.top - before.top),
          scale: t.scale,
        });
      }
    }
  }

  /* ------------------------------ lifecycle ------------------------------ */

  const unsubscribeLanguage = i18n.onLanguageChange(() => {
    // Re-render for translated option lists, chips, headers and localized names.
    refresh(false);
    if (selectedId) {
      const person = model.byId.get(selectedId);
      if (person) select(selectedId);
    }
  });

  refresh(false);
  void load();

  return {
    element,
    dispose() {
      disposed = true;
      if (pulseTimer != null) window.clearTimeout(pulseTimer);
      unsubscribeLanguage();
      panzoom.dispose();
    },
  };
}

/** CSS.escape with a fallback for environments where it is missing. */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}
