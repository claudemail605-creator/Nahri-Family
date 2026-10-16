import type { I18n, MessageKey } from '../../core/i18n';
import { prefersReducedMotion } from '../../core/motion';
import type { WorkspacePermissions } from '../../core/permissions';
import { h } from '../../ui/dom';
import type { Person, TreeModel } from './model';

/**
 * The "My Family Branch" guided workspace — port of the reference
 * `js/branch.js`. A branch-limited editor lands here after signing in: their
 * assigned anchor person (or a chooser when there are several), every
 * relative they are allowed to work on, honest completeness computed live
 * from the saved fields, and focused actions (add/edit details, add child,
 * add spouse).
 *
 * Security is unchanged and untouched by this module: which people appear is
 * derived from `branch_access` (the same table `can_edit_person()` reads) and
 * every button is gated by the same permission mirror the database uses.
 *
 * The controller is created once per workspace; `render()` is called on every
 * refresh, so data changes flow back into the tiles.
 */

export interface BranchViewDeps {
  i18n: I18n;
  getModel(): TreeModel;
  permissions: WorkspacePermissions;
  /** Open the details sheet for a person. */
  select(id: string): void;
  /** Switch back to the tree view (and remember the choice). */
  backToTree(): void;
  toast(message: string): void;
  edit(person: Person): void;
  addChild(person: Person): void;
  labelOf(person: Person): string;
}

/** Completeness item → the dictionary key that names it. */
export const MISSING_KEY: Record<string, MessageKey> = {
  nick: 'edit.nickname',
  gender: 'edit.gender',
  dob: 'edit.dob',
  pob: 'edit.pob',
  parents: 'edit.section.parents',
  spouse: 'edit.spouse',
  children: 'tooltip.children',
  qual: 'edit.qual',
  photo: 'edit.photoChoose',
};

export interface Completeness {
  missing: string[];
  pct: number;
}

/** Real saved fields only — nothing invented, nothing assumed. */
export function completeness(person: Person, kids: readonly Person[]): Completeness {
  const items: Array<[string, unknown]> = [
    ['nick', person.nick],
    ['gender', person.gender],
    ['dob', person.dob || person.dob_text],
    ['pob', person.pob],
    ['parents', person.father || person.mother || person.parentId],
    ['spouse', person.spouse],
    ['children', kids.length],
    ['qual', person.qual],
    ['photo', person.photo_path],
  ];
  const missing = items.filter(([, value]) => !value).map(([key]) => key);
  const pct = items.length ? Math.round(((items.length - missing.length) / items.length) * 100) : 100;
  return { missing, pct };
}

/** The anchor person and all their descendants (cycle-safe). */
export function branchPeopleOf(model: TreeModel, anchorId: string): Person[] {
  const seen = new Set<string>();
  const out: Person[] = [];
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const person = model.byId.get(id);
    if (!person) return;
    out.push(person);
    for (const child of model.kids.get(id) ?? []) walk(child.id);
  };
  walk(anchorId);
  return out;
}

interface ScoredPerson {
  person: Person;
  comp: Completeness;
}

export interface BranchView {
  render(host: HTMLElement, options: { loading: boolean }): void;
  /** True when the last render actually showed the workspace (not a bounce). */
  isOpen(): boolean;
}

export function createBranchView(deps: BranchViewDeps): BranchView {
  const { i18n, permissions } = deps;
  const t = (key: MessageKey): string => i18n.t(key);

  let activeBranch: string | null = null;
  let filter: 'all' | 'missing' | 'done' = 'all';
  let highlighted: string | null = null;
  let open = false;
  let cleanupTimer: number | null = null;

  /** Refresh with the workspace open keeps the current branch chooser state. */
  function branchIds(model: TreeModel): string[] {
    return permissions.branchAccess().filter((id) => model.byId.has(id));
  }

  function firstIncomplete(list: ScoredPerson[]): ScoredPerson | null {
    return list.find((p) => p.comp.missing.length > 0) ?? null;
  }

  function scrollBehavior(): ScrollBehavior {
    return prefersReducedMotion() ? 'auto' : 'smooth';
  }

  function jumpTo(host: HTMLElement, id: string): void {
    highlighted = id;
    const tile = host.querySelector<HTMLElement>(`[data-tile="${CSS.escape(id)}"]`);
    if (!tile) return;
    tile.classList.add('branch-tile--highlight');
    tile.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
    if (cleanupTimer != null) window.clearTimeout(cleanupTimer);
    cleanupTimer = window.setTimeout(() => {
      tile.classList.remove('branch-tile--highlight');
      if (highlighted === id) highlighted = null;
    }, 1400);
  }

  function render(host: HTMLElement, options: { loading: boolean }): void {
    const model = deps.getModel();

    // Loading vs. genuinely empty — never claim "no people" mid-flight.
    if (!model.people.length) {
      open = false;
      host.replaceChildren(
        h('div', { class: 'branch-wrap' }, h('div', { class: 'branch-empty', text: t(options.loading ? 'branch.loadingPeople' : 'generic.emptyTree') })),
      );
      return;
    }

    const ids = branchIds(model);
    const me = permissions.isActiveEditor() && !permissions.isAdmin();

    // An admin (or unexpected role) must never see a narrowed experience.
    if (!me) {
      open = false;
      deps.backToTree();
      return;
    }

    // No valid assignment: a clear message, never a fake grant. Reading the
    // tree stays available below (the database decides that anyway).
    if (!ids.length) {
      open = true;
      const openTree = h('button', { type: 'button', class: 'btn btn--primary', id: 'br_open-tree' }, t('branch.openTree'));
      openTree.addEventListener('click', () => deps.backToTree());
      host.replaceChildren(
        h(
          'div',
          { class: 'branch-wrap' },
          h(
            'div',
            { class: 'branch-hero' },
            h('h2', { text: t('branch.noAssignmentTitle') }),
            h('p', { text: t('branch.noAssignmentSub') }),
            h('div', { class: 'branch-cta' }, openTree),
          ),
        ),
      );
      return;
    }

    // A valid anchor must exist in the model; stale ids are dropped quietly.
    if (!activeBranch || !ids.includes(activeBranch)) activeBranch = ids[0]!;

    open = true;
    const anchor = model.byId.get(activeBranch) ?? null;
    const list = branchPeopleOf(model, activeBranch);
    const scored: ScoredPerson[] = list.map((person) => ({
      person,
      comp: completeness(person, model.kids.get(person.id) ?? []),
    }));
    const done = scored.filter((p) => !p.comp.missing.length).length;
    const todo = scored.length - done;
    const pct = scored.length ? Math.round((done / scored.length) * 100) : 100;

    const shown = scored.filter((p) =>
      filter === 'missing' ? p.comp.missing.length > 0 : filter === 'done' ? !p.comp.missing.length : true,
    );

    // ---- hero ----
    const startBtn = h('button', { type: 'button', class: 'btn btn--primary', id: 'br_start' }, t('branch.start'));
    startBtn.addEventListener('click', () => {
      const first = firstIncomplete(scored);
      if (first) {
        jumpTo(host, first.person.id);
      } else {
        filter = 'all';
        render(host, options);
      }
    });
    const back1 = h('button', { type: 'button', class: 'btn btn--ghost', id: 'br_back-tree' }, t('branch.backToTree'));
    back1.addEventListener('click', () => deps.backToTree());

    const hero = h(
      'div',
      { class: 'branch-hero' },
      h('h2', { text: t('branch.welcomeTitle') }),
      h('p', { text: t('branch.welcomeSub') }),
      h(
        'div',
        { class: 'branch-anchor' },
        i18n.fmt('branch.yourAnchor', { name: '' }),
        h('b', { text: anchor ? deps.labelOf(anchor) : '' }),
        anchor?.dob_display ? h('span', { text: ` · ${anchor.dob_display}` }) : null,
      ),
      h('div', { class: 'branch-cta' }, startBtn, back1),
    );

    // ---- progress ----
    const summary = h(
      'div',
      { class: 'branch-summary' },
      h('div', { class: 'branch-stat' }, h('b', { text: String(scored.length) }), h('span', { text: t('branch.statPeople') })),
      h('div', { class: 'branch-stat' }, h('b', { class: 'ok', text: String(done) }), h('span', { text: t('branch.statComplete') })),
      h('div', { class: 'branch-stat' }, h('b', { class: 'miss', text: String(todo) }), h('span', { text: t('branch.statMissing') })),
    );
    const bar = h(
      'div',
      { class: 'branch-bar' },
      h('div', { class: 'branch-bar__fill', style: `width: ${pct}%` }),
    );

    // ---- toolbar ----
    const segBtn = (value: 'all' | 'missing' | 'done', label: string): HTMLElement => {
      const button = h(
        'button',
        { type: 'button', class: `seg__btn${filter === value ? ' seg__btn--on' : ''}`, dataset: { f: value } },
        label,
      );
      button.addEventListener('click', () => {
        filter = value;
        render(host, options);
      });
      return button;
    };
    const nextBtn = h('button', { type: 'button', class: 'btn btn--sm', id: 'br_next' }, t('branch.nextIncomplete'));
    nextBtn.addEventListener('click', () => {
      const next = firstIncomplete(shown);
      if (!next) {
        deps.toast(t('branch.everythingShown'));
        return;
      }
      jumpTo(host, next.person.id);
    });
    const back2 = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', id: 'br_back-tree-2' }, t('branch.backToTree'));
    back2.addEventListener('click', () => deps.backToTree());

    const toolbar = h(
      'div',
      { class: 'branch-toolbar' },
      h(
        'div',
        { class: 'seg seg--sm' },
        segBtn('all', i18n.fmt('branch.filterAll', { n: scored.length })),
        segBtn('missing', i18n.fmt('branch.filterMissing', { n: todo })),
        segBtn('done', i18n.fmt('branch.filterDone', { n: done })),
      ),
      nextBtn,
      back2,
    );

    // ---- multi-anchor chooser ----
    const chooser =
      ids.length > 1
        ? h(
            'div',
            { class: 'branch-note' },
            t('branch.chooseBranch'),
            h(
              'div',
              { class: 'branch-choose' },
              ...ids.map((id) => {
                const candidate = model.byId.get(id)!;
                const button = h(
                  'button',
                  {
                    type: 'button',
                    class: `btn btn--sm${id === activeBranch ? ' btn--primary' : ''}`,
                    dataset: { branch: id },
                  },
                  deps.labelOf(candidate),
                );
                button.addEventListener('click', () => {
                  activeBranch = id;
                  render(host, options);
                });
                return button;
              }),
            ),
          )
        : null;

    // ---- tiles ----
    const grid = h('div', { class: 'branch-grid', id: 'br_grid' });
    shown.forEach((entry, index) => {
      grid.append(tile(entry, index));
    });

    host.replaceChildren(
      h(
        'div',
        { class: 'branch-wrap' },
        hero,
        summary,
        bar,
        h('p', { class: 'branch-note branch-note--summary', text: i18n.fmt('branch.summary', { c: done, n: scored.length, p: pct }) }),
        toolbar,
        chooser,
        grid,
      ),
    );
  }

  function tile(entry: ScoredPerson, index: number): HTMLElement {
    const { person, comp } = entry;
    const canEdit = permissions.canEditPerson(person.id, person.path);
    const doneTile = comp.missing.length === 0;

    const actions: HTMLElement[] = [];
    if (canEdit) {
      const editBtn = h(
        'button',
        { type: 'button', class: 'btn btn--sm', dataset: { act: 'edit' } },
        t(doneTile ? 'branch.editDetails' : 'branch.addDetails'),
      );
      editBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        deps.edit(person);
      });
      actions.push(editBtn);

      const childBtn = h(
        'button',
        { type: 'button', class: 'btn btn--sm', dataset: { act: 'addchild' } },
        t('panel.addChild'),
      );
      childBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        deps.addChild(person);
      });
      actions.push(childBtn);

      if (!person.spouse) {
        // The spouse is a text field on this person's own record — the same
        // edit form, focused by the user (reference "Add a spouse" action).
        const spouseBtn = h(
          'button',
          { type: 'button', class: 'btn btn--sm', dataset: { act: 'addspouse' } },
          t('branch.addSpouseS'),
        );
        spouseBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          deps.edit(person);
        });
        actions.push(spouseBtn);
      }
    }

    const missingChips = comp.missing.slice(0, 6).map((key) =>
      h('span', { class: 'tile-chip', text: t(MISSING_KEY[key] ?? (key as MessageKey)) }),
    );

    const tileEl = h(
      'div',
      {
        class: `branch-tile ${doneTile ? 'branch-tile--done' : 'branch-tile--todo'}`,
        role: 'button',
        tabindex: '0',
        dataset: { tile: person.id },
        style: `--i: ${Math.min(index, 8)}`,
      },
      h(
        'div',
        { class: 'tile-head' },
        h(
          'div',
          { class: 'tile-ring', style: `--p: ${comp.pct}%` },
          h('i', { text: `${comp.pct}%` }),
        ),
        h(
          'div',
          { class: 'tile-titles' },
          h('div', { class: 'tile-name', text: deps.labelOf(person) }),
          person.parent
            ? h('div', { class: 'tile-rel', text: `${deps.labelOf(person.parent)} · ${i18n.fmt('chip.gen', { g: person.gen })}` })
            : h('div', { class: 'tile-rel', text: i18n.fmt('chip.gen', { g: person.gen }) }),
        ),
      ),
      h(
        'div',
        { class: 'tile-missing' },
        doneTile ? h('span', { class: 'tile-chip tile-chip--ok', text: t('branch.complete') }) : null,
        ...missingChips,
      ),
      actions.length ? h('div', { class: 'tile-actions' }, ...actions) : null,
    );

    tileEl.addEventListener('click', (event) => {
      if ((event.target as Element).closest('[data-act]')) return;
      deps.select(person.id);
    });
    tileEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      deps.select(person.id);
    });

    return tileEl;
  }

  return {
    render,
    isOpen: () => open,
  };
}
