/** Languages the interface ships with. English is the fallback. */
export type Lang = 'en' | 'ur' | 'hi';

/** Name columns of a person row (localized spellings are optional). */
export interface PersonNameFields {
  name?: string | null;
  name_ur?: string | null;
  name_hi?: string | null;
}
