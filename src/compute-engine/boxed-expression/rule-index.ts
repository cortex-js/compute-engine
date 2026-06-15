/**
 * Operator-indexed rule dispatch (docs/fungrim/FUNGRIM-PLAN-2-RULES.md §2.1, Feature A).
 *
 * This is an INTERNAL side table: the public `BoxedRuleSet` type is
 * unchanged. The index is keyed (via a `WeakMap`) on the identity of the
 * boxed `rules` array, so engine-cached rule sets (which produce a fresh
 * array on each cache invalidation) get one index build per cache
 * generation, with no extra invalidation plumbing.
 *
 * ## Soundness
 *
 * The index partitions rules into:
 * - `byHead`: rules whose match pattern has a literal, head-faithful
 *   operator — only tried when the subject expression's operator (or one of
 *   its cross-head compatible operators, see `HEAD_COMPAT`) selects that
 *   bucket;
 * - `alwaysTry`: rules that may apply to expressions of any shape.
 *
 * The classification must exactly mirror the cross-head special cases in
 * `match.ts`, otherwise the index could skip a rule that would have fired.
 * Each special case is annotated below with the `match.ts` location it
 * mirrors. Anything unclassifiable is conservatively `alwaysTry`.
 *
 * This module is a LEAF module: it imports only types from `global-types`
 * and the runtime type guards. Do not add imports that could create
 * circular dependencies.
 */

import type { BoxedRule, Expression, RuleStep } from '../global-types';
import { isFunction, isNumber } from './type-guards';

/** A rule paired with its position in the original rule array. */
export type OrdinalRule = { rule: BoxedRule; ordinal: number };

export interface RuleIndex {
  /** Rules whose match pattern has a literal, head-faithful operator,
   *  bucketed by that operator. Each bucket is in ascending ordinal order. */
  byHead: ReadonlyMap<string, ReadonlyArray<OrdinalRule>>;

  /** Functional rules, non-function-expression patterns, wildcard-headed
   *  patterns, and effective-variations rules with variant-capable
   *  arithmetic heads. In ascending ordinal order. */
  alwaysTry: ReadonlyArray<OrdinalRule>;

  /** `rules.length` at build time; staleness guard against in-place
   *  mutation of the rule array. */
  count: number;
}

/**
 * Pattern heads that `matchVariations()` (match.ts:333-440) can match across
 * heads — e.g. expression `x` matches pattern `Add(0, x)`. A rule with one of
 * these pattern heads and effective `useVariations` may match an expression
 * of *any* operator, so it must be `alwaysTry` in that case.
 *
 * - 'Negate'   — match.ts:353 (0 → -x)
 * - 'Add'      — match.ts:359 (x → 0+x; a-b → a+(-b))
 * - 'Subtract' — match.ts:372 (a → a-0; -a → 0-a)
 * - 'Multiply' — match.ts:385 (x → 1·x; -x → -1·x; x/a → (1/a)·x)
 * - 'Divide'   — match.ts:403 (x → x/1)
 * - 'Square'   — match.ts:409 (Power(x,2) → Square(x))
 * - 'Exp'      — match.ts:415 (Power(E,x) → Exp(x))
 * - 'Power'    — match.ts:421 (Square(x), Exp(x), x → Power(x,1))
 *
 * All other pattern heads return `null` from `matchVariations()`, i.e.
 * non-arithmetic heads are safely indexable even under variations.
 */
export const VARIANT_CAPABLE: ReadonlySet<string> = new Set([
  'Negate',
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Square',
  'Exp',
  'Power',
]);

/**
 * Cross-head special cases in `matchOnce()` that are ALWAYS active
 * (independent of `useVariations`): maps a subject expression's operator to
 * the additional pattern-head buckets that must be consulted.
 *
 * - expr `Multiply` → pattern `Divide` — match.ts:158-197
 *   (`Multiply(Rational(1,n), x)` matches `Divide` patterns)
 * - expr `Divide`   → pattern `Power`  — match.ts:199-218
 *   (`Divide(1, x)` matches `Power` patterns, i.e. x^-1)
 * - expr `Root`     → pattern `Power`  — match.ts:220-236
 *   (`Root(x, n)` matches `Power` patterns, i.e. x^(1/n))
 *
 * Plus, handled directly in `candidateRules()`: a number literal must
 * consult the `Divide` bucket — match.ts:142-156 (rational literals like
 * `3/2` match `Divide` patterns).
 *
 * Also mirrored in classification (not here): a pattern head starting with
 * `_` (wildcard operator) matches any function — match.ts:238-244 — so such
 * rules are `alwaysTry`.
 */
export const HEAD_COMPAT: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
  ['Multiply', ['Divide']],
  ['Divide', ['Power']],
  ['Root', ['Power']],
]);

/** Below this rule count, `getRuleIndex()` returns `undefined` and callers
 *  fall back to the plain linear scan (index overhead not worth it). */
export const DEFAULT_MIN_INDEX_SIZE = 8;

/** Memoized plain/variations indexes per boxed rule array. */
const indexCache = new WeakMap<
  ReadonlyArray<BoxedRule>,
  { count: number; plain?: RuleIndex; variations?: RuleIndex }
>();

/**
 * Get (build + memoize) the index for a boxed rule array.
 *
 * `variations` selects the classification used when the *call-level*
 * `options.useVariations` is `true` (rule-level `useVariations` is folded in
 * at build time for both indexes). Below `minSize` (default 8) returns
 * `undefined` and callers fall back to the linear scan.
 */
export function getRuleIndex(
  rules: ReadonlyArray<BoxedRule>,
  variations: boolean,
  minSize: number = DEFAULT_MIN_INDEX_SIZE
): RuleIndex | undefined {
  if (rules.length < minSize) return undefined;

  let entry = indexCache.get(rules);
  // The `count` guard protects against in-place mutation of the array
  // (engine-owned sets are rebuilt on invalidation, but user-constructed
  // `BoxedRuleSet` arrays could be pushed to).
  if (entry === undefined || entry.count !== rules.length) {
    entry = { count: rules.length };
    indexCache.set(rules, entry);
  }

  if (variations)
    return (entry.variations ??= buildIndex(rules, /* variations */ true));
  return (entry.plain ??= buildIndex(rules, /* variations */ false));
}

function buildIndex(
  rules: ReadonlyArray<BoxedRule>,
  variations: boolean
): RuleIndex {
  const byHead = new Map<string, OrdinalRule[]>();
  const alwaysTry: OrdinalRule[] = [];

  const addToBucket = (head: string, entry: OrdinalRule): void => {
    const bucket = byHead.get(head);
    if (bucket) bucket.push(entry);
    else byHead.set(head, [entry]);
  };

  for (let ordinal = 0; ordinal < rules.length; ordinal++) {
    const rule = rules[ordinal];
    const entry: OrdinalRule = { rule, ordinal };

    // 1. Explicit dispatch hint: the rule promises it can only apply to
    //    expressions with one of these operators.
    if (rule.operators !== undefined && rule.operators.length > 0) {
      for (const head of rule.operators) addToBucket(head, entry);
      continue;
    }

    const match = rule.match;

    // 2. Functional rule (no match pattern): may apply to any expression.
    if (match === undefined) {
      alwaysTry.push(entry);
      continue;
    }

    // 3. Non-function-expression pattern (symbol/number/string literal):
    //    symbol and number patterns also reach matchVariations()
    //    (match.ts:99-108, 119-128), so they are not head-indexable.
    if (!isFunction(match)) {
      alwaysTry.push(entry);
      continue;
    }

    const head = match.operator;

    // 4. Wildcard-headed pattern (`_f(...)`) matches any function
    //    (match.ts:238-244).
    if (head.startsWith('_')) {
      alwaysTry.push(entry);
      continue;
    }

    // 5. Effective-variations rule with a variant-capable arithmetic head:
    //    matchVariations() can match these across heads (match.ts:333-440).
    //    Effective useVariations mirrors applyRule():
    //    `rule.useVariations ?? options.useVariations ?? false`.
    const effectiveVariations = rule.useVariations ?? variations;
    if (effectiveVariations && VARIANT_CAPABLE.has(head)) {
      alwaysTry.push(entry);
      continue;
    }

    // 6. Head-faithful pattern: only tried for matching operators
    //    (and HEAD_COMPAT cross-heads).
    addToBucket(head, entry);
  }

  return { byHead, alwaysTry, count: rules.length };
}

/** First index in `bucket` whose ordinal is greater than `fromOrdinal`
 *  (buckets are in ascending ordinal order). */
function lowerBound(
  bucket: ReadonlyArray<OrdinalRule>,
  fromOrdinal: number
): number {
  let lo = 0;
  let hi = bucket.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bucket[mid].ordinal > fromOrdinal) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Candidate rules for `expr`, in original declaration order, with
 * ordinal > `fromOrdinal`.
 *
 * Implemented as an ordinal-merge of:
 * - `alwaysTry`,
 * - `byHead[expr.operator]`,
 * - the `HEAD_COMPAT[expr.operator]` buckets, and
 * - the `Divide` bucket when `expr` is a number literal (match.ts:142-156).
 *
 * A rule hinted with several `operators` may appear in more than one
 * consulted bucket; duplicates are removed during the merge (distinct rules
 * never share an ordinal).
 */
export function* candidateRules(
  index: RuleIndex,
  expr: Expression,
  fromOrdinal: number
): Generator<OrdinalRule> {
  const buckets: ReadonlyArray<OrdinalRule>[] = [];
  if (index.alwaysTry.length > 0) buckets.push(index.alwaysTry);

  const operator = expr.operator;
  const headBucket = index.byHead.get(operator);
  if (headBucket !== undefined) buckets.push(headBucket);

  const compat = HEAD_COMPAT.get(operator);
  if (compat !== undefined) {
    for (const head of compat) {
      const bucket = index.byHead.get(head);
      if (bucket !== undefined) buckets.push(bucket);
    }
  }

  // Number literals (rationals like 3/2) match 'Divide' patterns
  // (match.ts:142-156). Conservatively consult the bucket for every number
  // literal: over-inclusion is sound (the match itself filters).
  if (isNumber(expr)) {
    const bucket = index.byHead.get('Divide');
    if (bucket !== undefined) buckets.push(bucket);
  }

  // Ordinal-merge of the (sorted) buckets, deduplicating by ordinal.
  const pos = buckets.map((b) => lowerBound(b, fromOrdinal));
  let lastOrdinal = -1;
  for (;;) {
    let minBucket = -1;
    let minOrdinal = Infinity;
    for (let i = 0; i < buckets.length; i++) {
      if (pos[i] < buckets[i].length) {
        const ordinal = buckets[i][pos[i]].ordinal;
        if (ordinal < minOrdinal) {
          minOrdinal = ordinal;
          minBucket = i;
        }
      }
    }
    if (minBucket < 0) return;
    const entry = buckets[minBucket][pos[minBucket]++];
    if (entry.ordinal !== lastOrdinal) {
      lastOrdinal = entry.ordinal;
      yield entry;
    }
  }
}

// ---------------------------------------------------------------------------
// Per-head aggregated dispatch (ROADMAP item 5)
// ---------------------------------------------------------------------------
//
// The Fungrim loader registers each hot-head identity rule (Multiply, Add,
// Power, …) as a standalone FUNCTIONAL rule with a single-head `operators`
// hint and a self-contained pre-screen (fungrim/loader.ts `wrapHotHeadRule`).
// The M2 index above buckets these by head, but on a hot arithmetic node it
// still yields all ~60 of a head's functional rules INDIVIDUALLY, so
// `replace()` pays the per-rule `applyRule` body + candidate-merge + `stepOf`
// scaffolding ~60× per node — the residual cost above the unloaded baseline.
//
// `aggregateHotHeadDispatch` collapses each head's functional rules into ONE
// dispatcher rule whose body runs their pre-screens in a tight loop, paying
// the per-rule `applyRule`/candidate scaffolding ONCE per head per node
// instead of once per rule.
//
// SOUNDNESS — the dispatcher is observably equivalent to the sequence of
// functional rules it replaces, on the engine's simplification channel
// (`replace()` with `recursive: false`, `useVariations: false`, an empty
// incoming substitution, canonical replacement):
//
//  - It applies its inner rules FORWARD (declaration order), threading each
//    firing rule's canonical result into the next attempt. This mirrors
//    `replace()`'s mid-pass re-seed (after a rule at ordinal k fires, only
//    rules with ordinal > k are retried, against the new expression).
//  - It returns the LAST firing inner rule's own `RuleStep` (its `because` id
//    and `purpose`) with the net value — exactly what `simplify()` consumes
//    from a multi-rule `replace()` pass (`result.at(-1)`), so step
//    attribution and the `purpose` cost-gate are preserved.
//  - The per-rule `id` still surfaces in `because` (the dispatcher carries no
//    id of its own into steps), and the public `ce.simplificationRules` array
//    is untouched — only the engine's internal cached rule set is aggregated,
//    so the rule-count and per-rule-id contracts both hold.
//
// The one behavior NOT bit-reproduced is the relative firing order of two
// DIFFERENT-head functional rules on a single node in a single pass (only
// reachable via the cross-head Multiply→Divide / Divide→Power consultations,
// and only when both actually fire and their order changes the result). No
// snapshot pins it; the differential equivalence test guards against a real
// divergence.

/** A boxed rule the per-head dispatcher can fold: a functional rule with no
 *  match pattern, no top-level condition, no variations, and exactly one
 *  `operators` head — i.e. dispatch fully described by that head, with all
 *  matching/guard logic inside the `replace` function. `wrapHotHeadRule` is
 *  the only producer of this shape (no built-in simplification rule sets
 *  `operators`), so the structural test never folds a hand-written rule. */
function isFoldableHotHeadRule(rule: BoxedRule): boolean {
  return (
    rule.match === undefined &&
    typeof rule.replace === 'function' &&
    rule.condition === undefined &&
    rule.useVariations !== true &&
    rule.operators !== undefined &&
    rule.operators.length === 1
  );
}

/** The inner `replace` of a foldable rule: a self-contained pre-screen +
 *  match + guard + canonical-subs that returns a firing `RuleStep` or a
 *  non-step (`undefined`/`null`) when it does not apply. */
type HotHeadReplace = (
  expr: Expression,
  sub: Record<string, Expression>
) => RuleStep | Expression | undefined | null;

const EMPTY_SUB: Record<string, Expression> = {};

/** Build the single dispatcher rule for a head's foldable rules. */
function makeHeadDispatcher(
  head: string,
  inner: ReadonlyArray<BoxedRule>
): BoxedRule {
  const fns = inner.map((r) => r.replace as HotHeadReplace);
  const n = fns.length;

  const replace = (expr: Expression): RuleStep | undefined => {
    let current = expr;
    let last: RuleStep | undefined;
    for (let i = 0; i < n; i++) {
      const step = fns[i](current, EMPTY_SUB);
      // Foldable rules always return a RuleStep (with a `because`) or nothing;
      // a bare Expression is not part of `wrapHotHeadRule`'s contract.
      if (step !== undefined && step !== null && 'because' in (step as object)) {
        const ruleStep = step as RuleStep;
        current = ruleStep.value;
        last = ruleStep;
      }
    }
    // Invariant: when `last` is set, `last.value === current` (current only
    // advances together with `last`), so the last step already carries the
    // net value, `because`, and `purpose`.
    return last;
  };

  return {
    _tag: 'boxed-rule',
    match: undefined,
    replace,
    condition: undefined,
    operators: [head],
    id: `hot-head-dispatch:${head}`,
  };
}

/**
 * Collapse each hot head's foldable functional rules into a single per-head
 * dispatcher rule. Returns a new array; non-foldable rules and single-rule
 * heads keep their position and order. Each folded head's dispatcher takes
 * the array slot of that head's FIRST foldable rule, so any lower-ordinal
 * built-in or pattern rule of the same head still fires ahead of it.
 *
 * If nothing is foldable (or every head has a single foldable rule, where
 * folding saves no scaffolding), the input array is returned unchanged.
 */
export function aggregateHotHeadDispatch(
  rules: ReadonlyArray<BoxedRule>
): ReadonlyArray<BoxedRule> {
  // Group foldable rules by their single head, preserving array order.
  const groups = new Map<string, BoxedRule[]>();
  for (const rule of rules) {
    if (!isFoldableHotHeadRule(rule)) continue;
    const head = rule.operators![0];
    const g = groups.get(head);
    if (g) g.push(rule);
    else groups.set(head, [rule]);
  }

  // One dispatcher per head with at least two foldable rules (a single rule
  // has no per-rule scaffolding to amortize — leave it in place).
  const dispatcherFor = new Map<string, BoxedRule>();
  for (const [head, g] of groups)
    if (g.length >= 2) dispatcherFor.set(head, makeHeadDispatcher(head, g));

  if (dispatcherFor.size === 0) return rules;

  const emitted = new Set<string>();
  const out: BoxedRule[] = [];
  for (const rule of rules) {
    if (isFoldableHotHeadRule(rule)) {
      const head = rule.operators![0];
      const dispatcher = dispatcherFor.get(head);
      if (dispatcher !== undefined) {
        // First occurrence becomes the dispatcher; later ones are dropped.
        if (!emitted.has(head)) {
          emitted.add(head);
          out.push(dispatcher);
        }
        continue;
      }
      // Single-rule head: fall through and keep the rule as-is.
    }
    out.push(rule);
  }
  return out;
}
