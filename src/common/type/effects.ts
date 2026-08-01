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
 *
 * `undefined` (unstated) and `[]` (stated pure) are the same set — see
 * {@link EffectSet} — so both report `true`.
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
 *
 * A **co-finite** value reports `false` for the same reason, and it is the
 * reason the parameter is widened to {@link ComputedEffects}: ¬D can only have
 * arisen from discharge-from-`any` — an *unknown* body — so `random ∈ ¬D`
 * whenever `random ∉ D` is a fact about the complement, never an explicit
 * declaration. Only an explicitly labelled set pins a frame.
 */
export function hasDeclaredEffectLabel(
  effects: ComputedEffects,
  label: EffectLabel
): boolean {
  if (effects === undefined || effects === 'any') return false;
  if (isCoFiniteEffects(effects)) return false;
  return effects.includes(label);
}

/** True when `effects` denotes the empty set — `undefined` (unstated) or the
 * stated-pure `[]`. The two are ONE set; only serialization tells them apart
 * (ruled 2026-08-01, see {@link EffectSet}). */
function isEmptyEffectSet(effects: EffectSet | undefined): boolean {
  return effects === undefined || (effects !== 'any' && effects.length === 0);
}

/**
 * Normalize a collection of labels into the canonical {@link EffectSet}
 * representation: `'any'` for the top, otherwise a de-duplicated,
 * alphabetically sorted array. The empty set collapses to `undefined`.
 *
 * This is the **inference** entry point: a computed effect set that turns out
 * empty is "unstated" (the bare arrow), never the stated-pure `[]`. For a
 * write that must PRESERVE an author's stated empty set, use
 * {@link normalizeStatedEffectSet}.
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
  return normalizeEffectSetCore(effects, false);
}

/**
 * {@link normalizeEffectSet} for a **stated** effect set: an empty collection
 * normalizes to `[]` — "explicitly pure" — rather than collapsing to
 * `undefined`. Semantically the same set; it differs only in that it
 * serializes as ` pure` (ruled 2026-08-01, see {@link EffectSet}).
 *
 * An `undefined` input still yields `undefined`: absent input states nothing.
 * Validation is identical, and equally fail-closed.
 */
export function normalizeStatedEffectSet(
  effects: EffectSet | Iterable<EffectLabel> | undefined
): EffectSet | undefined {
  return normalizeEffectSetCore(effects, true);
}

function normalizeEffectSetCore(
  effects: EffectSet | Iterable<EffectLabel> | undefined,
  keepEmpty: boolean
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
  if (labels.length > 0) return labels;
  return keepEmpty ? [] : undefined;
}

/**
 * True when `lhs` is a subset of `rhs` — the (covariant) order on effect sets.
 *
 * `undefined` (and the stated-pure `[]`, its serialization-distinct twin) is
 * the empty set, below everything; `'any'` is the top, above everything.
 * Singleton labels are pairwise incomparable. Stateless: no allocation, no
 * memo, no mutation.
 */
export function isEffectSubset(
  lhs: EffectSet | undefined,
  rhs: EffectSet | undefined
): boolean {
  // ∅ ⊆ anything — whether the empty set is spelled absent or `[]`
  if (isEmptyEffectSet(lhs)) return true;
  // anything ⊆ any (the top absorbs)
  if (rhs === 'any') return true;
  // `any` is above every finite set, so it fits none of them
  if (lhs === 'any') return false;
  // `lhs` is non-empty here, so no empty `rhs` can hold it
  if (isEmptyEffectSet(rhs)) return false;
  return (lhs as EffectLabel[]).every((label) =>
    (rhs as EffectLabel[]).includes(label)
  );
}

/**
 * True when two effect sets denote the same SET (order-insensitive).
 *
 * **Semantic**, not structural: `undefined` and the stated-pure `[]` are the
 * same set, so this reports `true` for the pair. The one place that needs the
 * spelling apart is {@link sameEffectSetSpelling}.
 */
export function sameEffectSet(
  a: EffectSet | undefined,
  b: EffectSet | undefined
): boolean {
  return isEffectSubset(a, b) && isEffectSubset(b, a);
}

/**
 * True when two effect sets have the same **spelling** — the serialization
 * distinction {@link sameEffectSet} deliberately ignores: `undefined` (an
 * empty specifier slot) and `[]` (` pure`) are the same set but not the same
 * text.
 *
 * Used where a rewrite must be performed for the spelling alone — installing a
 * stated-pure set onto a bare arrow so it serializes back as the author wrote
 * it (`_setEffects`, `boxed-operator-definition.ts`).
 */
export function sameEffectSetSpelling(
  a: EffectSet | undefined,
  b: EffectSet | undefined
): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a === 'any' || b === 'any') return a === b;
  return a.length === b.length && a.every((label, i) => b[i] === label);
}

/**
 * The union of two effect sets, in canonical form. `'any'` absorbs.
 *
 * Stated-ness survives: `[] ∪ [] = []` and `[] ∪ ∅ = []`, while
 * `[] ∪ {random} = {random}` — a union that acquires a label no longer needs
 * the empty-set spelling.
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
  return normalizeStatedEffectSet([...a, ...b]);
}

//
// ── Co-finite effect values — INTERNAL, COMPUTED, NEVER SERIALIZED ──────────
//
// `docs/EFFECTS-MODEL.md`, "Discharge from `any`": discharging `D` from the top
// yields `any − D`, the co-finite set ¬D — "every label, current and future,
// except those in `D`". It is admitted as an **internal computed value only**:
// never surface syntax (the reserved `!` stays unadmitted), never stored on an
// arrow (signatures are constants; application effects are computed), never
// serialized. Its payoff is that `WithRandomSeed(42, opaqueAnyBody)` computes
// ¬{random} — provably not-random, so the frame gate can release — where a
// stays-`any` rule would make discharge around any opaque body a no-op.
//

/**
 * The co-finite effect value ¬`not` (see the section comment above). The shape
 * cannot collide with {@link EffectSet}, which is the string `'any'` or an
 * array: this is a plain object with a `not` field.
 *
 * `not` is non-empty, canonical (de-duplicated, alphabetically sorted): ¬∅ is
 * `'any'`, and {@link coFiniteEffects} normalizes to it.
 */
export type CoFiniteEffectSet = { readonly not: readonly EffectLabel[] };

/**
 * The values the **runtime effect channel** computes (`effectsOf`): a finite
 * effect set, the top `'any'`, the empty set `undefined`, or an internal
 * co-finite value. Deliberately distinct from {@link EffectSet}, the
 * declarable/serializable type: nothing may store a co-finite value on a
 * signature or in a definition's `effects` field.
 */
export type ComputedEffects = EffectSet | CoFiniteEffectSet | undefined;

/** True when `effects` is the internal co-finite form. */
export function isCoFiniteEffects(
  effects: ComputedEffects
): effects is CoFiniteEffectSet {
  return (
    typeof effects === 'object' && effects !== null && !Array.isArray(effects)
  );
}

/**
 * The co-finite value ¬`not`, normalized: an empty complement is the top
 * `'any'` (¬∅ = every label).
 */
export function coFiniteEffects(
  not: Iterable<EffectLabel>
): EffectSet | CoFiniteEffectSet {
  const labels = normalizeEffectSet(not);
  if (labels === undefined) return 'any';
  if (labels === 'any')
    throw new Error('A co-finite complement cannot contain `any`');
  return { not: labels };
}

/**
 * `effects − discharge` — what an operator re-emits after absorbing the
 * `discharge` labels declared on an operand position.
 *
 * The only producer of co-finite values: `any − D = ¬D`. On a co-finite value
 * the complement grows (¬N − D = ¬(N ∪ D)); on a finite set it is plain set
 * difference; the empty set stays empty.
 */
export function subtractEffects(
  effects: ComputedEffects,
  discharge: readonly EffectLabel[] | undefined
): ComputedEffects {
  if (effects === undefined) return undefined;
  if (discharge === undefined || discharge.length === 0) return effects;
  if (effects === 'any') return coFiniteEffects(discharge);
  if (isCoFiniteEffects(effects))
    return coFiniteEffects([...effects.not, ...discharge]);
  return normalizeEffectSet(effects.filter((l) => !discharge.includes(l)));
}

/**
 * The union of two computed effect values. `'any'` absorbs; a co-finite value
 * absorbs a finite one by SHRINKING its complement (¬N ∪ F = ¬(N ∖ F)), and two
 * co-finite values intersect their complements (¬N₁ ∪ ¬N₂ = ¬(N₁ ∩ N₂)).
 */
export function unionComputedEffects(
  a: ComputedEffects,
  b: ComputedEffects
): ComputedEffects {
  if (a === 'any' || b === 'any') return 'any';
  const aCo = isCoFiniteEffects(a);
  const bCo = isCoFiniteEffects(b);
  if (!aCo && !bCo) return unionEffectSets(a, b);
  if (aCo && bCo)
    return coFiniteEffects(a.not.filter((l) => b.not.includes(l)));
  const co = (aCo ? a : b) as CoFiniteEffectSet;
  const finite = (aCo ? b : a) as EffectSet | undefined;
  if (finite === undefined) return co;
  return coFiniteEffects(co.not.filter((l) => !finite.includes(l)));
}

/**
 * `lhs ⊆ rhs` over computed effect values — the stateless comparison rules of
 * "Complement form" (`docs/EFFECTS-MODEL.md`, Subtyping):
 *
 * - finite ⊆ ¬N iff the positives avoid `N`;
 * - ¬N₁ ⊆ ¬N₂ iff `N₂ ⊆ N₁`;
 * - a co-finite value fits **no** finite set — it is version-open.
 */
export function isComputedEffectSubset(
  lhs: ComputedEffects,
  rhs: ComputedEffects
): boolean {
  if (lhs === undefined) return true;
  if (rhs === 'any') return true;
  if (isCoFiniteEffects(rhs)) {
    if (lhs === 'any') return false;
    if (isCoFiniteEffects(lhs))
      return rhs.not.every((l) => lhs.not.includes(l));
    return lhs.every((l) => !rhs.not.includes(l));
  }
  // `rhs` is finite (or empty): a version-open co-finite value never fits.
  if (isCoFiniteEffects(lhs)) return false;
  return isEffectSubset(lhs, rhs);
}

/**
 * **Mathematical** membership of `label` in a computed effect value: `'any'`
 * contains every label, ¬N contains every label not in `N`.
 *
 * NOT the frame-participation test — that one requires an EXPLICIT declaration,
 * see {@link hasDeclaredEffectLabel}.
 */
export function computedEffectsInclude(
  effects: ComputedEffects,
  label: EffectLabel
): boolean {
  if (effects === undefined) return false;
  if (effects === 'any') return true;
  if (isCoFiniteEffects(effects)) return !effects.not.includes(label);
  return effects.includes(label);
}

/**
 * True when a computed effect value contains **no impurity label** — the
 * runtime `isPure` view (`docs/EFFECTS-MODEL.md`, "Runtime counterpart").
 *
 * A co-finite value is never pure: every current label is an impurity, so ¬N
 * contains impurities unless `N` swallows all of them — and even then it is
 * version-open over labels not yet admitted. `'any'` is likewise not pure.
 */
export function isPureComputedEffects(effects: ComputedEffects): boolean {
  if (isCoFiniteEffects(effects)) return false;
  return isPureEffectSet(effects);
}

/**
 * The canonical serialization of an effect set: `any`, `pure` for the STATED
 * empty set (`[]`), or the labels in alphabetical order separated by single
 * spaces.
 *
 * The empty set has two spellings, and they are the same set (ruled
 * 2026-08-01, see {@link EffectSet}): an absent (`undefined`) effect set is an
 * empty specifier slot — nothing at all, and not this function's business —
 * while `[]` records that the author WROTE `pure` and round-trips as `pure`.
 */
export function effectSetToString(effects: EffectSet): string {
  if (effects === 'any') return 'any';
  if (effects.length === 0) return 'pure';
  // Defensive sort: a hand-built signature may not have gone through
  // `normalizeEffectSet()`, and the serialized form is used as the structural
  // key for union de-duplication (`reduce.ts`).
  return [...effects].sort().join(' ');
}
