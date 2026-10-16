import type { Lang, PersonNameFields } from '../types';

/**
 * The name shown on screen for a person, given the active language.
 *
 * Urdu and Hindi spellings are used when the family supplied them; otherwise
 * the English name — the same rule as the reference app's `dispName()`, shared
 * here by the tree, detail panel, table and dialogs so every view agrees.
 */
export function getDisplayName(person: PersonNameFields | null | undefined, lang: Lang): string {
  if (!person) return '';
  if (lang === 'ur' && person.name_ur) return person.name_ur;
  if (lang === 'hi' && person.name_hi) return person.name_hi;
  return person.name ?? '';
}
