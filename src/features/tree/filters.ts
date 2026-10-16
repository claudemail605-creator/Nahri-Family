import { genderClass, isDescendantOf, type Person, type TreeModel } from './model';

/**
 * Sidebar filters and the visibility pass — a direct port of the reference's
 * `matches()` / `computeVisibility()`.
 *
 * The rule that matters: filters REMOVE everyone who does not match, but a
 * matching person whose parents were removed is re-attached to their nearest
 * remaining ancestor — the family never loses the shape of a branch just
 * because one link is missing from the filter.
 */

export type HasFilter = '' | 'dob' | 'spouse' | 'children' | 'nochildren';
export type StatusFilter = '' | 'living' | 'deceased';

export interface FilterState {
  q: string;
  gens: Set<number>;
  genders: Set<'male' | 'female'>;
  status: StatusFilter;
  /** Person id whose branch is shown (the person themself is always kept). */
  branch: string;
  pob: string;
  qual: string;
  has: HasFilter;
}

export function createFilters(): FilterState {
  return {
    q: '',
    gens: new Set(),
    genders: new Set(),
    status: '',
    branch: '',
    pob: '',
    qual: '',
    has: '',
  };
}

export function resetFilters(f: FilterState): void {
  f.q = '';
  f.status = '';
  f.branch = '';
  f.pob = '';
  f.qual = '';
  f.has = '';
  f.gens.clear();
  f.genders.clear();
}

export function filtersActive(f: FilterState): boolean {
  return !!(
    f.q ||
    f.gens.size ||
    f.genders.size ||
    f.status ||
    f.branch ||
    f.pob ||
    f.qual ||
    f.has
  );
}

/** Multi-term AND search over the pre-built haystack (any script matches). */
export function personMatches(model: TreeModel, f: FilterState, p: Person): boolean {
  if (f.q && !f.q.toLowerCase().split(/\s+/).every((term) => p._hay.includes(term))) return false;
  if (f.gens.size && !f.gens.has(p.gen)) return false;
  if (f.genders.size && !f.genders.has(genderClass(p) as 'male' | 'female')) return false;
  if (f.status === 'deceased' && !p.dod) return false;
  if (f.status === 'living' && p.dod) return false;
  if (f.branch && !isDescendantOf(p, f.branch)) return false;
  if (f.pob && p.pob !== f.pob) return false;
  if (f.qual && p.qual !== f.qual) return false;
  if (f.has === 'dob' && !p.dob) return false;
  if (f.has === 'spouse' && !p.spouse) return false;
  if (f.has === 'children' && !(model.kids.get(p.id) ?? []).length) return false;
  if (f.has === 'nochildren' && (model.kids.get(p.id) ?? []).length) return false;
  return true;
}

export interface Visibility {
  /** Ids on screen, or null for "everyone" (no filters active). */
  visible: Set<string> | null;
  /** Kids as drawn: only visible people, attached to their nearest visible ancestor. */
  vKids: Map<string, Person[]>;
  vRoots: Person[];
  matchSet: Set<string>;
}

export function computeVisibility(model: TreeModel, f: FilterState): Visibility {
  const matchSet = new Set(model.people.filter((p) => personMatches(model, f, p)).map((p) => p.id));
  if (!filtersActive(f)) {
    return { visible: null, vKids: model.kids, vRoots: model.roots, matchSet };
  }
  const visible = new Set(matchSet);
  if (f.branch) visible.add(f.branch);
  const vKids = new Map<string, Person[]>(model.people.map((p) => [p.id, []]));
  const vRoots: Person[] = [];
  for (const p of model.people) {
    if (!visible.has(p.id)) continue;
    let a = p.parent;
    while (a && !visible.has(a.id)) a = a.parent;
    if (a) vKids.get(a.id)!.push(p);
    else vRoots.push(p);
  }
  return { visible, vKids, vRoots, matchSet };
}
