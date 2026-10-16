import type { Person } from './model';

/**
 * Tree geometry — the reference's subtree-width layout (`layout()`), with the
 * same maths and new card dimensions (the redesign's ledger cards are a little
 * taller; the CSS mirrors these constants).
 *
 * The layout is fully deterministic and pure: same inputs, same positions.
 * Each node's box is `unitWidth` wide (a spouse card pair is wider, the spouse
 * sits to the right of their partner); parents are centred over their
 * children; a collapsed node is laid out as if it had no children, which is
 * exactly what makes the keep-position trick on toggle possible.
 */

export const NODE_W = 196;
export const NODE_H = 80;
export const GAP_X = 18;
export const GAP_Y = 72;
export const PAD = 96;
export const SPOUSE_GAP = 28;

/** Card-pair width: a person card alone, or person + bond + spouse card. */
export function unitWidth(person: Person): number {
  return person.spouse ? NODE_W * 2 + SPOUSE_GAP : NODE_W;
}

export interface Placement {
  x: number;
  y: number;
  /** Rendered width of the unit (person + optional spouse card). */
  w: number;
}

export interface LayoutResult {
  pos: Map<string, Placement>;
  minGen: number;
  /** World size including the PAD margin on every side (0 when empty). */
  width: number;
  height: number;
}

const EMPTY: Person[] = [];

export function layoutTree(
  roots: Person[],
  visibleKids: ReadonlyMap<string, Person[]>,
  collapsed: ReadonlySet<string>,
): LayoutResult {
  const pos = new Map<string, Placement>();
  const widths = new Map<string, number>();
  const kidsOf = (p: Person): Person[] =>
    collapsed.has(p.id) ? EMPTY : (visibleKids.get(p.id) ?? EMPTY);
  const minGen = roots.length ? Math.min(...roots.map((r) => r.gen)) : 0;

  const width = (p: Person): number => {
    const k = kidsOf(p);
    const w = k.length
      ? Math.max(
          unitWidth(p),
          k.reduce((sum, c) => sum + width(c), 0) + GAP_X * (k.length - 1),
        )
      : unitWidth(p);
    widths.set(p.id, w);
    return w;
  };

  const place = (p: Person, left: number): void => {
    const w = widths.get(p.id) ?? unitWidth(p);
    const uw = unitWidth(p);
    pos.set(p.id, {
      // Centre the unit box inside its reserved subtree width, but keep the
      // person's own card at the left edge of the unit (the spouse grows right).
      x: left + w / 2 - uw / 2,
      y: (p.gen - minGen) * (NODE_H + GAP_Y),
      w: uw,
    });
    const k = kidsOf(p);
    if (!k.length) return;
    const total = k.reduce((sum, c) => sum + (widths.get(c.id) ?? 0), 0) + GAP_X * (k.length - 1);
    let x = left + (w - total) / 2;
    for (const c of k) {
      place(c, x);
      x += (widths.get(c.id) ?? 0) + GAP_X;
    }
  };

  let x = 0;
  for (const r of roots) {
    width(r);
    place(r, x);
    x += (widths.get(r.id) ?? 0) + GAP_X * 2;
  }

  let maxX = 0;
  let maxY = 0;
  for (const v of pos.values()) {
    maxX = Math.max(maxX, v.x + v.w);
    maxY = Math.max(maxY, v.y + NODE_H);
  }
  return {
    pos,
    minGen,
    width: pos.size ? maxX + PAD * 2 : 0,
    height: pos.size ? maxY + PAD * 2 : 0,
  };
}
