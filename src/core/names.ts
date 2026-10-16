/** Name helpers shared by the header avatar and (later) tree cards. */

/** Leading honorifics that should not become part of the initials. */
const HONORIFICS = /^(syed|syeda|mohammed|md|mohd)\s+/i;

/**
 * Two-letter initials for avatar chips. Ported from the reference:
 * honorifics are stripped first, then the first letters of the first two
 * remaining words are used ("Syed Mazharuddin Nahri" → "MN").
 */
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const words = name
    .replace(HONORIFICS, '')
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? '?';
  const second = words[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}
