import type { SupabaseClient } from '@supabase/supabase-js';
import { ageYears, formatWhen } from '../../core/dates';
import type { I18n } from '../../core/i18n';
import { getDisplayName } from '../../core/i18n/display';
import type { Lang } from '../../core/types';
import { h } from '../../ui/dom';
import { genderClass, type Person, type TreeModel } from './model';
import { genderLabelKey } from './render';

/**
 * The details sheet — the reference panel's sections (Personal / Family /
 * Passing / Relatives / Record / localized names) rebuilt read-only for
 * Phase 3: no photo, no edit actions (those arrive with their own phases).
 *
 * Relatives are navigation buttons; the record section shows "Last edited"
 * and, for admins, upgrades it with who made the change from `audit_log`
 * (a failed read is not worth an error — the timestamp still shows).
 */

export interface DetailsPanelDeps {
  i18n: I18n;
  lang: Lang;
  client: SupabaseClient;
  isAdmin: boolean;
  onClose(): void;
  /** Relative-button click: select + centre that person. */
  onNavigate(personId: string): void;
}

export function renderDetails(
  host: HTMLElement,
  person: Person,
  model: TreeModel,
  deps: DetailsPanelDeps,
): void {
  const { i18n, lang } = deps;
  const name = getDisplayName(person, lang);
  const kids = model.kids.get(person.id) ?? [];
  const siblings = person.parent
    ? (model.kids.get(person.parent.id) ?? []).filter((x) => x.id !== person.id)
    : [];
  const age = ageYears(person.dob, person.dod);

  function row(label: string, value: string | null | undefined): HTMLElement | null {
    if (value == null || value === '') return null;
    return h(
      'div',
      { class: 'p-row' },
      h('div', { class: 'p-row__k', text: label }),
      h('div', { class: 'p-row__v', text: value }),
    );
  }

  function section(title: string, rows: Array<HTMLElement | null>): HTMLElement | null {
    const kept = rows.filter((r): r is HTMLElement => r !== null);
    if (!kept.length) return null;
    return h('div', { class: 'p-sec' }, h('h5', { text: title }), ...kept);
  }

  function relButtons(list: Person[]): HTMLElement {
    return h(
      'div',
      { class: 'rel' },
      ...list.map((p) =>
        h(
          'button',
          {
            type: 'button',
            class: 'rel__btn',
            dataset: { goto: p.id },
            onclick: () => deps.onNavigate(p.id),
          },
          (p.nick ? p.nick + ' – ' : '') + getDisplayName(p, lang),
        ),
      ),
    );
  }

  /* ------------------------------- sections ------------------------------- */

  const personal = section(i18n.t('panel.personal'), [
    row(i18n.t('edit.dob'), person.dob_display || person.dob),
    row(
      i18n.t('panel.age'),
      age == null ? null : i18n.fmt(person.dod ? 'panel.ageAtDeath' : 'panel.ageValue', { n: age }),
    ),
    row(i18n.t('edit.pob'), person.pob),
    row(i18n.t('edit.qual'), person.qual),
  ]);

  const family = section(i18n.t('panel.family'), [
    row(i18n.t('edit.father'), person.father),
    row(i18n.t('edit.mother'), person.mother),
    row(i18n.t('edit.spouse'), person.spouse),
    row(i18n.t('edit.spouseFather'), person.spouseFather),
  ]);

  const passing = section(i18n.t('panel.passing'), [
    row(i18n.t('edit.dod'), person.dod_display || person.dod),
    row(i18n.t('edit.burial'), person.burial),
  ]);

  const relatives: Array<HTMLElement | null> = [];
  if (person.parent) {
    relatives.push(
      h('div', { class: 'rel-label', text: i18n.t('panel.parent') }),
      relButtons([person.parent]),
    );
  }
  if (siblings.length) {
    relatives.push(
      h('div', { class: 'rel-label', text: i18n.fmt('panel.siblings', { n: siblings.length }) }),
      relButtons(siblings),
    );
  }
  if (kids.length) {
    relatives.push(
      h('div', { class: 'rel-label', text: i18n.fmt('panel.children', { n: kids.length }) }),
      relButtons(kids),
    );
  }
  const relativesSec = relatives.length
    ? h('div', { class: 'p-sec' }, h('h5', { text: i18n.t('panel.relatives') }), ...relatives)
    : null;

  let lastEditedSlot: HTMLElement | null = null;
  if (person.updated_at) {
    lastEditedSlot = h('div', { class: 'p-row__v', dataset: { lastEdited: '1' } });
    lastEditedSlot.textContent = formatWhen(person.updated_at) ?? '';
  }
  const record = section(i18n.t('panel.record'), [
    row(i18n.t('table.col.id'), person.id),
    row(i18n.t('table.col.legacyId'), person.legacy_id),
    row(i18n.t('edit.parentField'), person.parentId),
    row(i18n.t('table.col.source'), person.source),
    lastEditedSlot
      ? h(
          'div',
          { class: 'p-row' },
          h('div', { class: 'p-row__k', text: i18n.t('panel.lastEdited') }),
          lastEditedSlot,
        )
      : null,
  ]);

  const nameUr = person.name_ur
    ? h(
        'div',
        { class: 'p-sec' },
        h('h5', { text: i18n.t('panel.nameUr') }),
        h('div', { class: 'p-row' }, h('div', { class: 'p-row__v p-row__v--full', dir: 'rtl', text: person.name_ur })),
      )
    : null;
  const nameHi = person.name_hi
    ? h(
        'div',
        { class: 'p-sec' },
        h('h5', { text: i18n.t('panel.nameHi') }),
        h('div', { class: 'p-row' }, h('div', { class: 'p-row__v p-row__v--full', text: person.name_hi })),
      )
    : null;

  const bodyParts = [personal, family, passing, relativesSec, record, nameUr, nameHi].filter(
    (s): s is HTMLElement => s !== null,
  );

  /* --------------------------------- head --------------------------------- */

  const tags = h(
    'div',
    { class: 'p-tags' },
    h('span', { class: `tag tag--${genderClass(person)}` }, i18n.t(genderLabelKey(person))),
    h('span', { class: 'tag' }, i18n.fmt('panel.generation', { n: person.gen })),
    person.dod ? h('span', { class: 'tag tag--gray' }, i18n.t('panel.deceased')) : null,
    kids.length ? h('span', { class: 'tag tag--gray' }, i18n.fmt('panel.children', { n: kids.length })) : null,
    person.is_deleted ? h('span', { class: 'tag tag--gray' }, i18n.t('panel.deleted')) : null,
    person.legacy_id
      ? h('span', { class: 'tag tag--gray' }, i18n.fmt('panel.legacy', { id: person.legacy_id }))
      : null,
  );

  const head = h(
    'div',
    { class: 'p-head' },
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn p-close',
        id: 'panel-close',
        'aria-label': i18n.t('panel.close'),
        onclick: () => deps.onClose(),
      },
      '✕',
    ),
    h('div', { class: `p-avatar p-avatar--${genderClass(person)}`, 'aria-hidden': 'true' }, person._initials),
    h('h3', { class: 'p-name', text: name }),
    person.nick ? h('div', { class: 'p-nick', text: i18n.fmt('panel.nick', { nick: person.nick }) }) : null,
    tags,
  );

  host.dataset.personId = person.id;
  host.replaceChildren(
    head,
    bodyParts.length
      ? h('div', { class: 'p-body' }, ...bodyParts)
      : h('div', { class: 'p-none', text: i18n.t('panel.noDetails') }),
  );
  host.hidden = false;
  host.scrollTop = 0;

  if (lastEditedSlot && deps.isAdmin) {
    void hydrateLastEdited(lastEditedSlot, person, deps);
  }
}

/** "Last edited … by who" — admin only, and only ever an upgrade of the timestamp. */
async function hydrateLastEdited(
  slot: HTMLElement,
  person: Person,
  deps: DetailsPanelDeps,
): Promise<void> {
  try {
    const { data, error } = await deps.client
      .from('audit_log')
      .select('changed_by_name, changed_at')
      .eq('person_id', person.id)
      .order('changed_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const hit = (data?.[0] ?? null) as { changed_by_name: string | null; changed_at: string | null } | null;
    if (!hit || !slot.isConnected) return;
    const when = formatWhen(hit.changed_at) || formatWhen(person.updated_at) || '';
    slot.textContent = hit.changed_by_name
      ? deps.i18n.fmt('panel.lastEditedBy', { name: hit.changed_by_name, date: when })
      : deps.i18n.fmt('panel.lastEditedOn', { date: when });
  } catch (err) {
    console.warn('Could not read the audit log for last-edited:', err);
  }
}
