/**
 * How are we related? (L1) — the reference `js/extras.js` relationship
 * walker as pure functions: walk both ancestor chains (the database's
 * `path` first, parent links as the fallback), find the nearest common
 * ancestor and name the kinship term the family actually uses
 * (chacha/taya/phupho/mamu/khala/bhatija… — dada vs nana decided by the
 * branch the chain travels through).
 *
 * Everything copy-related flows out through the translation callback, so
 * this module knows no language and no DOM.
 */
import type { MessageKey } from '../../core/i18n';
import { genderClass, type Person, type TreeModel } from '../tree/model';

/** Root-first ancestor chain of one person. */
export function chainOf(model: TreeModel, p: Person): Person[] {
  if (p.path.length) {
    const chain = p.path.map((id) => model.byId.get(id)).filter((x): x is Person => !!x);
    if (chain.length) return chain;
  }
  const out: Person[] = [];
  for (let c: Person | null = p; c; c = c.parent) out.unshift(c);
  return out;
}

export interface KinTerm {
  key: MessageKey;
  /** "approx" terms are honest fallbacks the chain cannot name precisely. */
  approx: boolean;
}

export type RelationSentence =
  | { key: 'extra.relatedBelow'; person: Person; n: number }
  | { key: 'extra.relatedThrough'; a: Person; up: number; b: Person; down: number };

export type RelationResult =
  | { kind: 'same' }
  | { kind: 'noPath' }
  | {
      kind: 'related';
      term: KinTerm;
      /** The nearest common ancestor everyone shares. */
      common: Person;
      /** A → common ancestor → B, spoken root-first-around-the-loop. */
      chain: Person[];
      sentence: RelationSentence;
    };

/** Kinship terms. The word is "what A (the first pick) calls B", so the
 * gender of the *target* and of the branch people decides which side of the
 * family is meant — what separates chacha from mamu. */
export function kinTerm(B: Person, up: number, down: number, ca: Person[], cb: Person[]): KinTerm {
  type PersonMaybe = Person | null | undefined;
  const sex = (p: PersonMaybe): 'Male' | 'Female' | 'Unknown' => {
    if (!p) return 'Unknown';
    const g = genderClass(p);
    return g === 'male' ? 'Male' : g === 'female' ? 'Female' : 'Unknown';
  };
  const branch = (chain: Person[]): 'male' | 'female' | 'unknown' => {
    // The common ancestor's child that leads towards the pick: the family
    // branch via which the other side is reached.
    const via = chain[chain.length - 2] ?? null;
    return via ? genderClass(via) : 'unknown';
  };

  // Direct line: one of them is an ancestor of the other.
  if (up === 0) {
    const s = sex(B);
    if (s === 'Unknown') return { key: 'kin.descendant', approx: true };
    if (down === 1) return { key: s === 'Male' ? 'kin.son' : 'kin.daughter', approx: false };
    if (down === 2) return { key: s === 'Male' ? 'kin.grandson' : 'kin.granddaughter', approx: false };
    if (down === 3) return { key: s === 'Male' ? 'kin.greatGrandson' : 'kin.greatGranddaughter', approx: false };
    return { key: 'kin.descendant', approx: true };
  }
  if (down === 0) {
    // B is an ancestor of A; the word is A's word for B, so it is B's own
    // gender that decides father vs mother. (The reference keyed this branch
    // on sex(A) — the picker's gender — which called a male ancestor
    // "grandmother" when a woman was picked first; this port keys the word on
    // the person being named, like every other branch here.)
    const s = sex(B);
    if (s === 'Unknown') return { key: 'kin.ancestor', approx: true };
    if (up === 1) return { key: s === 'Male' ? 'kin.father' : 'kin.mother', approx: false };
    if (up === 2) {
      // Paternal grandparents (dada/dadi) when the chain travels through the
      // father, maternal (nana/nani) when it travels through the mother.
      const paternal = branch(ca) === 'male';
      if (s === 'Male') {
        return { key: paternal ? 'kin.grandfatherPaternal' : 'kin.grandfatherMaternal', approx: false };
      }
      return { key: paternal ? 'kin.grandmotherPaternal' : 'kin.grandmotherMaternal', approx: false };
    }
    if (up === 3) return { key: s === 'Male' ? 'kin.greatGrandfather' : 'kin.greatGrandmother', approx: false };
    return { key: 'kin.ancestor', approx: true };
  }
  // Siblings.
  if (up === 1 && down === 1) {
    const s = sex(B);
    if (s === 'Unknown') return { key: 'kin.sibling', approx: true };
    return { key: s === 'Male' ? 'kin.brother' : 'kin.sister', approx: false };
  }
  // Uncle / aunt: B is a sibling of A's parent (or the mirror image).
  if (up === 2 && down === 1) {
    const s = sex(B);
    if (s === 'Unknown') return { key: 'kin.uncleAunt', approx: true };
    const side = branch(ca);
    if (side === 'male') return { key: s === 'Male' ? 'kin.fathersBrother' : 'kin.fathersSister', approx: false };
    if (side === 'female') return { key: s === 'Male' ? 'kin.mothersBrother' : 'kin.mothersSister', approx: false };
    return { key: 'kin.uncleAunt', approx: true };
  }
  if (down === 2 && up === 1) {
    const s = sex(B);
    if (s === 'Unknown') return { key: 'kin.nephewNiece', approx: true };
    const side = branch(cb);
    if (side === 'male') return { key: s === 'Male' ? 'kin.brotherSon' : 'kin.brotherDaughter', approx: false };
    if (side === 'female') return { key: s === 'Male' ? 'kin.sisterSon' : 'kin.sisterDaughter', approx: false };
    return { key: 'kin.nephewNiece', approx: true };
  }
  // Cousins.
  if (up === 2 && down === 2) {
    const s = sex(B);
    if (s === 'Unknown') return { key: 'kin.cousin', approx: true };
    return { key: s === 'Male' ? 'kin.cousinMale' : 'kin.cousinFemale', approx: false };
  }
  // Great-uncles / great-aunts and their mirror images; the chain points at
  // the gender, but the family wording stays an approximation.
  if (up === 3 && down === 1) {
    const s = sex(B);
    if (s === 'Unknown') return { key: 'kin.uncleAunt', approx: true };
    return { key: s === 'Male' ? 'kin.grandUncle' : 'kin.grandAunt', approx: true };
  }
  if (down === 3 && up === 1) {
    const s = sex(B);
    if (s === 'Unknown') return { key: 'kin.nephewNiece', approx: true };
    return { key: s === 'Male' ? 'kin.grandNephew' : 'kin.grandNiece', approx: true };
  }
  // Anything further away: the tree cannot name it reliably, so say so
  // plainly instead of inventing a term.
  return { key: 'kin.distant', approx: true };
}

export function computeRelation(
  model: TreeModel,
  aId: string | null,
  bId: string | null,
): RelationResult {
  if (!aId || !bId) return { kind: 'noPath' };
  const A = model.byId.get(aId);
  const B = model.byId.get(bId);
  if (!A || !B) return { kind: 'noPath' };
  if (A.id === B.id) return { kind: 'same' };

  const ca = chainOf(model, A);
  const cb = chainOf(model, B);
  // Nearest common ancestor = the last shared element.
  let i = 0;
  while (i < ca.length && i < cb.length && ca[i]!.id === cb[i]!.id) i += 1;
  if (i === 0) return { kind: 'noPath' };

  const common = ca[i - 1]!;
  const up = ca.length - 1 - (i - 1); // steps from A up to the common ancestor
  const down = cb.length - 1 - (i - 1); // steps from the ancestor down to B

  const term = kinTerm(B, up, down, ca, cb);
  // Read the path out loud in the order it is walked: A up to the common
  // ancestor, then down to B (any other order prints the sides interleaved).
  const chain = ca
    .slice(i)
    .reverse()
    .concat([common], cb.slice(i));

  const sentence: RelationSentence =
    up === 0
      ? { key: 'extra.relatedBelow', person: B, n: down }
      : down === 0
        ? { key: 'extra.relatedBelow', person: A, n: up }
        : { key: 'extra.relatedThrough', a: A, up, b: B, down };

  return { kind: 'related', term, common, chain, sentence };
}
