import type { EffectLabel, EffectSet } from './types.js';

/**
 * The closed, engine-versioned enumeration of effect labels, in canonical
 * (alphabetical) order. See `docs/EFFECTS-MODEL.md` for the metadata each
 * label declares.
 *
 * Adding a label is a visible minor-version event: an older engine parsing a
 * newer engine's type string hard-errors rather than silently weakening the
 * contract.
 */
export const EFFECT_LABELS: readonly EffectLabel[] = [
  'console',
  'entropy',
  'environment',
  'fs_read',
  'fs_write',
  'network',
  'random',
  'scope',
  'time',
];

const EFFECT_LABELS_SET = new Set<string>(EFFECT_LABELS);

export function isEffectLabel(s: string): s is EffectLabel {
  return EFFECT_LABELS_SET.has(s);
}

/**
 * The **impurity axis** of the label metadata (see "Label kinds — the metadata
 * axes" in `docs/EFFECTS-MODEL.md`): the labels that break referential
 * transparency. All nine current labels are impurities; a future non-impurity
 * label (e.g. `async`) is exactly why `pure` is "no impurity label present"
 * rather than "the effect set is empty".
 */
const IMPURITY_LABELS: ReadonlySet<string> = new Set<EffectLabel>([
  'console',
  'entropy',
  'environment',
  'fs_read',
  'fs_write',
  'network',
  'random',
  'scope',
  'time',
]);

/** True when `label` breaks referential transparency (the impurity axis). */
export function isImpurityLabel(label: EffectLabel): boolean {
  return IMPURITY_LABELS.has(label);
}

/**
 * True when an effect set contains **no impurity label** — the normative
 * definition of `pure`. NOT set-emptiness: see {@link isImpurityLabel}.
 *
 * `'any'` means "unknown effects" and is conservative here: not pure.
 */
export function isPureEffectSet(effects: EffectSet | undefined): boolean {
  if (effects === undefined) return true;
  if (effects === 'any') return false;
  return !effects.some((label) => IMPURITY_LABELS.has(label));
}

/**
 * True when `label` is **explicitly declared** in `effects`.
 *
 * `'any'` reports `false`: it means "unknown effects", and per the `any` ruling
 * under "Labels and lattice" (`docs/EFFECTS-MODEL.md`) conservatism inverts on
 * the frame axis — pinning a frame forever is the harm — so **frame
 * participation requires explicit declaration**. Unknown is *impure* (see
 * {@link isPureEffectSet}) yet *not* frame-relevant, which is exactly the
 * shipped `?? false` semantics of the pending-draw walk.
 */
export function hasDeclaredEffectLabel(
  effects: EffectSet | undefined,
  label: EffectLabel
): boolean {
  if (effects === undefined || effects === 'any') return false;
  return effects.includes(label);
}

/**
 * Normalize a collection of labels into the canonical {@link EffectSet}
 * representation: `undefined` for the empty set (≡ pure), `'any'` for the top,
 * and otherwise a de-duplicated, alphabetically sorted array.
 *
 * This is the only supported way to build an effect set: an empty array is
 * never a valid `effects` value, and "absent" and "empty" are the same state.
 *
 * The label enumeration is closed, so this **fails closed**: an unknown label
 * (or a value that is not `'any'` or a collection of labels) throws, matching
 * the parser's treatment of an unknown label in a type string. Silently
 * keeping an unknown label would classify the operator as pure — the exact
 * opposite of the intended contract.
 */
export function normalizeEffectSet(
  effects: EffectSet | Iterable<EffectLabel> | undefined
): EffectSet | undefined {
  if (effects === undefined) return undefined;
  if (effects === 'any') return 'any';
  if (
    typeof effects === 'string' ||
    typeof (effects as Iterable<EffectLabel> | null)?.[Symbol.iterator] !==
      'function'
  )
    throw new Error(
      `Invalid effect set \`${String(effects)}\`. Expected \`'any'\` or a collection of effect labels. The effect labels are ${EFFECT_LABELS.join(', ')}`
    );
  const labels = [...new Set(effects)].sort();
  for (const label of labels)
    if (!isEffectLabel(label))
      throw new Error(
        `Unknown effect label \`${label}\`. The effect labels are ${EFFECT_LABELS.join(', ')}`
      );
  return labels.length === 0 ? undefined : labels;
}

/**
 * True when `lhs` is a subset of `rhs` — the (covariant) order on effect sets.
 *
 * `undefined` is the empty set, below everything; `'any'` is the top, above
 * everything. Singleton labels are pairwise incomparable. Stateless: no
 * allocation, no memo, no mutation.
 */
export function isEffectSubset(
  lhs: EffectSet | undefined,
  rhs: EffectSet | undefined
): boolean {
  // ∅ ⊆ anything
  if (lhs === undefined) return true;
  // anything ⊆ any (the top absorbs)
  if (rhs === 'any') return true;
  // `any` is above every finite set, so it fits none of them
  if (lhs === 'any') return false;
  if (rhs === undefined) return false;
  return lhs.every((label) => rhs.includes(label));
}

/** True when two effect sets denote the same set (order-insensitive). */
export function sameEffectSet(
  a: EffectSet | undefined,
  b: EffectSet | undefined
): boolean {
  return isEffectSubset(a, b) && isEffectSubset(b, a);
}

/**
 * The union of two effect sets, in canonical form. `'any'` absorbs.
 *
 * (There is deliberately no intersection operation: nothing in the effects
 * model intersects effect sets — projection unions, discharge subtracts, and
 * subtyping subset-tests.)
 */
export function unionEffectSets(
  a: EffectSet | undefined,
  b: EffectSet | undefined
): EffectSet | undefined {
  if (a === undefined) return b === undefined ? undefined : b;
  if (b === undefined) return a;
  if (a === 'any' || b === 'any') return 'any';
  return normalizeEffectSet([...a, ...b]);
}

/**
 * The canonical serialization of an effect set: `any`, or the labels in
 * alphabetical order separated by single spaces. The empty set has no
 * spelling — it is written as an empty specifier slot, i.e. nothing at all.
 */
export function effectSetToString(effects: EffectSet): string {
  if (effects === 'any') return 'any';
  // Defensive sort: a hand-built signature may not have gone through
  // `normalizeEffectSet()`, and the serialized form is used as the structural
  // key for union de-duplication (`reduce.ts`).
  return [...effects].sort().join(' ');
}
