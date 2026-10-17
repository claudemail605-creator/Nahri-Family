/*
 * Tools — the reference's Phase 6 extras (L1–L4) in one modal, opened from
 * the header by any signed-in user with a loaded tree (reference parity:
 * the open() guard toasts the empty tree; the header button itself is not
 * gated).
 *
 * Tabs in the reference order: relationship (kinship walker) · upcoming
 * (birthdays + remembrances) · statistics, with print / PNG in the head.
 * Structure mirrors js/extras.js but in this app's design language: the same
 * admin.css tab-list component and the Phase 4 modal as the shell — a
 * design-system adaptation only, the behavior and copy are the reference's.
 *
 * The two relationship picks persist across opens in a module singleton,
 * exactly like the reference's `state` object. The upcoming list and the
 * stats are computed fresh per open: the reference cached its upcoming list
 * for the whole page life (silently stale after edits), and a fresh pure
 * model walk costs nothing and never lies.
 */
import type { I18n, MessageKey, MessageVars } from '../../core/i18n';
import { getDisplayName } from '../../core/i18n/display';
import { h } from '../../ui/dom';
import { openModal, type ModalHandle } from '../../ui/modal';
import type { Person, TreeModel } from '../tree/model';
import { computeRelation, type RelationResult } from './kinship';
import { buildUpcoming, UPCOMING_DAYS, type UpcomingRow } from './upcoming';
import { buildStats } from './stats';

export interface ToolExtrasDeps {
  i18n: I18n;
  /** The live workspace model. */
  getModel(): TreeModel;
  /** Client-side selection — the goto-person rows (L2) use it. */
  selectPerson(id: string): void;
  /** Fill the print head and schedule window.print; false when nothing to print. */
  print(): boolean;
  /** Draw + download the PNG; resolves true on success (it toasts its own failures). */
  exportPng(): Promise<boolean>;
  toast(message: string): void;
}

type ToolTab = 'related' | 'birthdays' | 'stats';

const TAB_KEYS: readonly ToolTab[] = ['related', 'birthdays', 'stats'];

/** The last two relationship picks, per the reference module singleton. */
const memory: { a: string; b: string } = { a: '', b: '' };

export function openToolsModal(deps: ToolExtrasDeps): ModalHandle | null {
  const model = deps.getModel();
  if (!model.people.length) {
    deps.toast(deps.i18n.t('generic.emptyTree'));
    return null;
  }

  const i18n = deps.i18n;
  const T = (key: MessageKey, vars?: MessageVars): string =>
    vars ? i18n.fmt(key, vars) : i18n.t(key);
  const dispName = (p: Person): string => getDisplayName(p, i18n.currentLang());

  let currentTab: ToolTab = 'related';
  let result: RelationResult | null = null;
  let handle: ModalHandle | null = null;

  const tabsBar = h('div', { class: 'admin-tabs', role: 'tablist' });
  const body = h('div', { class: 'admin-body', id: 'x-body' });

  function renderTabs(): void {
    tabsBar.replaceChildren(
      ...TAB_KEYS.map((id) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: 'admin-tab' + (id === currentTab ? ' admin-tab--on' : ''),
            dataset: { tab: id },
            'aria-selected': String(id === currentTab),
          },
          T(`extra.tab.${id}` as MessageKey),
        ),
      ),
    );
  }

  /* ------------------------ 1. how are we related? ------------------------ */

  function pickGrid(): HTMLElement {
    // Generation then name, reference rule; "Name · Gen g · parent" keeps the
    // pick readable even with the family's repeated given names.
    const makeOptions = (): HTMLElement[] =>
      model.people
        .filter((p) => !p.is_deleted)
        .sort((a, b) => a.gen - b.gen || String(a.name).localeCompare(String(b.name)))
        .map((p) =>
          h(
            'option',
            { value: p.id },
            `${dispName(p)} · ${T('panel.generation', { n: p.gen })}` +
              (p.parent ? ` · ${dispName(p.parent)}` : ''),
          ),
        );
    // Fresh option nodes per select — DOM nodes cannot live in two places.
    const aSel = h('select', { class: 'input tw-select', id: 'ex_a' }, h('option', { value: '' }, T('extra.relatedPick')), ...makeOptions());
    const bSel = h('select', { class: 'input tw-select', id: 'ex_b' }, h('option', { value: '' }, T('extra.relatedPick')), ...makeOptions());
    aSel.value = memory.a;
    bSel.value = memory.b;
    aSel.addEventListener('change', () => (memory.a = aSel.value));
    bSel.addEventListener('change', () => (memory.b = bSel.value));

    return h(
      'div',
      { class: 'extra-grid' },
      h('label', { class: 'tw-field' }, h('span', { class: 'tw-field__label', text: T('extra.relatedFrom') }), aSel),
      h('label', { class: 'tw-field' }, h('span', { class: 'tw-field__label', text: T('extra.relatedTo') }), bSel),
    );
  }

  function sentenceText(result: Extract<RelationResult, { kind: 'related' }>): string {
    const s = result.sentence;
    return s.key === 'extra.relatedBelow'
      ? T(s.key, { name: dispName(s.person), n: s.n, root: dispName(result.common) })
      : T(s.key, {
          a: dispName(s.a),
          up: s.up,
          b: dispName(s.b),
          down: s.down,
          root: dispName(result.common),
        });
  }

  function renderRelated(): void {
    const grid = pickGrid();
    const go = h(
      'div',
      { class: 'admin-bar' },
      h('button', { type: 'button', class: 'btn btn--primary btn--sm', id: 'ex_go' }, T('extra.relatedGo')),
    );
    go.querySelector('#ex_go')!.addEventListener('click', () => {
      result = computeRelation(model, memory.a || null, memory.b || null);
      renderRelated();
    });

    let resultPart: HTMLElement | null = null;
    if (result) {
      if (result.kind === 'same') {
        resultPart = h('p', { class: 'admin-note', text: T('extra.relatedSame') });
      } else if (result.kind === 'noPath') {
        resultPart = h('p', { class: 'admin-note', text: T('extra.relatedNoPath') });
      } else {
        resultPart = h(
          'div',
          { class: 'rel-result' },
          h('span', {
            class: 'rel-term',
            text: result.term.approx ? T('extra.relatedUnknownTerm') : T(result.term.key),
          }),
          `${T('extra.relatedCommon', { name: dispName(result.common) })} ${sentenceText(result)}`,
          h('div', { class: 'rel-chain' }, result.chain.map((p) => dispName(p)).join(' → ')),
        );
        resultPart.scrollIntoView({ block: 'center' });
      }
    }

    const resultNode: Array<Node | null> = [resultPart];
    body.replaceChildren(
      h('h5', { class: 'hist-title', text: T('extra.relatedTitle') }),
      h('p', { class: 'admin-hint', text: T('extra.relatedSub') }),
      grid,
      go,
      ...resultNode.filter((x): x is Node => x !== null),
      h('p', { class: 'admin-hint rel-note', text: T('extra.relatedNote') }),
    );
  }

  /* -------------------------- 2. upcoming dates ---------------------------- */

  function renderUpcoming(upcoming: UpcomingRow[]): void {
    // Clicking a name closes the tools and selects that person on the tree
    // (reference goto-person).
    const rows = upcoming.map((row) => {
      const who = h(
        'button',
        { type: 'button', class: 'upcoming-who', dataset: { gotoPerson: row.person.id } },
        dispName(row.person),
      );
      who.addEventListener('click', () => {
        const id = row.person.id;
        deps.selectPerson(id);
        handle?.close();
      });
      return h(
        'div',
        { class: `upcoming-row ${row.kind === 'birth' ? 'birthday' : 'mourning'}` },
        h('span', {
          class: 'upcoming-when',
          text: row.days === 0 ? T('extra.today') : T('extra.inDays', { n: row.days }),
        }),
        who,
        h('span', {
          class: 'upcoming-extra',
          text:
            (row.kind === 'birth'
              ? T('extra.birthdayTurns', { age: row.years })
              : T('extra.remembranceYears', { n: row.years })) +
            ' · ' +
            `${String(row.when.getUTCDate()).padStart(2, '0')}/${String(row.when.getUTCMonth() + 1).padStart(2, '0')}`,
        }),
      );
    });
    const list: HTMLElement = rows.length
      ? h('div', { class: 'upcoming-list' }, ...rows)
      : h('p', { class: 'admin-note', text: T('extra.birthdaysNone', { days: UPCOMING_DAYS }) });

    body.replaceChildren(
      h('h5', { class: 'hist-title', text: T('extra.birthdaysTitle') }),
      h('p', { class: 'admin-hint', text: T('extra.birthdaysSub', { days: UPCOMING_DAYS }) }),
      list,
    );
  }

  /* ----------------------------- 3. statistics ----------------------------- */

  function bar(label: string, value: number, max: number, cls: string): HTMLElement {
    return h(
      'div',
      { class: 'bar-row' },
      h('span', { text: label }),
      h(
        'span',
        { class: 'bar-track' },
        h('span', {
          class: `bar-fill ${cls}`.trim(),
          style: `width:${max ? Math.round((value / max) * 100) : 0}%`,
        }),
      ),
      h('span', { class: 'bar-value', text: String(value) }),
    );
  }

  function renderStats(): void {
    const stats = buildStats(model);
    if (!stats.people) {
      body.replaceChildren(
        h('h5', { class: 'hist-title', text: T('extra.statsTitle') }),
        h('p', { class: 'admin-note', text: T('extra.statsNone') }),
      );
      return;
    }

    const genMax = Math.max(1, ...stats.gens.map((g) => g.count));
    const genderMax = Math.max(stats.men, stats.women, stats.unknown, 1);
    const oldestYoungest: HTMLElement[] = [];
    if (stats.oldest) {
      oldestYoungest.push(
        h('div', { class: 'upcoming-row' },
          h('span', { class: 'upcoming-who', text: dispName(stats.oldest.person) }),
          h('span', { class: 'upcoming-extra', text: T('extra.statsAge', { n: stats.oldest.age }) }),
        ),
      );
    }
    // When the list holds a single person, oldest and youngest are the same
    // row — the reference printed it once and so does this port.
    if (stats.youngest) {
      oldestYoungest.push(
        h('div', { class: 'upcoming-row' },
          h('span', { class: 'upcoming-who', text: dispName(stats.youngest.person) }),
          h('span', { class: 'upcoming-extra', text: T('extra.statsAge', { n: stats.youngest.age }) }),
        ),
      );
    }
    if (!stats.oldest) {
      oldestYoungest.push(h('p', { class: 'admin-note', text: T('extra.statsNone') }));
    }

    body.replaceChildren(
      h('h5', { class: 'hist-title', text: T('extra.statsTitle') }),
      h(
        'div',
        { class: 'stat-block' },
        h('h5', { text: T('extra.statsByGen') }),
        h('div', { class: 'bars' }, ...stats.gens.map((g) => bar(T('panel.generation', { n: g.gen }), g.count, genMax, ''))),
      ),
      h(
        'div',
        { class: 'stat-block' },
        h('h5', { text: T('extra.statsGender') }),
        h(
          'div',
          { class: 'bars' },
          bar(T('chip.male'), stats.men, genderMax, 'male'),
          bar(T('chip.female'), stats.women, genderMax, 'female'),
          stats.unknown ? bar(T('panel.genderUnknown'), stats.unknown, genderMax, 'unknown') : null,
        ),
      ),
      h(
        'div',
        { class: 'stat-block' },
        h('h5', { text: `${T('extra.statsOldest')} / ${T('extra.statsYoungest')}` }),
        ...oldestYoungest,
      ),
      h(
        'div',
        { class: 'stat-block' },
        h('h5', { text: T('extra.statsPlaces') }),
        stats.places.length
          ? h('div', { class: 'bars' }, ...stats.places.map((pl) => bar(pl.place, pl.count, stats.places[0]!.count || 1, '')))
          : h('p', { class: 'admin-note', text: T('extra.statsNone') }),
      ),
      h(
        'div',
        { class: 'stat-block' },
        h('h5', { text: T('extra.statsChildren') }),
        stats.children.length
          ? h(
              'div',
              { class: 'upcoming-list' },
              ...stats.children.map((c) =>
                h('div', { class: 'upcoming-row' },
                  h('span', { class: 'upcoming-who', text: dispName(c.person) }),
                  h('span', { class: 'upcoming-extra', text: T('panel.children', { n: c.count }) }),
                ),
              ),
            )
          : h('p', { class: 'admin-note', text: T('extra.statsNone') }),
      ),
    );
  }

  function loadTab(): void {
    if (currentTab === 'related') return renderRelated();
    if (currentTab === 'birthdays') return renderUpcoming(buildUpcoming(model, new Date()));
    renderStats();
  }

  renderTabs();
  loadTab();

  tabsBar.addEventListener('click', (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>('button[data-tab]');
    const id = target?.dataset.tab as ToolTab | undefined;
    if (!id || !TAB_KEYS.includes(id)) return;
    currentTab = id;
    renderTabs();
    loadTab();
  });

  const unsubscribeLang = i18n.onLanguageChange(() => {
    renderTabs();
    loadTab();
  });

  const printBtn = h('button', { type: 'button', class: 'btn btn--sm', id: 'ex_print' }, T('extra.printPage'));
  const pngBtn = h('button', { type: 'button', class: 'btn btn--sm', id: 'ex_png' }, T('extra.printPng'));
  printBtn.addEventListener('click', () => {
    if (deps.print()) handle?.close();
  });
  pngBtn.addEventListener('click', () => {
    void deps.exportPng().then((ok) => {
      if (ok) handle?.close();
    });
  });

  const headActions = document.createDocumentFragment();
  headActions.append(printBtn, pngBtn);
  const opened = openModal({
    title: T('extra.tools'),
    subtitle: T('extra.printTitle'),
    headActions,
    content: h('div', { class: 'admin-shell' }, tabsBar, body),
    dialogClass: 'modal--wide extra-modal',
    closeLabel: T('extra.close'),
    onClose: unsubscribeLang,
  });
  handle = opened;
  return opened;
}
