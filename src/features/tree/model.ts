import { formatSupabaseDate, toIsoDate } from '../../core/dates';
import { initials } from '../../core/names';
import type { RawPersonRow } from '../../data/people';

/**
 * The internal people model — a faithful port of the reference `build()`
 * plus the row mapping from `loadFromSupabase()`.
 *
 * The tree, panel, table, search and (later) the branch workspace all read
 * this one shape. `parent` and `gen` are computed from the real parent links
 * (never from the stored Generation column, which the reference also
 * distrusted); a parent loop parks the affected people as roots instead of
 * hanging or dropping them.
 */

export type GenderClass = 'male' | 'female' | 'unknown';

export interface Person {
  id: string;
  legacy_id: string | null;
  parentId: string | null;
  gender: string | null;
  name: string | null;
  nick: string | null;
  father: string | null;
  mother: string | null;
  spouse: string | null;
  spouseFather: string | null;
  /** Display fallback (`DD/MM/YYYY`) — the real date object is parsed on demand. */
  dob: string | null;
  /** Untouched `YYYY-MM-DD` for `<input type=date>`; never rewritten. */
  dob_iso: string | null;
  dob_text: string | null;
  /** What the UI shows: the original text wins over the tidied date. */
  dob_display: string | null;
  pob: string | null;
  qual: string | null;
  dod: string | null;
  dod_iso: string | null;
  dod_text: string | null;
  dod_display: string | null;
  burial: string | null;
  name_ur: string | null;
  name_hi: string | null;
  notes: string | null;
  photo_path: string | null;
  source: string | null;
  is_deleted: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** uuid[] maintained by the DB trigger; used by the permission check only. */
  path: string[];

  /* ---- computed by buildModel() ---- */
  gen: number;
  parent: Person | null;
  /** Lower-cased search text: English, Urdu and Hindi spellings, places, dates. */
  _hay: string;
  _initials: string;
}

export interface TreeModel {
  /** People in the model (soft-deleted included only when showDeleted). */
  people: Person[];
  byId: Map<string, Person>;
  kids: Map<string, Person[]>;
  roots: Person[];
}

/** Map one raw row; rows without an id or a name are dropped (reference rule). */
export function toPerson(row: RawPersonRow): Person | null {
  if (!row.id || !row.full_name) return null;
  const dob = formatSupabaseDate(row.dob);
  const dod = formatSupabaseDate(row.dod);
  return {
    id: row.id,
    legacy_id: row.legacy_id || null,
    parentId: row.parent_id || null,
    gender: row.gender || null,
    name: row.full_name || null,
    nick: row.nick_name || null,
    father: row.fathers_name || null,
    mother: row.mothers_name || null,
    spouse: row.spouse_name || null,
    spouseFather: row.spouse_father_name || null,
    dob,
    dob_iso: toIsoDate(row.dob),
    dob_text: row.dob_text || null,
    dob_display: row.dob_text || dob,
    pob: row.place_of_birth || null,
    qual: row.qualification || null,
    dod,
    dod_iso: toIsoDate(row.dod),
    dod_text: row.dod_text || null,
    dod_display: row.dod_text || dod,
    burial: row.place_of_burial || null,
    name_ur: row.name_ur || null,
    name_hi: row.name_hi || null,
    notes: row.notes || null,
    photo_path: row.photo_path || null,
    source: row.source || null,
    is_deleted: !!row.is_deleted,
    created_by: row.created_by || null,
    updated_by: row.updated_by || null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    path: Array.isArray(row.path) ? row.path.slice() : [],
    gen: 0,
    parent: null,
    _hay: '',
    _initials: initials(row.full_name),
  };
}

/** Row list → model. `showDeleted` only ever matters for admins (RLS aside). */
export function buildModel(people: Person[], showDeleted: boolean): TreeModel {
  const rows = people.filter((p) => !(p.is_deleted && !showDeleted));
  const byId = new Map(rows.map((p) => [p.id, p]));
  const kids = new Map(rows.map((p) => [p.id, [] as Person[]]));
  const roots: Person[] = [];
  for (const p of rows) {
    if (p.parentId && byId.has(p.parentId) && p.parentId !== p.id) kids.get(p.parentId)!.push(p);
    else roots.push(p);
  }
  // Depth from the tree structure. `seen` also makes parent loops safe: any
  // person stuck in a loop is parked as a root instead of vanishing.
  const seen = new Set<string>();
  const walk = (p: Person, depth: number): void => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    p.gen = depth;
    p.parent = p.parentId ? (byId.get(p.parentId) ?? null) : null;
    for (const child of kids.get(p.id)!) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  for (const p of rows) {
    if (!seen.has(p.id)) {
      roots.push(p);
      walk(p, 0);
    }
  }
  for (const p of rows) {
    p._hay = [
      p.id,
      p.name,
      p.name_ur,
      p.name_hi,
      p.nick,
      p.spouse,
      p.dob,
      p.dob_text,
      p.pob,
      p.qual,
      p.dod,
      p.dod_text,
      p.burial,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }
  return { people: rows, byId, kids, roots };
}

/** Stored gender (`Male` / `Female`) → the class used for colour and filters. */
export function genderClass(person: Pick<Person, 'gender'>): GenderClass {
  const g = person.gender || '';
  if (/^m/i.test(g)) return 'male';
  if (/^f/i.test(g)) return 'female';
  return 'unknown';
}

/** Walk up the real parent chain; used by the branch filter and permissions. */
export function isDescendantOf(person: Person, ancestorId: string): boolean {
  for (let c: Person | null = person; c; c = c.parent) {
    if (c.id === ancestorId) return true;
  }
  return false;
}
