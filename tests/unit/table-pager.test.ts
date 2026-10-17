import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n, type I18n } from '../../src/core/i18n';
import { toPerson, type Person } from '../../src/features/tree/model';
import {
  DEFAULT_PER_PAGE,
  paginate,
  PER_PAGE_OPTIONS,
  renderTable,
  type TableDeps,
  type TablePagerState,
} from '../../src/features/tree/table';
import { rawRow } from './tree-fixture';

/** Minimal people for the DOM tests: rows p1..pN so slices are checkable. */
function persons(n: number): Person[] {
  return Array.from({ length: n }, (_, i) =>
    toPerson(rawRow({ id: `p${i + 1}`, full_name: `P ${i + 1}` })),
  ).filter((p): p is Person => p !== null);
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('paginate', () => {
  it('keeps an empty set on a single empty page (from/to 0)', () => {
    expect(paginate([], 3, 10)).toEqual({
      rows: [],
      page: 1,
      pageCount: 1,
      from: 0,
      to: 0,
      total: 0,
    });
  });

  it('fits a short result on one page', () => {
    const rows = Array.from({ length: 13 }, (_, i) => i);
    expect(paginate(rows, 1, DEFAULT_PER_PAGE)).toEqual({
      rows,
      page: 1,
      pageCount: 1,
      from: 1,
      to: 13,
      total: 13,
    });
  });

  it('slices the second page of a partial fit', () => {
    const rows = Array.from({ length: 13 }, (_, i) => i);
    const first = paginate(rows, 1, 10);
    expect(first.pageCount).toBe(2);
    expect(first.rows).toHaveLength(10);
    expect(first.from).toBe(1);
    expect(first.to).toBe(10);
    const second = paginate(rows, 2, 10);
    expect(second.page).toBe(2);
    expect(second.rows).toEqual([10, 11, 12]);
    expect(second.from).toBe(11);
    expect(second.to).toBe(13);
  });

  it('keeps a full last page within [from, to]', () => {
    const rows = Array.from({ length: 20 }, (_, i) => i);
    const second = paginate(rows, 2, 10);
    expect(second.pageCount).toBe(2);
    expect(second.rows).toHaveLength(10);
    expect(second.from).toBe(11);
    expect(second.to).toBe(20);
  });

  it('clamps impossible pages into range', () => {
    const rows = Array.from({ length: 13 }, (_, i) => i);
    expect(paginate(rows, 0, 10).page).toBe(1);
    expect(paginate(rows, -3, 10).page).toBe(1);
    expect(paginate(rows, 99, 10).page).toBe(2);
    expect(paginate(rows, Number.NaN, 10).page).toBe(1);
  });

  it('treats non-positive per-page values as one row per page', () => {
    const rows = Array.from({ length: 3 }, (_, i) => i);
    for (const perPage of [0, -5, Number.NaN]) {
      const out = paginate(rows, 1, perPage);
      expect(out.rows).toEqual([0]);
      expect(out.pageCount).toBe(3);
    }
  });
});

describe('renderTable pagination footer', () => {
  const i18n: I18n = createI18n({ loadScriptFonts: false });

  function pagerState(over: Partial<TablePagerState>): TablePagerState {
    return {
      page: 1,
      pageCount: 1,
      from: 1,
      to: 13,
      total: 13,
      perPage: DEFAULT_PER_PAGE,
      ...over,
    };
  }

  /** Renders with the given pager state; rows are the matching slice. */
  function render(
    over: Partial<TablePagerState> = {},
    handlers: Partial<Pick<TableDeps, 'onPage' | 'onPerPage' | 'onSelect'>> = {},
  ): { host: HTMLElement; deps: TableDeps } {
    const state = pagerState(over);
    const host = document.createElement('div');
    document.body.append(host);
    const deps: TableDeps = {
      i18n,
      lang: 'en',
      selectedId: null,
      visibleIds: null,
      sort: null,
      onSort: vi.fn(),
      onSelect: vi.fn(),
      pager: state,
      onPage: vi.fn(),
      onPerPage: vi.fn(),
      ...handlers,
    };
    renderTable(host, state.total === 0 ? [] : persons(state.total).slice(state.from - 1, state.to), deps);
    return { host, deps };
  }

  it('renders the range, per-page select and edge-disabled arrows', () => {
    const { host } = render({ page: 1, pageCount: 1, from: 1, to: 13 });
    const pager = host.querySelector<HTMLElement>('.table-pager')!;
    expect(pager.querySelector('.tp-range')!.textContent).toBe('1–13 of 13');
    expect(pager.querySelector<HTMLButtonElement>('button[data-dir="-1"]')!.disabled).toBe(true);
    expect(pager.querySelector<HTMLButtonElement>('button[data-dir="1"]')!.disabled).toBe(true);
    const select = pager.querySelector<HTMLSelectElement>('.tp-per')!;
    expect(select.value).toBe(String(DEFAULT_PER_PAGE));
    expect(select.getAttribute('aria-label')).toBe('Rows per page');
    expect([...select.options].map((o) => o.value)).toEqual(PER_PAGE_OPTIONS.map(String));
    expect(host.querySelectorAll('tbody tr')).toHaveLength(13);
  });

  it('enables the arrows mid-range and reports page / per-page changes', () => {
    const onPage = vi.fn();
    const onPerPage = vi.fn();
    const { host } = render(
      { page: 2, pageCount: 3, from: 11, to: 20, total: 40, perPage: 10 },
      { onPage, onPerPage },
    );
    const pager = host.querySelector<HTMLElement>('.table-pager')!;
    expect(pager.querySelector('.tp-range')!.textContent).toBe('11–20 of 40');
    expect(pager.querySelector<HTMLButtonElement>('button[data-dir="-1"]')!.disabled).toBe(false);
    expect(pager.querySelector<HTMLButtonElement>('button[data-dir="1"]')!.disabled).toBe(false);
    pager.querySelector<HTMLButtonElement>('button[data-dir="-1"]')!.click();
    expect(onPage).toHaveBeenCalledWith(1);
    pager.querySelector<HTMLButtonElement>('button[data-dir="1"]')!.click();
    expect(onPage).toHaveBeenCalledWith(3);
    const select = pager.querySelector<HTMLSelectElement>('.tp-per')!;
    select.value = '25';
    select.dispatchEvent(new Event('change'));
    expect(onPerPage).toHaveBeenCalledWith(25);
  });

  it('hides the footer entirely for an empty table', () => {
    const { host } = render({ page: 1, pageCount: 1, from: 0, to: 0, total: 0 });
    expect(host.querySelector('.table-pager')).toBeNull();
    expect(host.querySelector('.tree-table')).not.toBeNull();
  });
});
