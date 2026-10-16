import { parseDate } from '../../core/dates';
import type { MessageKey } from '../../core/i18n';
import {
  EDITABLE_COLUMNS,
  diffPayload,
  type EditableColumn,
  type PersonPatch,
  type PersonValues,
} from '../../data/people';
import type { Person } from './model';

/**
 * The person form's field list and every pure rule around it — ported from
 * the reference `js/personform.js`:
 *
 *   - `FORM_SECTIONS` is the on-screen layout AND the write whitelist;
 *   - `FIELD_LABELS` names a column in exactly one place, shared with the
 *     details panel, the table and the change history;
 *   - `valuesFromPerson` / `valuesForNewChild` turn the model back into form
 *     strings (the short model keys differ from the database columns — without
 *     the mapping a save would write blanks over the family's data);
 *   - `validateAndBuild` is the whole validation rule set (name required,
 *     gender required, death before birth, dates in the future) and returns
 *     the payload only when everything passes;
 *   - `restorePayloadFromAudit` turns one audit snapshot into the whitelisted
 *     update a "restore this version" click sends.
 */

export interface FormFieldDef {
  col: EditableColumn;
  key: MessageKey;
  type?: 'text' | 'select' | 'textarea' | 'date';
  required?: boolean;
  hint?: MessageKey;
  rtl?: boolean;
}

export interface FormSectionDef {
  key: 'names' | 'parents' | 'spouse' | 'life' | 'notes';
  title: MessageKey;
  fields: FormFieldDef[];
  /** The tree-parent control leads this section. */
  parentsBlock?: boolean;
  /** The photo picker closes this section. */
  photoBlock?: boolean;
}

/** Section order, field order and required flags — same as the reference. */
export const FORM_SECTIONS: readonly FormSectionDef[] = [
  {
    key: 'names',
    title: 'edit.section.names',
    fields: [
      { col: 'full_name', key: 'edit.fullName', type: 'text', required: true },
      { col: 'nick_name', key: 'edit.nickname' },
      { col: 'name_ur', key: 'edit.nameUr', rtl: true },
      { col: 'name_hi', key: 'edit.nameHi' },
      { col: 'gender', key: 'edit.gender', type: 'select', required: true },
    ],
  },
  {
    key: 'parents',
    title: 'edit.section.parents',
    parentsBlock: true,
    fields: [
      { col: 'fathers_name', key: 'edit.father' },
      { col: 'mothers_name', key: 'edit.mother' },
    ],
  },
  {
    key: 'spouse',
    title: 'edit.section.spouse',
    fields: [
      { col: 'spouse_name', key: 'edit.spouse' },
      { col: 'spouse_father_name', key: 'edit.spouseFather' },
    ],
  },
  {
    key: 'life',
    title: 'edit.section.life',
    fields: [
      { col: 'dob', key: 'edit.dob', type: 'date', hint: 'edit.dobHint' },
      { col: 'dob_text', key: 'edit.dobText', hint: 'edit.orType' },
      { col: 'place_of_birth', key: 'edit.pob' },
      { col: 'qualification', key: 'edit.qual' },
      { col: 'dod', key: 'edit.dod', type: 'date' },
      { col: 'dod_text', key: 'edit.dodText', hint: 'edit.orType' },
      { col: 'place_of_burial', key: 'edit.burial' },
    ],
  },
  {
    key: 'notes',
    title: 'edit.section.photo',
    photoBlock: true,
    fields: [{ col: 'notes', key: 'edit.notes', type: 'textarea' }],
  },
];

/** Flat field list in on-screen order (the reference `ALL_FIELDS`). */
export const FORM_FIELDS: readonly FormFieldDef[] = FORM_SECTIONS.flatMap((s) => s.fields);

/**
 * Column → translation key. The panel, the edit dialog, the table and the
 * change history all label their rows from here (reference `FIELD_LABELS`).
 */
export const FIELD_LABELS: Record<string, MessageKey> = {
  full_name: 'edit.fullName',
  nick_name: 'edit.nickname',
  name_ur: 'edit.nameUr',
  name_hi: 'edit.nameHi',
  gender: 'edit.gender',
  fathers_name: 'edit.father',
  mothers_name: 'edit.mother',
  spouse_name: 'edit.spouse',
  spouse_father_name: 'edit.spouseFather',
  dob: 'edit.dob',
  dob_text: 'edit.dobText',
  place_of_birth: 'edit.pob',
  qualification: 'edit.qual',
  dod: 'edit.dod',
  dod_text: 'edit.dodText',
  place_of_burial: 'edit.burial',
  notes: 'edit.notes',
  photo_path: 'table.col.photo',
  is_deleted: 'table.col.deleted',
  parent_id: 'edit.parentField',
  legacy_id: 'table.col.legacyId',
  source: 'table.col.source',
};

/** The form always holds every editable column as a string ('' = blank). */
export type FormValues = Record<EditableColumn, string>;

/** Database column → the shorter key the tree model uses. */
const MODEL_KEY: Record<string, keyof Person> = {
  full_name: 'name',
  nick_name: 'nick',
  fathers_name: 'father',
  mothers_name: 'mother',
  spouse_name: 'spouse',
  spouse_father_name: 'spouseFather',
  place_of_birth: 'pob',
  qualification: 'qual',
  place_of_burial: 'burial',
  // A date input only accepts YYYY-MM-DD; dob/dod in the model are shown DD/MM/YYYY.
  dob: 'dob_iso',
  dod: 'dod_iso',
};

/** Anything parseDate understands to YYYY-MM-DD, or ''. */
function isoOrEmpty(value: string | null | undefined): string {
  if (!value) return '';
  const d = parseDate(value);
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
}

/** Read one property as a non-empty string, or null. */
function pickString(person: Person, key: string): string | null {
  const value = (person as unknown as Record<string, unknown>)[key];
  return value == null || value === '' ? null : String(value);
}

/** A person (or nobody, when adding) → the values the form edits. */
export function valuesFromPerson(person: Person | null): FormValues {
  const values = {} as FormValues;
  for (const field of FORM_FIELDS) {
    const modelKey = MODEL_KEY[field.col];
    let raw: string | null = null;
    if (person) {
      // The model's short key first, the database column name as the fallback
      // (the reference's rule — without it the dialog opened with blank boxes).
      raw = modelKey
        ? (pickString(person, modelKey) ?? pickString(person, field.col))
        : pickString(person, field.col);
    }
    if (field.type === 'date') raw = raw ? (isoOrEmpty(raw) || null) : null;
    values[field.col] = raw ?? '';
  }
  if (values.gender !== 'Male' && values.gender !== 'Female') values.gender = '';
  return values;
}

/**
 * Defaults for a new child: the parent's own name and their spouse fill in
 * the father/mother boxes and stay editable (reference rule — including the
 * unknown-gender fallback).
 */
export function valuesForNewChild(parent: Person): FormValues {
  const values = valuesFromPerson(null);
  if (/^m/i.test(parent.gender ?? '')) {
    values.fathers_name = parent.name ?? '';
    values.mothers_name = parent.spouse ?? '';
  } else if (/^f/i.test(parent.gender ?? '')) {
    values.mothers_name = parent.name ?? '';
    values.fathers_name = parent.spouse ?? '';
  } else {
    values.fathers_name = parent.spouse ? '' : (parent.name ?? '');
    values.mothers_name = parent.spouse ?? '';
  }
  return values;
}

/* ------------------------------- validation ------------------------------- */

export interface FieldIssue {
  key: MessageKey;
  vars?: Record<string, string>;
}

export type ValidationResult =
  | { ok: true; payload: PersonValues }
  | { ok: false; issues: Partial<Record<EditableColumn, FieldIssue>>; firstBad: EditableColumn };

const blank = (value: string | null | undefined): boolean => value == null || String(value).trim() === '';

/** Midnight-UTC today, matching the reference's date-only comparisons. */
function todayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * Validate the form values and build the database payload in one pass.
 * Rule order matches the reference, so "the first bad field" is the same one.
 */
export function validateAndBuild(values: FormValues, now: Date = new Date()): ValidationResult {
  const issues: Partial<Record<EditableColumn, FieldIssue>> = {};
  const bad = (col: EditableColumn, issue: FieldIssue): void => {
    if (!issues[col]) issues[col] = issue;
  };

  if (blank(values.full_name)) bad('full_name', { key: 'edit.fullNameRequired' });
  if (values.gender !== 'Male' && values.gender !== 'Female') {
    bad('gender', { key: 'edit.genderRequired' });
  }

  const dob = values.dob ? parseDate(values.dob) : null;
  const dod = values.dod ? parseDate(values.dod) : null;
  if (values.dob && !dob) bad('dob', { key: 'edit.invalidDate', vars: { field: 'edit.dob' } });
  if (values.dod && !dod) bad('dod', { key: 'edit.invalidDate', vars: { field: 'edit.dod' } });
  const today = todayUtc(now);
  if (dob && dob.getTime() > today.getTime()) bad('dob', { key: 'edit.dobFuture' });
  if (dod && dod.getTime() > today.getTime()) bad('dod', { key: 'edit.dodFuture' });
  if (dob && dod && dod.getTime() < dob.getTime()) bad('dod', { key: 'edit.dodBeforeDob' });

  const order = FORM_FIELDS.map((f) => f.col);
  const firstBad = order.find((col) => issues[col]);
  if (firstBad) return { ok: false, issues, firstBad };

  const payload: PersonValues = {};
  for (const field of FORM_FIELDS) {
    const raw = values[field.col];
    if (field.type === 'date') {
      const d = raw ? parseDate(raw) : null;
      payload[field.col] = d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
    } else if (field.col === 'gender') {
      payload.gender = raw;
    } else {
      payload[field.col] = blank(raw) ? null : String(raw);
    }
  }
  return { ok: true, payload };
}

/* ------------------------- duplicate / history rules ------------------------ */

/** Same name (case-insensitive) under the same parent — warn, never block. */
export function findDuplicate(
  people: readonly Person[],
  fullName: string,
  parentId: string | null,
  excludeId: string | null,
): Person | null {
  const name = fullName.trim().toLowerCase();
  if (!name) return null;
  return (
    people.find(
      (p) =>
        p.id !== excludeId &&
        (p.name ?? '').trim().toLowerCase() === name &&
        (p.parentId || null) === (parentId || null),
    ) ?? null
  );
}

export interface FieldChange {
  col: string;
  labelKey: MessageKey;
  before: string;
  after: string;
}

/** Which labeled columns differ between two audit snapshots. */
export function fieldDiffs(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): FieldChange[] {
  const oldD = oldData ?? {};
  const newD = newData ?? {};
  const out: FieldChange[] = [];
  for (const [col, labelKey] of Object.entries(FIELD_LABELS)) {
    if (!(col in oldD) && !(col in newD)) continue;
    const before = oldD[col] == null ? '' : String(oldD[col]);
    const after = newD[col] == null ? '' : String(newD[col]);
    if (before === after) continue;
    out.push({ col, labelKey, before, after });
  }
  return out;
}

/**
 * Turn one audit `old_data` snapshot into the whitelisted update a
 * "restore this version" click sends. Only the form-ownable columns are
 * written; moving a person (parent_id) stays admin-only, exactly like a
 * normal edit.
 */
export function restorePayloadFromAudit(
  oldData: Record<string, unknown>,
  isAdmin: boolean,
): PersonPatch {
  const payload: PersonPatch = {};
  for (const col of EDITABLE_COLUMNS) {
    if (!(col in oldData)) continue;
    const value = oldData[col];
    if (col === 'dob' || col === 'dod') {
      payload[col] = value ? String(value).slice(0, 10) : null;
    } else {
      payload[col] = value == null ? null : String(value);
    }
  }
  if (isAdmin && Object.prototype.hasOwnProperty.call(oldData, 'parent_id')) {
    payload.parent_id = (oldData.parent_id as string | null) || null;
  }
  return payload;
}

/** Re-export so callers do not need both modules for the common diff. */
export { diffPayload };
