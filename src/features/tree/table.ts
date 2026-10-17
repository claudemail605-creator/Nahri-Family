import { parseDate } from '../../core/dates';
import type { I18n, MessageKey } from '../../core/i18n';
import { getDisplayName } from '../../core/i18n/display';
import type { Lang } from '../../core/types';
import { h } from '../../ui/dom';
import type { Person } from './model';
import { genderLabelKey } from './render';

/**
 * The table view — all 23 reference columns, translated headers, click-to-sort
 * (a second click flips the direction), and the same selection state as the
 * tree (clicking a row opens the details sheet; clicking "focus" in the sheet
 * highlights the row).
 *
 * Sorting is a faithful port of the reference `renderTable()`: numbers sort
 * numerically, DOB/DOD sort by parsed date with missing last, everything else
 * locale-aware, ties keep the underlying order.
 */

export type TableColumnKey =
  | 'id'
  | 'legacy_id'
  | 'name'
  | 'nick'
  | 'gen'
  | 'gender'
  | 'father'
  | 'mother'
  | 'spouse'
  | 'spouseFather'
  | 'dob'
  | 'dob_text'
  | 'pob'
  | 'qual'
  | 'dod'
  | 'dod_text'
  | 'burial'
  | 'name_ur'
  | 'name_hi'
  | 'notes'
  | 'photo_path'
  | 'source'
  | 'is_deleted';

export const TABLE_COLUMNS: ReadonlyArray<{ key: TableColumnKey; labelKey: MessageKey }> = [
  { key: 'id', labelKey: 'table.col.id' },
  { key: 'legacy_id', labelKey: 'table.col.legacyId' },
  { key: 'name', labelKey: 'table.col.name' },
  { key: 'nick', labelKey: 'table.col.nick' },
  { key: 'gen', labelKey: 'table.col.gen' },
  { key: 'gender', labelKey: 'table.col.gender' },
  { key: 'father', labelKey: 'table.col.father' },
  { key: 'mother', labelKey: 'table.col.mother' },
  { key: 'spouse', labelKey: 'table.col.spouse' },
  { key: 'spouseFather', labelKey: 'table.col.spouseFather' },
  { key: 'dob', labelKey: 'table.col.dob' },
  { key: 'dob_text', labelKey: 'table.col.dobText' },
  { key: 'pob', labelKey: 'table.col.pob' },
  { key: 'qual', labelKey: 'table.col.qual' },
  { key: 'dod', labelKey: 'table.col.dod' },
  { key: 'dod_text', labelKey: 'table.col.dodText' },
  { key: 'burial', labelKey: 'table.col.burial' },
  { key: 'name_ur', labelKey: 'table.col.nameUr' },
  { key: 'name_hi', labelKey: 'table.col.nameHi' },
  { key: 'notes', labelKey: 'table.col.notes' },
  { key: 'photo_path', labelKey: 'table.col.photo' },
  { key: 'source', labelKey: 'table.col.source' },
  { key: 'is_deleted', labelKey: 'table.col.deleted' },
];

export interface TableSort {
  key: TableColumnKey;
  dir: 1 | -1;
}

/* ----------------------------- pagination (G6) --------------------------- */

export const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PER_PAGE = 50;

export interface PageSlice<T> {
  rows: T[];
  page: number;
  pageCount: number;
  /** 1-based index of the first row on this page (0 for an empty set). */
  from: number;
  /** 1-based index of the last row (0 for an empty set). */
  to: number;
  total: number;
}

/**
 * Slice a sorted row list into one page. The requested page is clamped into
 * range — a shrinking result (filters, retried loads) can never strand the
 * user on an empty page.
 */
export function paginate<T>(rows: readonly T[], page: number, perPage: number): PageSlice<T> {
  const total = rows.length;
  const size = Math.max(1, Math.floor(perPage) || 1);
  const pageCount = Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (clamped - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    page: clamped,
    pageCount,
    from: total ? start + 1 : 0,
    to: start + slice.length,
    total,
  };
}

function sortValue(p: Person, key: TableColumnKey): string | number | null {
  switch (key) {
    case 'name':
      return p.name;
    case 'gen':
      return p.gen;
    case 'gender':
      return p.gender;
    case 'father':
      return p.father;
    case 'spouseFather':
      return p.spouseFather;
    case 'is_deleted':
      return p.is_deleted ? 1 : 0;
    default:
      return p[key] ?? null;
  }
}

export function sortPeople(people: Person[], sort: TableSort | null): Person[] {
  if (!sort) return people;
  const { key, dir } = sort;
  const rows = people.slice();
  rows.sort((a, b) => {
    if (key === 'gen') return (a.gen - b.gen) * dir || a.id.localeCompare(b.id);
    if (key === 'dob' || key === 'dod') {
      const ax = parseDate(a[key]);
      const bx = parseDate(b[key]);
      return ((ax ? +ax : 1e15) - (bx ? +bx : 1e15)) * dir;
    }
    const av = sortValue(a, key) ?? '';
    const bv = sortValue(b, key) ?? '';
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
  });
  return rows;
}

export interface TablePagerState {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  perPage: number;
}

export interface TableDeps {
  i18n: I18n;
  lang: Lang;
  selectedId: string | null;
  /** Ids matching the active filters, or null when nothing is filtered. */
  visibleIds: ReadonlySet<string> | null;
  sort: TableSort | null;
  onSort(key: TableColumnKey): void;
  onSelect(personId: string): void;
  /** Pagination of the rows handed to renderTable (G6). */
  pager: TablePagerState;
  onPage(page: number): void;
  onPerPage(perPage: number): void;
}

export function renderTable(host: HTMLElement, people: Person[], deps: TableDeps): void {
  const { i18n, lang } = deps;

  function cellText(p: Person, key: TableColumnKey): string {
    if (key === 'name') return getDisplayName(p, lang);
    if (key === 'gender') return p.gender ? i18n.t(genderLabelKey(p)) : '';
    if (key === 'is_deleted') return p.is_deleted ? i18n.t('panel.deleted') : '';
    const value = sortValue(p, key);
    return value == null ? '' : String(value);
  }

  const thead = h('thead', {}, h('tr', {}, ...TABLE_COLUMNS.map((col) => {
    const active = deps.sort?.key === col.key;
    return h(
      'th',
      {
        class: active ? 'sorted' : '',
        dataset: { key: col.key },
        'aria-sort': active ? (deps.sort!.dir === 1 ? 'ascending' : 'descending') : 'none',
      },
      h('button', { type: 'button', class: 'th-btn' }, i18n.t(col.labelKey), active ? (deps.sort!.dir === 1 ? ' ▲' : ' ▼') : ''),
    );
  })));

  const tbody = h(
    'tbody',
    {},
    ...people.map((p) => {
      const classes = [
        deps.visibleIds && !deps.visibleIds.has(p.id) ? 'nomatch' : '',
        deps.selectedId === p.id ? 'sel' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return h(
        'tr',
        {
          dataset: { id: p.id },
          class: classes || null,
          tabindex: '0',
        },
        ...TABLE_COLUMNS.map((col) => {
          const text = cellText(p, col.key);
          if (text === '') return h('td', { class: 'dash' }, '—');
          return h('td', { title: text }, text);
        }),
      );
    }),
  );

  thead.addEventListener('click', (event) => {
    const th = (event.target as Element | null)?.closest('th');
    const key = th?.dataset.key as TableColumnKey | undefined;
    if (key) deps.onSort(key);
  });
  const selectRow = (event: Event): void => {
    const tr = (event.target as Element | null)?.closest('tr[data-id]');
    if (tr instanceof HTMLElement && tr.dataset.id) deps.onSelect(tr.dataset.id);
  };
  tbody.addEventListener('click', selectRow);
  tbody.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectRow(event);
    }
  });

  /* Pagination footer (G6); hidden for an empty table — the empty state
     carries that message. The range doubles as the page indicator. */
  function buildPager(): HTMLElement {
    const pager = h(
      'div',
      { class: 'table-pager' },
      h(
        'span',
        { class: 'tp-range' },
        i18n.fmt('table.pagerInfo', {
          from: deps.pager.from,
          to: deps.pager.to,
          total: deps.pager.total,
        }),
      ),
      h(
        'select',
        { class: 'input tp-per', 'aria-label': i18n.t('table.perPage') },
        ...PER_PAGE_OPTIONS.map((size) =>
          h('option', { value: String(size), selected: size === deps.pager.perPage }, String(size)),
        ),
      ),
    h(
      'button',
      {
        type: 'button',
        class: 'tp-btn',
        dataset: { dir: '-1' },
        'aria-label': i18n.t('table.prevPage'),
        disabled: deps.pager.page <= 1,
      },
      '‹',
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'tp-btn',
        dataset: { dir: '1' },
        'aria-label': i18n.t('table.nextPage'),
        disabled: deps.pager.page >= deps.pager.pageCount,
      },
      '›',
    ),
    );
    return pager;
  }
  const pager = deps.pager.total > 0 ? buildPager() : null;
  if (pager) {
    pager.addEventListener('click', (event) => {
      const btn = (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-dir]');
      if (!btn || btn.disabled) return;
      deps.onPage(deps.pager.page + Number(btn.dataset.dir));
    });
    pager.querySelector<HTMLSelectElement>('.tp-per')?.addEventListener('change', (event) => {
      const perPage = Number((event.target as HTMLSelectElement).value);
      if (Number.isFinite(perPage) && perPage > 0) deps.onPerPage(perPage);
    });
  }

  host.replaceChildren(
    h('div', { class: 'table-scroll' }, h('table', { class: 'tree-table' }, thead, tbody)),
    ...(pager ? [pager] : []),
  );
}
