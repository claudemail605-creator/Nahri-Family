import type { I18n, MessageKey } from '../../core/i18n';
import { getDisplayName } from '../../core/i18n/display';
import type { Lang } from '../../core/types';
import { h } from '../../ui/dom';
import { GAP_Y, NODE_H, NODE_W, PAD, SPOUSE_GAP, type LayoutResult } from './layout';
import { genderClass, type Person, type TreeModel } from './model';

/**
 * The tree canvas DOM: generation bands, orthogonal connectors, one node per
 * person (a card, the spouse card beside it, the bond between them and the
 * collapse toggle). Pure DOM building — no state, no events beyond the data
 * attributes the view delegates on (`data-person-id`, `data-toggle`).
 *
 * The world element is owned by the caller and kept alive across re-renders:
 * the pan/zoom controller holds a reference to it, so content is replaced
 * rather than the element itself.
 */

export interface TreeRenderOptions {
  i18n: I18n;
  lang: Lang;
  model: TreeModel;
  /** Kids as drawn for the current filters, keyed by person id. */
  visibleKids: ReadonlyMap<string, Person[]>;
  collapsed: ReadonlySet<string>;
  layout: LayoutResult;
  selectedId: string | null;
  /** Ids drawn by the previous render; nodes absent from it fade in. */
  previousIds?: ReadonlySet<string>;
}

/** Localized label for the stored gender text. */
export function genderLabelKey(person: Pick<Person, 'gender'>): MessageKey {
  const g = genderClass(person);
  return g === 'male' ? 'chip.male' : g === 'female' ? 'chip.female' : 'panel.genderUnknown';
}

/**
 * Orthogonal elbow from a parent card's bottom centre to a child's top centre,
 * with a rounded corner where it changes direction.
 */
export function elbowPath(x1: number, y1: number, x2: number, y2: number, radius = 8): string {
  if (Math.abs(x2 - x1) < 1) return `M ${x1} ${y1} V ${y2}`;
  const midY = y1 + (y2 - y1) / 2;
  const r = Math.min(radius, Math.abs(x2 - x1) / 2, Math.max(1, Math.abs(midY - y1)));
  const s = x2 > x1 ? 1 : -1;
  return (
    `M ${x1} ${y1} V ${midY - r} Q ${x1} ${midY} ${x1 + s * r} ${midY} ` +
    `H ${x2 - s * r} Q ${x2} ${midY} ${x2} ${midY + r} V ${y2}`
  );
}

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** `12/03/1940 – 02/01/2005` (or whichever half exists). */
export function cardDates(p: Person): string {
  return [p.dob_display, p.dod_display].filter(Boolean).join(' – ');
}

export function renderTreeInto(world: HTMLElement, options: TreeRenderOptions): Set<string> {
  const { i18n, model, layout, collapsed } = options;
  const { pos, width, height, minGen } = layout;
  const visibleKids = (id: string): Person[] => options.visibleKids.get(id) ?? [];
  const rendered = new Set<string>();
  let enterIndex = 0;

  const fragment = document.createDocumentFragment();

  // Generation bands (even generations only, as in the reference — odd bands
  // would double the visual noise for no information).
  const gensUsed = new Set<number>();
  for (const id of pos.keys()) gensUsed.add(model.byId.get(id)!.gen);
  for (const gen of [...gensUsed].sort((a, b) => a - b)) {
    if (gen % 2 !== 0) continue;
    const band = h(
      'div',
      { class: 'band', 'aria-hidden': 'true' },
      h('span', { class: 'band__label' }, i18n.fmt('panel.generation', { n: gen })),
    );
    band.style.top = `${PAD + (gen - minGen) * (NODE_H + GAP_Y) - GAP_Y / 2}px`;
    band.style.height = `${NODE_H + GAP_Y}px`;
    band.style.width = `${width}px`;
    fragment.append(band);
  }

  // Connectors + spouse bonds.
  const svg = svgEl('svg', { class: 'tree-links', width, height, 'aria-hidden': 'true' });
  for (const [id, v] of pos) {
    const p = model.byId.get(id)!;
    if (!collapsed.has(id)) {
      for (const kid of visibleKids(id)) {
        const q = pos.get(kid.id);
        if (!q) continue;
        svg.append(
          svgEl('path', {
            class: 'tree-link',
            d: elbowPath(
              PAD + v.x + v.w / 2,
              PAD + v.y + NODE_H,
              PAD + q.x + q.w / 2,
              PAD + q.y,
            ),
          }),
        );
      }
    }
    if (p.spouse) {
      const y = PAD + v.y + NODE_H / 2;
      svg.append(
        svgEl('line', {
          class: 'tree-bond',
          x1: PAD + v.x + NODE_W,
          y1: y,
          x2: PAD + v.x + NODE_W + SPOUSE_GAP,
          y2: y,
        }),
      );
    }
  }
  fragment.append(svg);

  // Nodes, in the model's own order so the DOM order is stable.
  for (const p of model.people) {
    const v = pos.get(p.id);
    if (!v) continue;
    const name = getDisplayName(p, options.lang);
    const gcls = genderClass(p);

    const node = h('div', { class: 'tree-node' });
    if (options.previousIds && !options.previousIds.has(p.id)) {
      // Newly revealed (or first-paint) node: fade in, gently staggered.
      node.classList.add('node-in');
      if (enterIndex < 24) node.style.setProperty('--enter-i', String(enterIndex++));
    }
    node.style.left = `${PAD + v.x}px`;
    node.style.top = `${PAD + v.y}px`;
    node.style.width = `${v.w}px`;
    node.style.height = `${NODE_H}px`;

    const sub = p.nick ? i18n.fmt('panel.nick', { nick: p.nick }) : (p.qual ?? null);
    const dates = cardDates(p);
    const card = h(
      'div',
      {
        class:
          'pcard pcard--' +
          gcls +
          (p.is_deleted ? ' pcard--deleted' : '') +
          (p.dod ? ' pcard--deceased' : '') +
          (options.selectedId === p.id ? ' selected' : ''),
        dataset: { personId: p.id },
        role: 'button',
        tabindex: '0',
        'aria-label': name,
      },
      h('span', { class: 'pcard__rail', 'aria-hidden': 'true' }),
      h('span', { class: 'pcard__avatar', 'aria-hidden': 'true' }, p._initials),
      h(
        'span',
        { class: 'pcard__body' },
        h('span', { class: 'pcard__name', text: name }),
        sub ? h('span', { class: 'pcard__sub', text: sub }) : null,
        dates ? h('span', { class: 'pcard__dates', text: dates }) : null,
      ),
      p.dod ? h('span', { class: 'pcard__dagger', 'aria-hidden': 'true' }, '†') : null,
    );
    node.append(card);

    if (p.spouse) {
      const spouse = h(
        'div',
        {
          class: 'pcard pcard--spouse',
          dataset: { personId: p.id, spouse: '1' },
          role: 'button',
          tabindex: '0',
          'aria-label': i18n.fmt('panel.spouseOf', { name }),
        },
        h('span', { class: 'pcard__label' }, i18n.t('edit.spouse')),
        h(
          'span',
          { class: 'pcard__body' },
          h('span', { class: 'pcard__name', text: p.spouse }),
          p.spouseFather ? h('span', { class: 'pcard__sub', text: p.spouseFather }) : null,
        ),
      );
      spouse.style.left = `${NODE_W + SPOUSE_GAP}px`;
      spouse.style.width = `${NODE_W}px`;
      node.append(spouse);
    }

    const kids = visibleKids(p.id);
    if (kids.length) {
      const isCollapsed = collapsed.has(p.id);
      const label = i18n.t(isCollapsed ? 'tg.expand' : 'tg.collapse');
      const tg = h(
        'button',
        {
          type: 'button',
          class: 'tg',
          dataset: { toggle: p.id },
          title: label,
          'aria-label': label,
          'aria-expanded': String(!isCollapsed),
        },
        isCollapsed ? `+ ${kids.length}` : '−',
      );
      // Positioned relative to the node (which already sits at PAD + v.x/y).
      tg.style.left = `${v.w / 2}px`;
      tg.style.top = `${NODE_H - 12}px`;
      node.append(tg);
    }

    rendered.add(p.id);
    fragment.append(node);
  }

  world.replaceChildren(fragment);
  return rendered;
}
