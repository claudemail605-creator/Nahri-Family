/**
 * Spreadsheet import (H6) — the reference's parseWorkbook as pure functions.
 * The XLSX-bound part (reading a workbook) stays in the tab's glue
 * (tabs.ts); everything here is plain data in, plain data out, unit-tested
 * without a spreadsheet in sight.
 *
 * Read the original column layout and report every problem found. Nothing is
 * written to the database here.
 */
import type { ImportRow } from '../../data/admin';

/** The sheet the whole pipeline speaks — the original export's name. */
export const IMPORT_SHEET = 'Family_Data';

type FieldName = keyof ImportRow;

/** Original header text → field (lowercase letters only, then compared). */
const COLUMN_MAP: Readonly<Record<string, FieldName>> = {
  individualid: 'legacy',
  parentid: 'parent',
  gender: 'gender',
  fullname: 'full_name',
  nickname: 'nick_name',
  fathersname: 'fathers_name',
  mothersname: 'mothers_name',
  spousename: 'spouse_name',
  spousefathername: 'spouse_father_name',
  dob: 'dob_text',
  placeofbirth: 'place_of_birth',
  qualification: 'qualification',
  dateofdeath: 'dod_text',
  placeofburial: 'place_of_burial',
  sourcefile: 'source',
  nameurdu: 'name_ur',
  nameur: 'name_ur',
  namerdu: 'name_ur',
  namehindi: 'name_hi',
  namehi: 'name_hi',
};

/** The six problem keys the parser can raise, and their parameters. */
export type ImportProblemKey =
  | 'admin.importNoName'
  | 'admin.importBadGender'
  | 'admin.importBadDate'
  | 'admin.importDodBeforeDob'
  | 'admin.importDup'
  | 'admin.importBadParent';

export type TranslateProblem = (
  key: ImportProblemKey,
  params: Record<string, string | number>,
) => string;

export interface ParsedImport {
  rows: ImportRow[];
  problems: string[];
}

const norm = (header: unknown): string =>
  String(header ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

/** Does this read as a full date (any separator, day or year first)? */
export function looksNumericDate(text: unknown): boolean {
  return /^\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}$/.test(String(text ?? '').trim());
}

/**
 * "01/03/1970" or "1970-03-01" → "1970-03-01"; partial dates ("1970",
 * "1965 (approx)") stay text-only — they are legitimate and never promoted.
 * Out-of-range dates ("1985-13-45") fail on purpose so the admin sees them.
 */
export function isoDate(text: unknown): string | null {
  const s = String(text ?? '').trim();
  if (!s) return null;
  let m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  if (m) {
    const y = Number(m[3]);
    const mo = Number(m[2]);
    const d = Number(m[1]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    // "1985-13-45" matches the shape but is not a date either.
    return null;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return null;
}

type RawCell = Record<string, unknown>;

/**
 * Turn sheet rows (whatever XLSX.utils.sheet_to_json produced) into import
 * rows + a problems list — every check the reference did, in the same order:
 * missing ids/names, gender, bad-looking dates, dead-before-born, duplicates,
 * parents pointing outside the file.
 */
export function parseSheet(
  rawRows: readonly RawCell[],
  translate: TranslateProblem,
): ParsedImport {
  const problems: string[] = [];
  const rows: Array<ImportRow | null> = rawRows.map((r, i) => {
    const o: Partial<Record<FieldName, string | null>> = {};
    for (const key of Object.keys(r)) {
      const field = COLUMN_MAP[norm(key)];
      if (!field) continue;
      let v: unknown = r[key];
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      o[field] = v == null || String(v).trim() === '' ? null : String(v).trim();
    }
    const legacy = o.legacy ?? null;
    if (!legacy) {
      problems.push(translate('admin.importNoName', { id: `#${i + 2}` }));
      return null;
    }
    const full_name = o.full_name ?? null;
    if (!full_name) {
      problems.push(translate('admin.importNoName', { id: legacy }));
      return null;
    }
    let gender = o.gender ?? null;
    if (gender && gender !== 'Male' && gender !== 'Female') {
      problems.push(translate('admin.importBadGender', { id: legacy, value: gender }));
      gender = null;
    }
    const dob_text = o.dob_text ?? null;
    const dod_text = o.dod_text ?? null;
    const dob = isoDate(dob_text);
    const dod = isoDate(dod_text);
    // "1970" and "1965 (approx)" are legitimate partial dates: they live on in
    // dob_text/dod_text. Only a value shaped like a full date that is not one
    // is worth showing the admin as a problem.
    if (dob_text && !dob && looksNumericDate(dob_text)) {
      problems.push(translate('admin.importBadDate', { id: legacy, value: dob_text }));
    }
    if (dod_text && !dod && looksNumericDate(dod_text)) {
      problems.push(translate('admin.importBadDate', { id: legacy, value: dod_text }));
    }
    if (dob && dod && dod < dob) {
      problems.push(translate('admin.importDodBeforeDob', { id: legacy }));
    }
    return {
      legacy,
      parent: o.parent ?? null,
      gender,
      full_name,
      nick_name: o.nick_name ?? null,
      fathers_name: o.fathers_name ?? null,
      mothers_name: o.mothers_name ?? null,
      spouse_name: o.spouse_name ?? null,
      spouse_father_name: o.spouse_father_name ?? null,
      dob,
      dob_text,
      place_of_birth: o.place_of_birth ?? null,
      qualification: o.qualification ?? null,
      dod,
      dod_text,
      place_of_burial: o.place_of_burial ?? null,
      name_ur: o.name_ur ?? null,
      name_hi: o.name_hi ?? null,
      source: o.source ?? null,
    };
  });

  const out = rows.filter(Boolean) as ImportRow[];

  const ids = new Map<string, number>();
  out.forEach((r) => ids.set(r.legacy, (ids.get(r.legacy) ?? 0) + 1));
  ids.forEach((n, id) => {
    if (n > 1) problems.push(translate('admin.importDup', { id, n }));
  });
  const known = new Set(out.map((r) => r.legacy));
  out.forEach((r) => {
    if (r.parent && !known.has(r.parent)) {
      problems.push(translate('admin.importBadParent', { id: r.legacy, parent: r.parent }));
      r.parent = null;
    }
  });

  return { rows: orderParentsFirst(out), problems };
}

/** Parents first (so inserts can point at their parent's new uuid), cycles cut. */
export function orderParentsFirst(rows: ImportRow[]): ImportRow[] {
  const byId = new Map(rows.map((r) => [r.legacy, r]));
  const out: ImportRow[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (r: ImportRow): void => {
    if (done.has(r.legacy)) return;
    if (visiting.has(r.legacy)) {
      r.parent = null;
      return;
    }
    visiting.add(r.legacy);
    const parent = r.parent ? byId.get(r.parent) : null;
    if (parent) visit(parent);
    visiting.delete(r.legacy);
    done.add(r.legacy);
    out.push(r);
  };
  rows.forEach(visit);
  return out;
}
