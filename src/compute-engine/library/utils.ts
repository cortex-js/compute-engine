import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types.js';

import {
  isNumber,
  isSymbol,
  isFunction,
} from '../boxed-expression/type-guards.js';
import { conditionalValue } from '../boxed-expression/conditional-value.js';
import { collectBinderNames } from '../boxed-expression/utils.js';
import { rewriteWithBinders } from '../boxed-expression/binders.js';
import { numericValueOf } from '../boxed-expression/numerics.js';

import { checkDeadline } from '../../common/interruptible.js';
import { isSubtype } from '../../common/type/subtype.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { MAX_ITERATION } from '../numerics/numeric.js';
import { extrapolate } from '../numerics/richardson.js';
import {
  reduceCollection,
  enumerationDeclinedAfterWalk,
} from './collections.js';
import { extractFiniteDomainWithReason } from './logic-analysis.js';
import { isTuple, isValuelessCollectionTyped } from '../collection-utils.js';

/**
 * Does the norm of this point BROADCAST — i.e. does a component carry a
 * collection that zips into one norm per element?
 *
 * `‖(x+[0.5, 1], y)‖` is one norm per element, so the honest type is
 * `list<number>`, not `number` (Tycho item 74: a `number`-typed expression
 * evaluating to a `List` breaks consumers that dispatch on the declared type).
 *
 * A tuple-typed component is NOT a broadcasting collection (tuples are indexed
 * collections in the type lattice but bind atomically): the norm of
 * `((3,4), 12)` takes the inner point's norm and stays scalar.
 *
 * A non-literal point (a tuple-TYPED symbol or parameter) has no operands to
 * walk — its declared element types are inspected instead, so
 * `p: tuple<list<real>, real>` reports the same broadcast its evaluation
 * produces.
 */
export function pointNormBroadcasts(point: Expression): boolean {
  if (isFunction(point))
    return point.ops.some(
      (op) => op.type.matches('indexed_collection<any>') && !isTuple(op)
    );
  const t = point.type.type;
  return (
    typeof t !== 'string' &&
    t.kind === 'tuple' &&
    t.elements.some((el) => {
      const et = el.type;
      if (typeof et !== 'string' && et.kind === 'tuple') return false;
      return isSubtype(et, INDEXED_COLLECTION_SHAPE_TYPE);
    })
  );
}

/**
 * The result type of a Euclidean norm/distance over `components` — the scalar
 * `√(Σ|xᵢ|²)`.
 *
 * **A norm is REAL whatever its components are**: `|z|²` is real for a complex
 * `z`, so `‖(3+4i, 0)‖ = 5`. Claiming the wide `number` (which includes
 * complex) instead is not merely imprecise — it is refused by every
 * `real`-declared slot in the library, so `Hypot(‖p‖, ‖q‖)` reported
 * `incompatible-type('real', 'number')` on a value real by construction.
 *
 * The two demotions follow the convention `absFunctionType` sets for the same
 * question one operand down:
 *
 * - a **provably NaN** component makes the norm NaN, which is not `real` —
 *   and only a literal can prove NaN, so a merely-unknown component does not
 *   demote (`Abs(x)` with `x: number` is `real` for the same reason);
 * - a **provably non-finite** component (`isFinite === false`) keeps the wide
 *   `number`, matching what `Hypot`'s own handler already answers for that
 *   case.
 *
 * A component that is not provably numeric at all — a matrix ROW, a string, an
 * `unknown`-typed element — keeps `number` too, ahead of both: those have no
 * norm for this claim to be about.
 *
 * `finite_real` is claimed only when EVERY component is provably finite. No
 * narrower tier is: unlike `|·|` of a scalar, a norm does not preserve the
 * integer or rational tier — `‖(1, 1)‖ = √2`.
 */
export function euclideanNormType(
  components: ReadonlyArray<Expression>
): string {
  if (components.length === 0) return 'number';
  // Every component must be provably numeric for "the norm is real" to be a
  // claim about anything: a `Norm` operand is declared `value`, so a string or
  // an `unknown`-typed element can stand here, and those have no norm to type.
  if (!components.every((c) => c.type.matches('number'))) return 'number';
  if (components.some((c) => isNumber(c) && c.isNaN)) return 'number';
  if (components.some((c) => c.isFinite === false)) return 'number';
  return components.every((c) => c.isFinite === true) ? 'finite_real' : 'real';
}

/**
 * Result type of the Euclidean norm of a fixed-arity point (`Tuple` operand of
 * `Norm`/`Abs`): the scalar norm type, unless the point broadcasts.
 */
export function pointNormType(point: Expression): string {
  if (pointNormBroadcasts(point)) return 'list<number>';
  // Only a literal point exposes the components the scalar claim is derived
  // from; a tuple-TYPED symbol keeps the wide `number`.
  if (!isFunction(point)) return 'number';
  return euclideanNormType(point.ops);
}

/**
 * EL-4: Convert known infinite integer sets to their equivalent Limits bounds.
 * Returns undefined if the set cannot be converted to a Limits form.
 *
 * Mappings:
 * - NonNegativeIntegers (ℕ₀) → [0, ∞)
 * - PositiveIntegers (ℤ⁺) → [1, ∞)
 * - NegativeIntegers (ℤ⁻) → Not supported (would need negative direction)
 * - Integers (ℤ) → Not supported (bidirectional)
 * - Other sets (Reals, Complexes, etc.) → Not supported (non-integer)
 */
export function convertInfiniteSetToLimits(
  domainSymbol: string
): { lower: number; upper: number; isFinite: false } | undefined {
  switch (domainSymbol) {
    case 'NonNegativeIntegers':
      // ℕ₀ = {0, 1, 2, 3, ...}
      return { lower: 0, upper: MAX_ITERATION, isFinite: false };
    case 'PositiveIntegers':
      // ℤ⁺ = {1, 2, 3, ...}
      return { lower: 1, upper: 1 + MAX_ITERATION, isFinite: false };
    default:
      // NegativeIntegers, Integers, Reals, Complexes, etc. cannot be
      // converted to a simple forward iteration
      return undefined;
  }
}

/**
 * EL-4 (revised): Classify a big-op (`Sum`/`Product`) domain.
 *
 * An infinite integer domain — `n ∈ ℤ⁺`, `n ∈ ℕ₀`, or a `Limits` range with an
 * infinite bound — is iterated up to `MAX_ITERATION` terms, so its value is only
 * a *truncated numeric approximation*, never a closed form. Per the exactness
 * contract, exact `evaluate()` therefore stays symbolic on ANY non-finite
 * domain; only `.N()` (`numericApproximation`) may truncate-iterate, and only
 * when the body is numeric.
 *
 * Returns:
 *   - `'finite'`   — enumerable exactly; evaluate normally under either mode.
 *   - `'numeric'`  — infinite domain with a numeric body: exact evaluate stays
 *                    symbolic; `.N()` accumulates floats (honest about the
 *                    truncation).
 *   - `'symbolic'` — never enumerable, under either mode: a free (symbolic)
 *                    bound (e.g. `Σ_{k=1}^{n}`), or a body with free variables
 *                    beyond the index (e.g. `Σ xⁿ` over ℤ⁺), where a truncated
 *                    partial value would be meaningless.
 */
/**
 * The machine value of a big-operator bound (`Limits`' lower/upper operand).
 *
 * A bound is consumed as a machine number in three places — `symbolicBound`
 * below, `normalizeIndexingSet`, and the compiler's loop lowering — all of
 * which read `.re` on the bound AS WRITTEN. That reads `NaN` for an
 * unevaluated function expression, so `Σ_{j=1}^{Length(P)} P[j]` classified as
 * a symbolic domain and the whole operator stayed inert, even though
 * `Length(P)` on its own evaluates to a number (Tycho item 125 — a common
 * Desmos spelling; `length(P)`, `count(P)` and the dot form `P.length` all
 * parse to this same `Length` node, so they are one bug, not three).
 *
 * Only a CLOSED bound is evaluated — one with no free symbols. A genuinely
 * free bound (`n` in `Σ_{k=1}^{n}`) keeps reading `NaN` and so keeps
 * classifying as symbolic: that is the guard which stops `Sum(k, [k, 1, n])`
 * from being read as if `n` were the default iteration window (→ 50015001).
 *
 * Only a PURE bound is evaluated. Closed does not imply safe to evaluate
 * repeatedly: this is consulted once by classification and again by
 * normalization (and normalization runs again to drive the reduction), so an
 * effectful bound would be re-drawn each time and could classify against one
 * trip count and iterate another. An impure bound keeps reading `NaN` and
 * stays symbolic, which is what it already did before closed bounds were
 * evaluated at all.
 *
 * Deliberately at evaluate time, never at canonicalization: `Length(P)` must
 * see the value `P` holds when the operator RUNS, not when it was parsed.
 */
export function bigopBoundValue(bound: Expression): number {
  // A bound with a NONZERO imaginary part has no iteration count. Reading its
  // real part alone silently drops the imaginary part, and for the imaginary
  // unit that real part is `0` — so `Σ_{n=1}^{i} n` folded to an empty range
  // and answered `0` instead of staying symbolic.
  if (hasNonZeroImaginaryPart(bound)) return NaN;
  const r = bound.re;
  if (!Number.isNaN(r)) return r;
  // A free symbol (or an expression over one) has no value to read.
  if (bound.unknowns.length > 0) return r;
  if (!bound.isPure) return r;
  const value = bound.evaluate({ numericApproximation: true });
  if (hasNonZeroImaginaryPart(value)) return NaN;
  return value.re;
}

/** Whether `expr` has a KNOWN imaginary part that is not zero. */
function hasNonZeroImaginaryPart(expr: Expression): boolean {
  const im = expr.im;
  return !Number.isNaN(im) && im !== 0;
}

export function classifyBigopDomain(
  body: Expression | undefined,
  indexes: ReadonlyArray<Expression>,
  ce: ComputeEngine
): 'finite' | 'numeric' | 'symbolic' {
  let infinite = false;
  const indexNames = new Set<string>();

  for (const idx of indexes) {
    if (!isFunction(idx)) continue;
    const indexSym = isSymbol(idx.op1) ? idx.op1.symbol : undefined;
    if (indexSym !== undefined) indexNames.add(indexSym);

    if (idx.operator === 'Element') {
      // Only ℕ₀ / ℤ⁺ are converted to a forward iteration (see
      // `convertInfiniteSetToLimits`); other infinite sets stay symbolic on
      // their own, so they don't need the numeric treatment here.
      const r = extractFiniteDomainWithReason(idx, ce);
      if (
        r.status === 'non-enumerable' &&
        r.reason === 'infinite-domain' &&
        r.domain &&
        isSymbol(r.domain) &&
        convertInfiniteSetToLimits(r.domain.symbol)
      )
        infinite = true;
    } else if (idx.operator === 'Limits') {
      // A bound that is neither numeric nor ±∞/`Nothing` — e.g. an unbound
      // symbol `n`, or `n − 1` — cannot be enumerated: the domain is
      // symbolic. Without this check `normalizeIndexingSet` silently
      // substitutes its default iteration window for the unusable bound, so
      // `Sum(k, [k, 1, n])` evaluated as if `n` were 10001 (→ 50015001).
      const symbolicBound = (b: Expression) =>
        !(isSymbol(b) && b.symbol === 'Nothing') &&
        Number.isNaN(bigopBoundValue(b));
      if (symbolicBound(idx.op2) || symbolicBound(idx.op3)) return 'symbolic';
      if (!normalizeIndexingSet(idx).isFinite) infinite = true;
    }
  }

  if (!infinite) return 'finite';

  // The body is numeric iff its only free variables are the index variables.
  // (`unknowns` already excludes constants like `Pi` and any name bound to a
  // value, and function heads are not counted as free variables.)
  const numericBody = (body?.unknowns ?? []).every((s) => indexNames.has(s));
  return numericBody ? 'numeric' : 'symbolic';
}

/**
 * Shift a body's index `k → k + 1`, returning the substituted expression.
 */
function shiftIndex(
  expr: Expression,
  index: string,
  ce: ComputeEngine
): Expression {
  return expr.subs({ [index]: ce.box(['Add', index, 1]) });
}

/**
 * Decompose a telescoping body `Add(a, b)` (exactly two terms, exactly one a
 * `Negate`) into its positive and negative parts and the orientation:
 *   - forward: body = t(k+1) − t(k)  (with `t = neg`), sums to t(b+1) − t(a)
 *   - mirror:  body = t(k) − t(k+1)  (with `t = pos`), sums to t(a) − t(b+1)
 * Both parts must depend on the index. Returns undefined if the body is not a
 * `k → k+1` shift pair.
 */
function telescopingParts(
  body: Expression,
  index: string,
  ce: ComputeEngine
): { pos: Expression; neg: Expression; forward: boolean } | undefined {
  if (!isFunction(body, 'Add') || body.ops.length !== 2) return undefined;

  let pos: Expression | undefined;
  let neg: Expression | undefined;
  for (const t of body.ops) {
    if (isFunction(t, 'Negate')) {
      if (neg) return undefined; // two negated terms → not a telescoping pair
      neg = t.op1;
    } else {
      if (pos) return undefined;
      pos = t;
    }
  }
  if (!pos || !neg) return undefined;

  // Both parts must reference the index (guards against degenerate matches).
  if (!new Set(pos.unknowns).has(index)) return undefined;
  if (!new Set(neg.unknowns).has(index)) return undefined;

  // forward: neg shifted by k→k+1 equals pos  ⇒ body = neg(k+1) − neg(k)
  if (shiftIndex(neg, index, ce).isSame(pos))
    return { pos, neg, forward: true };
  // mirror: pos shifted by k→k+1 equals neg  ⇒ body = pos(k) − pos(k+1)
  if (shiftIndex(pos, index, ce).isSame(neg))
    return { pos, neg, forward: false };

  return undefined;
}

/**
 * Strictly SYNTACTIC equality of two big-op bounds: same operator and operand
 * shape, symbols compared by NAME, number literals by value. Unlike `isSame`
 * it never dereferences a symbol's assigned value.
 *
 * That distinction is load-bearing at canonicalization: `isSame` follows a
 * symbol's value when comparing a symbol against a non-symbol, so with
 * `a := 5` it reports `Σ_{i=a}^{5}` degenerate and the fold is baked into the
 * canonical form PERMANENTLY — a later `a := 3` cannot undo it. Canonical form
 * must not depend on the values symbols happen to hold.
 *
 * Anything that is not a symbol, number literal or function expression
 * compares false (conservative: "not provably the same point").
 */
function sameBoundStructure(a: Expression, b: Expression): boolean {
  if (a === b) return true;
  if (isSymbol(a) || isSymbol(b))
    return isSymbol(a) && isSymbol(b) && a.symbol === b.symbol;
  if (isNumber(a) || isNumber(b))
    return isNumber(a) && isNumber(b) && a.isSame(b);
  if (isFunction(a) && isFunction(b))
    return (
      a.operator === b.operator &&
      a.nops === b.nops &&
      a.ops.every((op, i) => sameBoundStructure(op, b.ops[i]))
    );
  return false;
}

/**
 * A big operator is DEGENERATE when its lower and upper bounds are the same
 * point (`Σ_{i=a}^{a}`): the domain is the single point `i = a`, so the
 * operator has exactly one term — no enumeration required, even when `a` is
 * symbolic.
 *
 * `structural` selects how "the same" is decided, and the two callers differ:
 *   - canonicalization (`isVacuousIndexingSet`) passes `true` and gets the
 *     purely syntactic `sameBoundStructure` — a canonical form may not depend
 *     on the values symbols currently hold;
 *   - evaluation (`degenerateBigOpTerm`) passes `false` and gets `isSame`,
 *     which follows those values: reading them is exactly what evaluate does.
 *
 * Declines when the bound is not provably a point: `±∞` and `NaN` bounds keep
 * whatever behavior they already had (`Σ_{i=∞}^{∞}` is an infinite-domain
 * question, not a one-term one). An invalid bound (an error expression) is not
 * a point either. Neither is an IMPURE one: two occurrences of
 * `RandomInteger(1, 6)` look alike but are independent draws, so a
 * same-spelling test would read two different endpoints as one. A FREE bound
 * (`d`) IS treated as a point, consistent with the engine's other
 * generic-symbol folds (`x/x → 1`).
 */
function isDegenerateBounds(
  lower: Expression | undefined,
  upper: Expression | undefined,
  structural: boolean
): boolean {
  if (!lower || !upper) return false;
  if (lower.isNaN === true || upper.isNaN === true) return false;
  if (lower.isInfinity === true || upper.isInfinity === true) return false;
  if (!lower.isValid || !upper.isValid) return false;
  if (!lower.isPure || !upper.isPure) return false;
  return structural ? sameBoundStructure(lower, upper) : lower.isSame(upper);
}

/**
 * `degenerateBigOpTerm` recognized a degenerate operator but declined its
 * one-term substitution as capture-unsafe.
 *
 * Distinct from `undefined` ("not degenerate, carry on") because the callers'
 * next move is the symbolic closed forms, and those substitute the bound for
 * the index with NO capture guard of their own
 * (`symbolicSumClosedForm`/`symbolicProductClosedForm`). Falling through would
 * land exactly the corruption the decline exists to prevent, so on this
 * sentinel the caller must keep the expression symbolic.
 */
export const DEGENERATE_CAPTURE_UNSAFE = Symbol('degenerate-capture-unsafe');

/**
 * Reduce a degenerate big operator (`Σ_{i=a}^{a} f(i)`, `Π_{i=a}^{a} f(i)`) to
 * its single term `f(a)`, for a bound `a` the domain classifier could not
 * enumerate (a free symbol, e.g. `Σ_{i=x}^{x} i² = x²`). One point needs no
 * enumeration, so this runs ahead of the closed-form attempts on the
 * `'symbolic'` path.
 *
 * The index is substituted rather than ASSIGNED (as the numeric iteration in
 * `reduceBigOp` does): the index is declared `integer` by
 * `indexingSetSites(1, 'integer')`, so `ce.assign(i, x)` for a bound of
 * unknown type throws `TypeCompatibilityError` — a symbolic bound is exactly
 * the case that cannot go through the assign. The neighbouring symbolic
 * closed forms substitute for the same reason. `subs` is not binder-aware, so
 * the substitution is guarded against capture the way lambda inlining is
 * (`collectBinderNames`): if any binder inside the body could capture the
 * index or a symbol of the bound, decline and stay symbolic.
 *
 * Returns undefined (caller carries on) when the indexing set is not a
 * degenerate `Limits`, and `DEGENERATE_CAPTURE_UNSAFE` when it IS degenerate
 * but the substitution would not be capture-safe — see that sentinel for why
 * the two outcomes cannot share a return value.
 */
export function degenerateBigOpTerm(
  body: Expression | undefined,
  limits: Expression,
  numericApproximation: boolean | undefined
): Expression | typeof DEGENERATE_CAPTURE_UNSAFE | undefined {
  if (!body || !isFunction(limits, 'Limits') || limits.ops.length < 3)
    return undefined;
  const index = isSymbol(limits.op1) ? limits.op1.symbol : undefined;
  if (index === undefined) return undefined;
  const lower = limits.op2;
  if (!isDegenerateBounds(lower, limits.op3, false)) return undefined;

  // An index-less bounds pair (`Limits(Nothing, a, a)`) has no index to
  // substitute: its body is already the single term. Reached on the
  // STRUCTURAL route (`ce.function('Sum', …, { form: 'structural' })`), which
  // bypasses `canonicalBigop` — and so its dropping of vacuous indexing sets.
  if (index === 'Nothing') return body.evaluate({ numericApproximation });

  const binders = collectBinderNames(body);
  if (binders.size > 0) {
    if (binders.has(index)) return DEGENERATE_CAPTURE_UNSAFE;
    for (const s of lower.symbols)
      if (binders.has(s)) return DEGENERATE_CAPTURE_UNSAFE;
  }

  return body.subs({ [index]: lower }).evaluate({ numericApproximation });
}

/**
 * Attempt a symbolic closed form for `Sum(body, [index, lower, upper])` when the
 * domain is symbolic (free bounds or a body with free variables beyond the
 * index). Handles:
 *   - telescoping sums `Σ_{k=a}^{b} (g(k+1) − g(k)) = g(b+1) − g(a)` (and the
 *     mirror orientation);
 *   - the geometric series `Σ_{k=n₀}^∞ c·rᵏ` in a free ratio `r` (infinite upper
 *     bound), emitting `When(c·r^{n₀}/(1 − r), |r| < 1)`.
 * Returns undefined when no closed form applies (caller keeps it symbolic).
 */
export function symbolicSumClosedForm(
  body: Expression | undefined,
  limits: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (!body || !isFunction(limits, 'Limits')) return undefined;
  const index = isSymbol(limits.op1) ? limits.op1.symbol : undefined;
  const lower = limits.op2;
  const upper = limits.op3;
  if (!index || !lower || !upper) return undefined;

  // Geometric series `Σ_{k=n₀}^∞ c·rᵏ` in a free ratio (infinite upper
  // bound), and the named families that admit a free variable (exponential
  // `Σ xᵏ/k!`, first-moment `Σ k·xᵏ`, logarithmic `Σ xᵏ/k`).
  if (upper.isInfinity === true && upper.isPositive === true) {
    const geo =
      geometricSumClosedForm(body, index, lower, ce) ??
      namedSeriesClosedForm(body, index, lower, ce);
    if (geo) return geo;
  }

  const tele = telescopingParts(body, index, ce);
  if (tele) {
    const { pos, neg, forward } = tele;
    // Build a structural `Subtract` so the closed form stays readable
    // (`g(b+1) − g(a)`) instead of folding to `Add(g(b+1), Negate(g(a)))`.
    if (forward) {
      // Σ (t(k+1) − t(k)) = t(b+1) − t(a), where t = neg (so pos = t(k+1)).
      return ce.function(
        'Subtract',
        [pos.subs({ [index]: upper }), neg.subs({ [index]: lower })],
        { form: 'structural' }
      );
    }
    // Σ (t(k) − t(k+1)) = t(a) − t(b+1), where t = pos (so neg = t(k+1)).
    return ce.function(
      'Subtract',
      [pos.subs({ [index]: lower }), neg.subs({ [index]: upper })],
      { form: 'structural' }
    );
  }

  return undefined;
}

/**
 * Combine an expression into a single fraction `{ num, den }` without simplifying
 * (safe to call from evaluate). Handles `Divide`, `Negate`, `Add`, `Multiply`;
 * any other expression is returned as `expr / 1`.
 */
function asSingleFraction(
  expr: Expression,
  ce: ComputeEngine
): { num: Expression; den: Expression } {
  if (isFunction(expr, 'Divide')) return { num: expr.op1, den: expr.op2 };

  if (isFunction(expr, 'Negate')) {
    const f = asSingleFraction(expr.op1, ce);
    return { num: ce.function('Negate', [f.num]), den: f.den };
  }

  if (isFunction(expr, 'Add')) {
    let acc: { num: Expression; den: Expression } | undefined;
    for (const t of expr.ops) {
      const f = asSingleFraction(t, ce);
      if (!acc) acc = f;
      else {
        // n1/d1 + n2/d2 = (n1·d2 + n2·d1)/(d1·d2)
        acc = {
          num: ce.function('Add', [
            ce.function('Multiply', [acc.num, f.den]),
            ce.function('Multiply', [f.num, acc.den]),
          ]),
          den: ce.function('Multiply', [acc.den, f.den]),
        };
      }
    }
    if (acc) return acc;
  }

  if (isFunction(expr, 'Multiply')) {
    let num: Expression = ce.One;
    let den: Expression = ce.One;
    for (const t of expr.ops) {
      const f = asSingleFraction(t, ce);
      num = ce.function('Multiply', [num, f.num]);
      den = ce.function('Multiply', [den, f.den]);
    }
    return { num, den };
  }

  return { num: expr, den: ce.One };
}

/**
 * Attempt a symbolic closed form for `Product(body, [index, lower, upper])` when
 * the domain is symbolic (free bounds). Handles:
 *   - Π_{k=1}^{n} k = n!
 *   - telescoping products: Π_{k=a}^{b} h(k+1)/h(k) = h(b+1)/h(a)
 *     (and the mirror orientation Π h(k)/h(k+1) = h(a)/h(b+1)).
 * Returns undefined when no closed form applies (caller keeps it symbolic).
 */
export function symbolicProductClosedForm(
  body: Expression | undefined,
  limits: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (!body || !isFunction(limits, 'Limits')) return undefined;
  const index = isSymbol(limits.op1) ? limits.op1.symbol : undefined;
  const lower = limits.op2;
  const upper = limits.op3;
  if (!index || !lower || !upper) return undefined;

  // Π_{k=1}^{n} k = n!  (bare index, lower bound 1).
  if (isSymbol(body) && body.symbol === index && lower.isSame(1))
    return ce.function('Factorial', [upper]);

  // Telescoping product: body = h(k+1)/h(k).
  const { num, den } = asSingleFraction(body, ce);
  if (new Set(num.unknowns).has(index) && new Set(den.unknowns).has(index)) {
    // forward: den shifted by k→k+1 equals num ⇒ body = h(k+1)/h(k), h = den.
    if (shiftIndex(den, index, ce).isSame(num))
      return ce.function('Divide', [
        num.subs({ [index]: upper }),
        den.subs({ [index]: lower }),
      ]);
    // mirror: num shifted by k→k+1 equals den ⇒ body = h(k)/h(k+1), h = num.
    if (shiftIndex(num, index, ce).isSame(den))
      return ce.function('Divide', [
        num.subs({ [index]: lower }),
        den.subs({ [index]: upper }),
      ]);
  }

  return undefined;
}

/**
 * Reformat an evaluated closed form so a rational multiple of a symbolic factor
 * reads as a fraction: `Multiply(Rational(p, q), R)` → `Divide(p·R, q)` (and
 * `Divide(R, q)` when `p = 1`). Mirrors the readability intent of the
 * telescoping `Subtract` above (`π²/6` instead of `(1/6)·π²`). Any other shape
 * is returned unchanged.
 */
function asReadableFraction(z: Expression, ce: ComputeEngine): Expression {
  if (!isFunction(z, 'Multiply')) return z;
  let coeff: Expression | undefined;
  const rest: Expression[] = [];
  for (const op of z.ops) {
    if (coeff === undefined && isNumber(op) && op.im === 0) coeff = op;
    else rest.push(op);
  }
  if (coeff === undefined || rest.length === 0) return z;
  const [num, den] = coeff.numeratorDenominator;
  if (den.isSame(1)) return z;
  const restExpr =
    rest.length === 1
      ? rest[0]
      : ce.function('Multiply', rest, { form: 'structural' });
  const numExpr = num.isSame(1)
    ? restExpr
    : ce.function('Multiply', [num, restExpr], { form: 'structural' });
  return ce.function('Divide', [numExpr, den], { form: 'structural' });
}

/**
 * Closed form of a p-series term `Σ_{k=a}^∞ k^{-s}` for an exact real `s > 1`
 * and a positive integer lower bound `a`. Uses
 * `ζ(s) − Σ_{k=1}^{a−1} k^{-s}`. Even integer `s` reduce to a `π`-power
 * fraction (`ζ(2) = π²/6`); odd `s ≥ 3` stay as `Zeta(s)`.
 */
function pSeriesClosedForm(
  body: Expression,
  index: string,
  lower: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (!lower.isInteger || lower.isPositive !== true) return undefined;
  const lowerValue = lower.re;
  if (!Number.isSafeInteger(lowerValue) || lowerValue > 10_000)
    return undefined;
  if (!isFunction(body, 'Power')) return undefined;
  const base = body.op1;
  const exp = body.op2;
  if (!(isSymbol(base) && base.symbol === index)) return undefined;
  if (!isNumber(exp) || exp.im !== 0) return undefined;
  const r = exp.re;
  // s = −exp must be a real > 1 for absolute convergence (s = 1 is the
  // harmonic/ζ(1) pole; s ≤ 1 diverges).
  if (!(Number.isFinite(r) && r < -1)) return undefined;
  const s = exp.neg();
  const z = ce.function('Zeta', [s]).evaluate();
  if (lowerValue === 1) return asReadableFraction(z, ce);

  const terms: Expression[] = [z];
  for (let k = 1; k < lowerValue; k++)
    terms.push(
      body
        .subs({ [index]: k })
        .evaluate()
        .neg()
    );
  return asReadableFraction(ce.function('Add', terms).evaluate(), ce);
}

/**
 * Closed form of a geometric series `Σ_{k=n₀}^∞ c·rᵏ = c·r^{n₀}/(1 − r)`, valid
 * for `|r| < 1` (conditional-values design, Phase 3a). `r` must be free of the
 * index `k`; `n₀` is an integer-literal lower bound; an index-free constant
 * factor `c` is allowed (`c·rᵏ`).
 *
 * The convergence condition `|r| < 1` is routed through the `conditionalValue`
 * chokepoint:
 *   - numeric `r` with `|r| < 1`  → the bare exact value (per the exactness
 *     contract: `Σ(1/2)ᵏ → 2`, not `2.`);
 *   - numeric `r` with `|r| ≥ 1`  → `undefined` (decidable-divergent: caller
 *     keeps the sum symbolic, mirroring the p-series entry);
 *   - symbolic `r`                → `When(c·r^{n₀}/(1 − r), |r| < 1)`.
 *
 * Scope is deliberately just this family: no x-dependent ratios (`Σ n·xⁿ`),
 * symbolic start indices, or derivative-of-geometric shapes.
 */
function geometricSumClosedForm(
  body: Expression,
  index: string,
  lower: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (!lower.isInteger) return undefined;
  const n0 = lower.re;
  if (!Number.isSafeInteger(n0)) return undefined;

  // Separate an optional index-free constant factor `c` from the `rᵏ` power.
  let coeff: Expression = ce.One;
  let power: Expression = body;
  if (isFunction(body, 'Multiply')) {
    const consts: Expression[] = [];
    const varying: Expression[] = [];
    for (const f of body.ops) (f.has(index) ? varying : consts).push(f);
    if (varying.length !== 1) return undefined;
    power = varying[0];
    if (consts.length > 0) coeff = ce.function('Multiply', consts);
  }

  if (!isFunction(power, 'Power')) return undefined;
  const r = power.op1;
  const exp = power.op2;
  // The exponent must be exactly the summation index, and the ratio free of it.
  if (!(isSymbol(exp) && exp.symbol === index)) return undefined;
  if (r.has(index)) return undefined;

  // value = c·r^{n₀} / (1 − r)
  const rPow = n0 === 0 ? ce.One : ce.function('Power', [r, ce.number(n0)]);
  const numerator = coeff.isSame(1)
    ? rPow
    : rPow.isSame(1)
      ? coeff
      : ce.function('Multiply', [coeff, rPow]);
  // `simplify` (not just `evaluate`) so a radical ratio rationalizes to its
  // simplest exact form (`Σ(1/√2)ᵏ → 2 + √2`, not `1/(1 − √2/2)`); a symbolic
  // ratio keeps the readable `1/(1 − r)`. Safe here — the closed form no longer
  // contains a `Sum`, so simplifying it cannot re-enter this handler.
  const value = ce
    .function('Divide', [numerator, ce.function('Subtract', [ce.One, r])])
    .simplify();

  const guard = ce.function('Less', [ce.function('Abs', [r]), ce.One]);
  return conditionalValue(ce, value, guard) ?? undefined;
}

/**
 * Multiplicative decomposition of a series body `f(k)` into the features the
 * named-series recognizers dispatch on. The body is flattened across
 * `Divide`/`Multiply`/`Negate`/integer-`Power` into factors, each classified
 * as one of:
 *   - an index-free constant (folded into `coeff`),
 *   - a geometric factor `rᵏ` or `r^(k+m)` (`m` an integer literal; `r^m`
 *     folds into `coeff`, `r` accumulates into `ratio` — a denominator
 *     `1/rᵏ` contributes ratio `1/r`),
 *   - a power of the bare index `k^p` (`kPower` accumulates signed `p`),
 *   - a denominator factor `(2k + b)^s` with integer `b`, `s ≥ 1` (`linear`),
 *   - a denominator `k!` (`factorialDen`).
 * Any other factor makes the decomposition fail (`undefined`).
 */
type SeriesBodyParts = {
  coeff: Expression;
  ratio: Expression | undefined;
  kPower: number;
  linear: { b: number; s: number } | undefined;
  factorialDen: boolean;
};

function decomposeSeriesBody(
  body: Expression,
  index: string,
  ce: ComputeEngine
): SeriesBodyParts | undefined {
  const coeffNum: Expression[] = [];
  const coeffDen: Expression[] = [];
  const ratioNum: Expression[] = [];
  const ratioDen: Expression[] = [];
  let kPower = 0;
  let linear: { b: number; s: number } | undefined = undefined;
  let factorialDen = false;

  // `expr` is the exponent of a geometric factor: `k` or `k + m` (integer
  // literal `m`). Returns `m`, or undefined if not of that shape.
  const geometricShift = (expr: Expression): number | undefined => {
    if (isSymbol(expr) && expr.symbol === index) return 0;
    if (isFunction(expr, 'Add') && expr.nops === 2) {
      const [a, b] = expr.ops;
      if (isSymbol(a) && a.symbol === index && isNumber(b) && b.isInteger)
        return b.re;
      if (isSymbol(b) && b.symbol === index && isNumber(a) && a.isInteger)
        return a.re;
    }
    return undefined;
  };

  // `2k + b` with integer literal `b` → `b`.
  const oddLinearShift = (expr: Expression): number | undefined => {
    if (!isFunction(expr, 'Add') || expr.nops !== 2) return undefined;
    for (const [t, other] of [
      [expr.op1, expr.op2],
      [expr.op2, expr.op1],
    ] as const) {
      if (
        isFunction(t, 'Multiply') &&
        t.nops === 2 &&
        t.op1.isSame(2) &&
        isSymbol(t.op2) &&
        t.op2.symbol === index &&
        isNumber(other) &&
        other.isInteger
      )
        return other.re;
    }
    return undefined;
  };

  // `inDen`: this factor sits in the denominator.
  const addFactor = (f: Expression, inDen: boolean): boolean => {
    if (!f.has(index)) {
      (inDen ? coeffDen : coeffNum).push(f);
      return true;
    }
    if (isSymbol(f) && f.symbol === index) {
      kPower += inDen ? -1 : 1;
      return true;
    }
    if (isFunction(f, 'Negate')) {
      coeffNum.push(ce.NegativeOne);
      return addFactor(f.op1, inDen);
    }
    if (isFunction(f, 'Factorial')) {
      if (!inDen || factorialDen) return false;
      if (!(isSymbol(f.op1) && f.op1.symbol === index)) return false;
      factorialDen = true;
      return true;
    }
    // A bare linear `2k + b` denominator is `(2k + b)^1` (the s = 1 case,
    // e.g. the Leibniz series `Σ (−1)ᵏ/(2k+1)`).
    if (inDen) {
      const b = oddLinearShift(f);
      if (b !== undefined) {
        if (linear !== undefined) return false;
        linear = { b, s: 1 };
        return true;
      }
    }
    if (isFunction(f, 'Divide'))
      return addFactor(f.op1, inDen) && addFactor(f.op2, !inDen);
    if (isFunction(f, 'Multiply'))
      return f.ops.every((op) => addFactor(op, inDen));
    if (isFunction(f, 'Power')) {
      const base = f.op1;
      const exp = f.op2;
      // Geometric factor r^(k+m), index-free base.
      if (!base.has(index)) {
        const m = geometricShift(exp);
        if (m === undefined) return false;
        (inDen ? ratioDen : ratioNum).push(base);
        if (m !== 0)
          (inDen ? coeffDen : coeffNum).push(
            ce.function('Power', [base, ce.number(m)])
          );
        return true;
      }
      // Index-dependent base with integer-literal exponent.
      if (!(isNumber(exp) && exp.isInteger)) return false;
      const p = exp.re;
      if (!Number.isSafeInteger(p)) return false;
      if (isSymbol(base) && base.symbol === index) {
        kPower += inDen ? -p : p;
        return true;
      }
      const b = oddLinearShift(base);
      if (b !== undefined) {
        // Only a single denominator factor (2k + b)^s is recognized.
        const s = inDen ? p : -p;
        if (s < 1 || linear !== undefined) return false;
        linear = { b, s };
        return true;
      }
      return false;
    }
    return false;
  };

  if (!addFactor(body, false)) return undefined;

  const build = (nums: Expression[], dens: Expression[]): Expression => {
    const num =
      nums.length === 0
        ? ce.One
        : nums.length === 1
          ? nums[0]
          : ce.function('Multiply', nums);
    if (dens.length === 0) return num;
    const den = dens.length === 1 ? dens[0] : ce.function('Multiply', dens);
    return ce.function('Divide', [num, den]);
  };

  const coeff = build(coeffNum, coeffDen).evaluate();
  const ratio =
    ratioNum.length === 0 && ratioDen.length === 0
      ? undefined
      : build(ratioNum, ratioDen).evaluate();
  return { coeff, ratio, kPower, linear, factorialDen };
}

/** `expr` is exactly the integer literal −1. */
function isNegativeOne(expr: Expression | undefined): boolean {
  return expr !== undefined && isNumber(expr) && expr.isSame(-1);
}

/**
 * Closed forms for the named series families beyond the plain p-series and
 * geometric entries (each identity numerically verified — see
 * `test/compute-engine/infinite-series.test.ts`):
 *
 *   - alternating p-series `Σ_{k=1}^∞ (−1)^{k+m}/k^s = ±η(s)` with
 *     `η(1) = ln 2`, `η(s) = (1 − 2^{1−s})·ζ(s)` for `s > 1`;
 *   - odd p-series `Σ (2k+b)^{−s} = λ(s) = (1 − 2^{−s})·ζ(s)` for `s > 1`,
 *     when the odd denominators start at 1 (`2·lower + b = 1`);
 *   - Dirichlet beta `Σ (−1)^{k+m}/(2k+b)^s = ±β(s)` for
 *     `s ∈ {1, 2, 3, 5}`: `β(1) = π/4`, `β(2) = G` (Catalan),
 *     `β(3) = π³/32`, `β(5) = 5π⁵/1536`;
 *   - exponential series `Σ_{k=a}^∞ c·rᵏ/k! = c·(e^r − Σ_{j<a} r^j/j!)`
 *     (entire — no convergence guard; symbolic `r` allowed);
 *   - first-moment geometric `Σ_{k∈{0,1}}^∞ c·k·rᵏ = c·r/(1−r)²` for
 *     `|r| < 1` (guard routed through `conditionalValue`, like the
 *     geometric entry);
 *   - logarithmic series `Σ_{k=1}^∞ c·rᵏ/k = −c·ln(1−r)` for `|r| < 1`.
 *
 * Returns undefined when no family matches (caller keeps the sum symbolic).
 */
function namedSeriesClosedForm(
  body: Expression,
  index: string,
  lower: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (!lower.isInteger) return undefined;
  const a = lower.re;
  if (!Number.isSafeInteger(a)) return undefined;

  const parts = decomposeSeriesBody(body, index, ce);
  if (!parts) return undefined;
  const { coeff, ratio, kPower, linear, factorialDen } = parts;

  const times = (v: Expression): Expression =>
    coeff.isSame(1)
      ? v
      : asReadableFraction(ce.function('Multiply', [coeff, v]).evaluate(), ce);

  // Exponential series: c·rᵏ/k! (kPower = 0, no linear factor).
  if (factorialDen) {
    if (kPower !== 0 || linear !== undefined || a < 0) return undefined;
    const r = ratio ?? ce.One;
    let value: Expression = ce.function('Exp', [r]);
    if (a > 0) {
      const terms: Expression[] = [value];
      for (let j = 0, fact = 1; j < a; fact *= ++j)
        terms.push(
          ce
            .function('Divide', [
              ce.function('Power', [r, ce.number(j)]),
              ce.number(fact),
            ])
            .evaluate()
            .neg()
        );
      value = ce.function('Add', terms);
    }
    return times(value.evaluate());
  }

  // Odd-denominator families: a single (2k+b)^{−s} factor, no kᵖ.
  if (linear !== undefined) {
    if (kPower !== 0) return undefined;
    const { b, s } = linear;
    // The odd denominators must start at 1 (scope: the textbook shapes
    // `Σ_{k=1} (2k−1)^{−s}` and `Σ_{k=0} (2k+1)^{−s}`).
    if (2 * a + b !== 1) return undefined;

    if (ratio === undefined) {
      // λ(s) = (1 − 2^{−s})·ζ(s), s > 1 (s = 1 diverges).
      if (s <= 1) return undefined;
      const z = ce.function('Zeta', [ce.number(s)]).evaluate();
      const scaledZ = ce
        .box(['Multiply', ['Subtract', 1, ['Power', 2, -s]], z.json as any])
        .evaluate();
      return times(asReadableFraction(scaledZ, ce));
    }

    if (isNegativeOne(ratio)) {
      // Dirichlet beta: the first term (k = a) has sign (−1)^a.
      const table: Record<number, Expression> = {
        1: ce.function('Divide', [ce.Pi, ce.number(4)]),
        2: ce.symbol('CatalanConstant'),
        3: ce.function('Divide', [
          ce.function('Power', [ce.Pi, ce.number(3)]),
          ce.number(32),
        ]),
        5: ce.function('Divide', [
          ce.function('Multiply', [
            ce.number(5),
            ce.function('Power', [ce.Pi, ce.number(5)]),
          ]),
          ce.number(1536),
        ]),
      };
      const beta = table[s];
      if (!beta) return undefined;
      const signed = a % 2 === 0 ? beta : beta.neg();
      return times(signed);
    }
    return undefined;
  }

  // Alternating p-series: c·(−1)ᵏ·k^{−s} from k = 1 → −c·η(s).
  if (isNegativeOne(ratio) && kPower <= -1) {
    if (a !== 1) return undefined;
    const s = -kPower;
    const eta: Expression =
      s === 1
        ? ce.function('Ln', [ce.number(2)])
        : asReadableFraction(
            ce
              .box([
                'Multiply',
                ['Subtract', 1, ['Power', 2, 1 - s]],
                ce.function('Zeta', [ce.number(s)]).evaluate().json as any,
              ])
              .evaluate(),
            ce
          );
    // First term (k = 1) has sign −1: Σ (−1)ᵏ/kˢ = −η(s).
    return times(eta.neg());
  }

  if (ratio === undefined) return undefined;

  // First-moment geometric: c·k·rᵏ → c·r/(1−r)², valid for |r| < 1.
  if (kPower === 1 && (a === 0 || a === 1)) {
    const value = times(
      ce
        .function('Divide', [
          ratio,
          ce.function('Power', [ce.function('Subtract', [ce.One, ratio]), 2]),
        ])
        .simplify()
    );
    const guard = ce.function('Less', [ce.function('Abs', [ratio]), ce.One]);
    return conditionalValue(ce, value, guard) ?? undefined;
  }

  // Logarithmic series: c·rᵏ/k → −c·ln(1−r), valid for |r| < 1.
  if (kPower === -1 && a === 1) {
    const value = times(
      ce
        .function('Negate', [
          ce.function('Ln', [ce.function('Subtract', [ce.One, ratio])]),
        ])
        .simplify()
    );
    const guard = ce.function('Less', [ce.function('Abs', [ratio]), ce.One]);
    return conditionalValue(ce, value, guard) ?? undefined;
  }

  return undefined;
}

/**
 * Attempt a closed form for `Sum(body, [index, lower, +∞])` on an infinite
 * upper domain. Handles:
 *   - p-series `Σ_{k=a}^∞ k^{-s} = ζ(s) − Σ_{k=1}^{a−1} k^{-s}`
 *     (exact real `s > 1`, positive-integer `a`);
 *   - geometric series `Σ_{k=n₀}^∞ c·rᵏ = c·r^{n₀}/(1 − r)` for numeric
 *     `|r| < 1` (divergent numeric ratios stay symbolic);
 *   - term-wise splitting `Σ (f + g) = Σ f + Σ g`, applied ONLY when every
 *     summand individually has a known closed form (each piece's convergence is
 *     then established by that closed form's own validity — absolute
 *     convergence for the p-series pieces).
 * Returns undefined when no closed form applies (caller keeps it symbolic).
 */
export function infiniteSumClosedForm(
  body: Expression | undefined,
  limits: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (!body || !isFunction(limits, 'Limits')) return undefined;
  const index = isSymbol(limits.op1) ? limits.op1.symbol : undefined;
  const lower = limits.op2;
  const upper = limits.op3;
  if (!index || !lower || !upper) return undefined;
  if (!(upper.isInfinity === true && upper.isPositive === true))
    return undefined;

  if (isFunction(body, 'Add')) {
    const pieces: Expression[] = [];
    for (const term of body.ops) {
      const cf = pSeriesClosedForm(term, index, lower, ce);
      if (!cf) return undefined; // any piece without a closed form ⇒ stay symbolic
      pieces.push(cf);
    }
    return ce.function('Add', pieces, { form: 'structural' });
  }

  return (
    pSeriesClosedForm(body, index, lower, ce) ??
    geometricSumClosedForm(body, index, lower, ce) ??
    namedSeriesClosedForm(body, index, lower, ce)
  );
}

/**
 * Attempt a closed form for `Product(body, [index, 1, +∞])` on an infinite
 * upper domain. Currently recognizes the Wallis product
 *   `Π_{k=1}^∞ (1 − 1/(2k)²) = 2/π`
 * matched structurally against the canonicalized body (the bound index is
 * arbitrary, so the pattern is rebuilt on `index`). Returns undefined
 * otherwise (caller keeps it symbolic).
 */
export function infiniteProductClosedForm(
  body: Expression | undefined,
  limits: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (!body || !isFunction(limits, 'Limits')) return undefined;
  const index = isSymbol(limits.op1) ? limits.op1.symbol : undefined;
  const lower = limits.op2;
  const upper = limits.op3;
  if (!index || !lower || !upper) return undefined;
  if (!(upper.isInfinity === true && upper.isPositive === true))
    return undefined;

  // Π_{k=a}^∞ (1 − 1/k²) = (a − 1)/a for integer a ≥ 2 (telescoping:
  // (k−1)(k+1)/k²). Numerically verified (a = 2 → 1/2, a = 3 → 2/3).
  const oneMinusInvSq = ce.box([
    'Subtract',
    1,
    ['Divide', 1, ['Power', index, 2]],
  ]);
  if (oneMinusInvSq.isSame(body)) {
    if (!lower.isInteger) return undefined;
    const a = lower.re;
    if (!Number.isSafeInteger(a) || a < 2) return undefined;
    return ce.function('Divide', [ce.number(a - 1), ce.number(a)]);
  }

  if (!lower.isSame(1)) return undefined;

  // Wallis: Π_{k=1}^∞ (1 − 1/(2k)²) = 2/π. Match the canonicalized body.
  const wallis = ce.box([
    'Subtract',
    1,
    ['Divide', 1, ['Power', ['Multiply', 2, index], 2]],
  ]);
  if (wallis.isSame(body)) return ce.function('Divide', [ce.number(2), ce.Pi]);

  // Odd-index Wallis analog: Π_{k=1}^∞ (1 − 1/(2k+1)²) = π/4.
  const wallisOdd = ce.box([
    'Subtract',
    1,
    ['Divide', 1, ['Power', ['Add', ['Multiply', 2, index], 1], 2]],
  ]);
  if (wallisOdd.isSame(body))
    return ce.function('Divide', [ce.Pi, ce.number(4)]);

  // Π_{k=1}^∞ (1 + 1/k²) = sinh(π)/π (from the sin product formula at z = i).
  const onePlusInvSq = ce.box(['Add', 1, ['Divide', 1, ['Power', index, 2]]]);
  if (onePlusInvSq.isSame(body))
    return ce.function('Divide', [ce.function('Sinh', [ce.Pi]), ce.Pi]);

  return undefined;
}

/**
 * Normalize an infinite indexing set into a SCHEDULE WALK for series
 * acceleration: `termIndexAt(j)` maps the schedule position `j = 0, 1, 2, …`
 * onto the series index to evaluate, walking the infinite tail from its
 * finite anchor. Covers the infinite spellings `classifyBigopDomain` admits:
 *
 * - `Limits(i, a, +∞)` — and the default-domain `Nothing` bounds (a bare
 *   `Sum(f, i)` index canonicalizes to `Limits(i, Nothing, Nothing)`,
 *   meaning `1..+∞`): forward walk `a, a+1, …`;
 * - `Limits(i, −∞, b)` with finite `b`: reflected walk `b, b−1, …` (the
 *   tail decays toward −∞, so the finite anchor is the UPPER bound);
 * - `Limits(i, −∞, +∞)`: symmetric outward walk — `doubly` is set, and one
 *   schedule step contributes the PAIR `f(j) + f(−j)` (`f(0)` alone at
 *   `j = 0`);
 * - `Element(i, ℕ₀ | ℤ⁺)`: the forward walk of the converted range
 *   (`convertInfiniteSetToLimits`).
 *
 * Returns `undefined` for anything else (a finite range, a symbolic bound, a
 * non-convertible set) — the caller then declines acceleration.
 */
function infiniteSeriesWalk(limits: Expression):
  | {
      index: string;
      termIndexAt: (j: number) => number;
      doubly: boolean;
    }
  | undefined {
  if (isFunction(limits, 'Element')) {
    const index = isSymbol(limits.op1) ? limits.op1.symbol : undefined;
    const domain = limits.op2;
    if (!index || !isSymbol(domain)) return undefined;
    const converted = convertInfiniteSetToLimits(domain.symbol);
    if (converted === undefined) return undefined;
    const a = converted.lower;
    return { index, termIndexAt: (j) => a + j, doubly: false };
  }
  if (!isFunction(limits, 'Limits')) return undefined;
  const index = isSymbol(limits.op1) ? limits.op1.symbol : undefined;
  const lower = limits.op2;
  const upper = limits.op3;
  if (!index || !lower || !upper) return undefined;
  const upperIsInfinite =
    (upper.isInfinity === true && upper.isPositive === true) ||
    isSymbol(upper, 'Nothing');
  const lowerIsNegInfinite =
    lower.isInfinity === true && lower.isNegative === true;
  if (lowerIsNegInfinite && upperIsInfinite)
    return { index, termIndexAt: (j) => j, doubly: true };
  if (lowerIsNegInfinite) {
    const b = Math.round(upper.re);
    if (!Number.isFinite(b)) return undefined;
    return { index, termIndexAt: (j) => b - j, doubly: false };
  }
  if (!upperIsInfinite) return undefined;
  const a = isSymbol(lower, 'Nothing') ? 1 : Math.round(lower.re);
  if (!Number.isFinite(a)) return undefined;
  return { index, termIndexAt: (j) => a + j, doubly: false };
}

/**
 * Accelerated `.N()` of a convergent infinite sum `Σ_{k=a}^∞ f(k)` — or the
 * reflected `Σ_{k=−∞}^{b}` and doubly-infinite `Σ_{k=−∞}^{∞}` forms, and the
 * `Element(k, ℕ₀ | ℤ⁺)` spelling (see `infiniteSeriesWalk`).
 *
 * A plain truncation of a smooth monotone-decay series is off by ~ the tail
 * `∫_N^∞ f` (e.g. `Σ 1/k²` truncated at 10⁴ terms is ~1e-4 low). Instead we
 * Richardson-extrapolate the partial sums `S(N) → S(∞)`: the sequence
 * `S(1), S(2), S(4), …, S(2ᵐ)` (exact doubling, so every sample index is an
 * exact integer) has an asymptotic expansion in `1/N` that the Neville tableau
 * eliminates term by term, reaching near machine precision from ~2⁹ evaluated
 * terms.
 *
 * Returns undefined — the caller then keeps the sum UNEVALUATED (never a
 * truncated partial) — when the domain isn't one of the recognized infinite
 * spellings, the body isn't real-numeric, or the extrapolation does not
 * converge within the evaluation budget (divergent or slowly/non-smoothly
 * decaying series, e.g. a half-integer p-series whose expansion is not in
 * integer powers of `1/N`).
 */
export function acceleratedInfiniteSum(
  body: Expression | undefined,
  limits: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (!body) return undefined;
  const walk = infiniteSeriesWalk(limits);
  if (walk === undefined) return undefined;
  const { index, termIndexAt, doubly } = walk;

  // Numeric value of the body at integer index `k` (real series only).
  const term = (k: number): number => {
    assignLoopIndex(ce, index, k);
    return numericValueOf(body) ?? NaN;
  };
  // One schedule step contributes one series term — or, on the symmetric
  // doubly-infinite walk, the pair `f(j) + f(−j)` (`f(0)` alone at j = 0).
  // `absAccum` tracks the ABSOLUTE series alongside; the doubly-infinite
  // acceptance requires it to settle (see below).
  let absAccum = 0;
  const termAt = doubly
    ? (j: number): number => {
        if (j === 0) {
          const t = term(0);
          absAccum += Math.abs(t);
          return t;
        }
        const p = term(j);
        const q = term(-j);
        absAccum += Math.abs(p) + Math.abs(q);
        return p + q;
      }
    : (j: number): number => {
        const t = term(termIndexAt(j));
        absAccum += Math.abs(t);
        return t;
      };

  // Partial sum over schedule steps 0..J, accumulated across the strictly
  // increasing (doubling) schedule `extrapolate` samples. Bound total work: on
  // overflow the sequence stops changing, which would masquerade as
  // convergence, so record it and reject below.
  // Cap total term evaluations near the historical truncation budget:
  // convergent smooth series reach machine precision from ~2¹⁰ terms, well
  // under this, while a divergent/non-converging series stops here, trips
  // `overflow`, and is rejected below without a runaway grind.
  const MAX_TERMS = 1 << 15; // 32768
  let cachedJ = -1;
  let cachedSum = 0;
  let overflow = false;
  const partialSum = (x: number): number => {
    let j = Math.round(x);
    if (j < 0) return 0;
    if (j > MAX_TERMS) {
      j = MAX_TERMS;
      overflow = true;
    }
    // The schedule is monotone increasing; guard defensively anyway.
    if (j < cachedJ) {
      cachedJ = -1;
      cachedSum = 0;
      absAccum = 0;
    }
    for (let i = cachedJ + 1; i <= j; i++) cachedSum += termAt(i);
    cachedJ = j;
    return cachedSum;
  };

  // `contract: 0.5` samples S at exact powers of two (see doc comment);
  // `power: 1` matches the integer-power `1/N` tail expansion.
  const [val, err] = extrapolate(partialSum, Infinity, {
    contract: 0.5,
    step: 1,
    power: 1,
    atol: 1e-14,
    rtol: 1e-12,
    maxeval: 64,
    deadline: ce._deadline,
  });

  // On the symmetric doubly-infinite walk the ± pairing cancels
  // STRUCTURALLY, so a divergent series can present perfectly settled
  // partial sums (`Σ n` over ℤ pairs to 0 at every step — the Cauchy
  // principal value, not a sum). Require the ABSOLUTE series to settle
  // over the last doubling windows: only absolute convergence makes the
  // unordered doubly-infinite sum well-defined.
  if (doubly) {
    partialSum(MAX_TERMS / 4);
    const a1 = absAccum;
    partialSum(MAX_TERMS / 2);
    const a2 = absAccum;
    partialSum(MAX_TERMS);
    const a3 = absAccum;
    const absTol = 1e-8 * Math.max(1, a3);
    if (!Number.isFinite(a3) || a3 - a2 > absTol || a2 - a1 > absTol)
      return undefined;
  }

  // Require genuine convergence (a divergent or non-smooth series stalls with
  // a large error estimate) before trusting the accelerated value.
  if (!overflow && Number.isFinite(val)) {
    if (err <= Math.max(1e-10, 1e-9 * Math.abs(val))) return ce.number(val);
  }

  // Second acceptance, for OSCILLATING absolutely-convergent series
  // (`Σ sinc³(n)` over ℤ): their partial sums settle but have no smooth
  // `1/N` expansion, so the Neville tableau above cannot certify them.
  // Accept the deepest partial sum when the last DOUBLING windows are
  // Cauchy — each window's contribution ≤ ~1e-8 of the total. A divergent
  // series cannot pass: even `Σ 1/(n·ln n)` (divergence slower than any
  // p-series) adds ~3e-2 per doubling at this depth, orders of magnitude
  // over the tolerance, and anything slower still fails the window test
  // rather than sneaking through as "settled".
  const s1 = partialSum(MAX_TERMS / 4);
  const s2 = partialSum(MAX_TERMS / 2);
  const s3 = partialSum(MAX_TERMS);
  if (!Number.isFinite(s3)) return undefined;
  const tol = 1e-8 * Math.max(1, Math.abs(s3));
  if (Math.abs(s3 - s2) <= tol && Math.abs(s2 - s1) <= tol)
    return ce.number(s3);
  return undefined;
}

/**
 * Accelerated `.N()` of a convergent infinite product
 * `Π_{k=a}^∞ f(k)`. For positive real factors, accumulate
 * `L(N) = Σ log(f(k))` and Richardson-extrapolate `L(N)` using the same
 * doubling schedule as infinite sums, then return `exp(L(∞))`.
 *
 * Restricting factors to finite positive reals avoids branch/sign ambiguity;
 * a zero-crossing or oscillatory product declines, and the caller keeps the
 * expression unevaluated (never a truncated partial product).
 */
export function acceleratedInfiniteProduct(
  body: Expression | undefined,
  limits: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (!body) return undefined;
  // Same walk normalization as `acceleratedInfiniteSum` (forward, reflected,
  // and `Element` spellings). The symmetric doubly-infinite walk is declined:
  // its per-step PAIRING has no log-domain analog worth the branch risk.
  const walk = infiniteSeriesWalk(limits);
  if (walk === undefined || walk.doubly) return undefined;
  const { index, termIndexAt } = walk;

  let invalid = false;
  const logTerm = (k: number): number => {
    assignLoopIndex(ce, index, k);
    const value = numericValueOf(body);
    if (value === undefined || !(value > 0)) {
      invalid = true;
      return NaN;
    }
    return Math.log(value);
  };

  const MAX_TERMS = 1 << 15;
  let cachedJ = -1;
  let cachedLogSum = 0;
  let overflow = false;
  const partialLogSum = (x: number): number => {
    let j = Math.round(x);
    if (j < 0) return 0;
    if (j > MAX_TERMS) {
      j = MAX_TERMS;
      overflow = true;
    }
    if (j < cachedJ) {
      cachedJ = -1;
      cachedLogSum = 0;
    }
    for (let i = cachedJ + 1; i <= j; i++)
      cachedLogSum += logTerm(termIndexAt(i));
    cachedJ = j;
    return cachedLogSum;
  };

  const [logValue, error] = extrapolate(partialLogSum, Infinity, {
    contract: 0.5,
    step: 1,
    power: 1,
    atol: 1e-14,
    rtol: 1e-12,
    maxeval: 64,
    deadline: ce._deadline,
  });

  if (invalid || overflow || !Number.isFinite(logValue)) return undefined;
  if (!(error <= Math.max(1e-10, 1e-9 * Math.abs(logValue)))) return undefined;
  const value = Math.exp(logValue);
  return Number.isFinite(value) ? ce.number(value) : undefined;
}

export type IndexingSet = {
  index: string | undefined;
  lower: number;
  upper: number;
  isFinite: boolean;
};

/**
 * IndexingSet is an expression describing an index variable
 * and a range of values for that variable.
 *
 * Note that when this function is called the indexing set is assumed to be canonical: 'Hold' has been handled, the indexing set is a tuple, and the bounds are canonical.
 *
 * This can take several valid forms:
 * - a symbol, e.g. `n`, the upper and lower bounds are assumed ot be infinity
 * - a tuple, e.g. `["Pair", "n", 1]` or `["Tuple", "n", 1, 10]` with one
 *   or two bounds
 *
 * The result is a normalized version that includes the index, the lower and
 * upper bounds of the range, and a flag indicating whether the range is finite.
 * @param indexingSet
 * @returns
 */
export function normalizeIndexingSet(indexingSet: Expression): IndexingSet {
  console.assert(indexingSet?.operator === 'Limits');
  console.assert(
    isFunction(indexingSet),
    'Indexing set must be a function expression'
  );

  let lower = 1;
  let upper = lower + MAX_ITERATION;
  let index: string | undefined = undefined;
  let isFinite = true;

  // We've asserted it's a function above; narrow the type
  const fn = indexingSet as Expression &
    import('../global-types.js').FunctionInterface;
  const op1 = fn.op1;
  index = isSymbol(op1) ? op1.symbol : undefined;
  console.assert(index !== undefined, 'Indexing set must have an index');
  // `bigopBoundValue`, not `.re`: a closed bound expression (`Length(P)`) has
  // no machine value until it is evaluated. See item 125 there.
  lower = Math.floor(bigopBoundValue(fn.op2));
  if (isNaN(lower)) lower = 1;

  if (!Number.isFinite(lower)) isFinite = false;

  const op3 = fn.op3;
  const op3Sym = isSymbol(op3) ? op3.symbol : undefined;
  if (op3Sym === 'Nothing' || op3.isInfinity) {
    isFinite = false;
    upper = Infinity;
  } else {
    const op3Value = bigopBoundValue(op3);
    if (!isNaN(op3Value)) upper = Math.floor(op3Value);
    if (!Number.isFinite(upper)) isFinite = false;
  }

  // Truncate infinite ranges to a finite iteration window so `lower` and
  // `upper` are always usable as loop bounds:
  // - (lower..∞)  → lower .. lower + MAX_ITERATION
  // - (−∞..upper) → upper − MAX_ITERATION .. upper
  // - (−∞..∞)    → symmetric window around 0 (previously this produced an
  //   empty range, so e.g. Σ_{n=−∞}^{∞} sinc³(n) evaluated to 0)
  if (!isFinite) {
    if (!Number.isFinite(lower) && !Number.isFinite(upper)) {
      lower = -MAX_ITERATION / 2;
      upper = lower + MAX_ITERATION;
    } else if (!Number.isFinite(lower)) {
      lower = upper - MAX_ITERATION;
    } else {
      upper = lower + MAX_ITERATION;
    }
  }

  return { index, lower, upper, isFinite };
}

export function normalizeIndexingSets(
  ops: ReadonlyArray<Expression>
): IndexingSet[] {
  return ops.map((op) => normalizeIndexingSet(op));
}

/**
 * Return the first indexing set whose bounds cannot be faithfully enumerated
 * at `number` precision, or `undefined` if they all can.
 *
 * Above `Number.MAX_SAFE_INTEGER` the spacing between representable values is
 * greater than 1, so `current + 1` rounds back to `current` and the odometer
 * wheel can never walk the range: the reduction would silently yield a single
 * term for bounds that nominally describe many. A DEGENERATE range
 * (`lower === upper`) is not affected — it has exactly one term and needs no
 * increment — and neither is an empty one (`upper < lower`).
 *
 * Only the magnitude of the bounds is considered, not their integrality: a
 * fractional bound (`Σ_{n=1}^{10.5}`) enumerates fine and must keep doing so.
 */
export function nonEnumerableIndexingSet(
  indexingSets: IndexingSet[]
): IndexingSet | undefined {
  return indexingSets.find(({ lower, upper, isFinite }) => {
    const hi = !isFinite ? lower + MAX_ITERATION : upper;
    if (hi <= lower) return false;
    return (
      Math.abs(lower) > Number.MAX_SAFE_INTEGER ||
      Math.abs(hi) > Number.MAX_SAFE_INTEGER
    );
  });
}

/**
 * Stream the cartesian product of the indexing sets, one index tuple at a
 * time, instead of materializing it.
 *
 * A big-op with a large *finite* bound (`Σ_{i=1}^{10⁸}`) used to allocate one
 * one-element array per index value *before* the reducer ran a single step,
 * so the process died of heap exhaustion before any deadline could be
 * consulted. Streaming keeps allocation O(number of indexes) and lets the
 * caller check the deadline between terms.
 *
 * The yielded array is REUSED between iterations: consumers must read the
 * values out (as `reduceBigOp` does when assigning the loop indexes) and must
 * not retain it.
 *
 * Yields the full n-dimensional product: for `k` indexing sets every tuple has
 * length `k`, and the last index varies fastest (odometer order). (A previous
 * fold-based implementation collapsed every tuple to length 2 for three or
 * more indexing sets, dropping all but the last two dimensions.)
 *
 * Callers are expected to have rejected bounds that cannot be walked at
 * `number` precision — see `nonEnumerableIndexingSet`.
 */
export function* indexingSetCartesianProductIterator(
  indexingSets: IndexingSet[]
): Generator<number[]> {
  console.assert(indexingSets.length > 0, 'Indexing sets must not be empty');

  const bounds = indexingSets.map(({ lower, upper, isFinite }) => ({
    lower,
    upper: !isFinite ? lower + MAX_ITERATION : upper,
  }));

  // An empty range in any dimension makes the whole product empty.
  if (bounds.some(({ lower, upper }) => upper < lower)) return;

  const n = bounds.length;
  const current = bounds.map((x) => x.lower);
  const tuple = new Array<number>(n);

  while (true) {
    for (let i = 0; i < n; i++) tuple[i] = current[i];
    yield tuple;

    // Odometer increment: the last index varies fastest.
    let i = n - 1;
    while (i >= 0) {
      // Above `Number.MAX_SAFE_INTEGER`, `+ 1` rounds back to the same value:
      // the wheel can never reach its upper bound, so treat a non-advancing
      // increment as an exhausted wheel instead of spinning forever.
      const next = current[i] + 1;
      if (next <= bounds[i].upper && next !== current[i]) {
        current[i] = next;
        break;
      }
      current[i] = bounds[i].lower;
      i -= 1;
    }
    if (i < 0) return; // All the odometer wheels wrapped: we're done.
  }
}

/** Given a sequence of arguments, return an array of Limits:
 *
 * - ["Range", 1, 10] -> ["Limits", "Unknown", 1, 10]
 * - 1, 10 -> ["Limits", "Nothing", 1, 10]
 * - [Tuple, "x", 1, 10] -> ["Limits", "x", 1, 10]
 *
 */
export function canonicalLimitsSequence(
  ops: ReadonlyArray<Expression>,
  options: { engine: ComputeEngine }
): Expression[] {
  const ce = options.engine;
  const result: Expression[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.operator === 'Range') {
      // ["Range", 1, 10]
      const rangeFn = op as Expression &
        import('../global-types.js').FunctionInterface;
      result.push(
        canonicalLimits([ce.Nothing, rangeFn.op1, rangeFn.op2], options) ??
          ce.error('missing')
      );
    } else if (
      op.operator &&
      ['Limits', 'Tuple', 'Triple', 'Pair', 'Single', 'Hold'].includes(
        op.operator
      )
    ) {
      // ["Tuple", "n", 1, 10]
      // ["Limits", "n", 1, 10]
      // ["Hold", "x"]
      const fnOp = op as Expression &
        import('../global-types.js').FunctionInterface;
      // A 4-operand spec `(x, lo, hi, step)` is a *stepped* iterator, and
      // integration bounds have no step slot. Leave it unrecognized — exactly
      // as the `Set` spelling below does, which requires a proper triple — so
      // the integral stays indefinite. Without this guard the operand fell
      // through `canonicalLimits`'s arity chain, which left `index`/`lower` at
      // `Nothing` and `upper` at its `ops[1]` initializer, yielding the
      // nonsense `Limits(Nothing, Nothing, lo)` (and a sign-flipped result).
      if (fnOp.ops.length <= 3)
        result.push(canonicalLimits(fnOp.ops, options) ?? ce.error('missing'));
    } else if (op.operator === 'Set') {
      // Mathematica-style definite-integral bounds: `{x, lo, hi}`. POSITIONAL —
      // only recognized here, in the bounds slot. The `Set` is held (raw), so
      // its index symbol is not yet canonicalized. Only a proper triple
      // `{sym, lo, hi}` is recognized; any other shape is left untouched
      // (unchanged behavior → indefinite integral).
      const setOps = (
        op as Expression & import('../global-types.js').FunctionInterface
      ).ops;
      if (setOps && setOps.length === 3 && isSymbol(setOps[0])) {
        result.push(canonicalLimits(setOps, options) ?? ce.error('missing'));
      }
    } else if (isSymbol(op)) {
      // "x" or "1, 10"
      if (isNumber(ops[i + 1])) {
        if (isNumber(ops[i + 2])) {
          // "n", 1, 10
          result.push(
            canonicalLimits([op, ops[i + 1], ops[i + 2]], options) ??
              ce.error('missing')
          );
          i += 2;
        } else {
          // "n", 10
          result.push(
            canonicalLimits([op, ops[i + 1]], options) ?? ce.error('missing')
          );
          i += 1;
        }
      } else {
        // "x"
        result.push(canonicalLimits([op], options) ?? ce.error('missing'));
      }
    }
  }

  return result;
}

export function canonicalLimits(
  ops: ReadonlyArray<Expression>,
  { engine: ce }: { engine: ComputeEngine }
): Expression | null {
  if (ops.length === 1) {
    // ["Limits", "n"]
    // ["Limits", ["Hold", "n"]]
    // ["Limits", "10"] --> ???
    const op = ops[0];
    if (isSymbol(op)) return ce._fn('Limits', [op, ce.Nothing, ce.Nothing]);
    if (isFunction(op, 'Hold')) return canonicalLimits(op.ops, { engine: ce });

    // We didn't find a symbol, so we can't create a Limits expression
    return ce._fn('Limits', [ce.typeError('symbol', undefined, op)]);
  } else if (ops.length > 1) {
    let index: Expression = ce.Nothing;
    let lower: Expression | null = ce.Nothing;
    let upper: Expression | null = ops[1].canonical;
    if (ops.length === 2) {
      // ["Limits", "n", 10]
      // ["Limits", ["Hold", "n"], 10]]
      // ["Limits", 0, 10]
      if (isFunction(ops[0], 'Hold')) {
        index = ops[0].op1;
        upper = ops[1].canonical;
      } else if (isSymbol(ops[0])) {
        index = ops[0];
        upper = ops[1].canonical;
      } else {
        index = ce.Nothing;
        lower = ops[0].canonical;
        upper = ops[1].canonical;
      }
    } else if (ops.length === 3) {
      index = ops[0] ?? ce.Nothing;
      lower = ops[1]?.canonical ?? ce.Nothing;
      upper = ops[2]?.canonical ?? ce.Nothing;
    }
    if (isFunction(index, 'Hold')) index = index.op1;

    if (!isSymbol(index)) index = ce.typeError('symbol', index.type, index);

    return ce._fn('Limits', [index, lower, upper]);
  }
  return null;
}

/** Return a limit/indexing set in canonical form as a `Limits` expression
 * with:
 * - `index` (a symbol), `Nothing` if none is present
 * - `lower` (a number), `Nothing` if none is present
 * - `upper` (a number), `Nothing` if none is present
 *
 * Or, for Element expressions, preserve them in canonical form.
 *
 * Assume we are in the context of a big operator
 * (i.e. `pushScope()` has been called)
 */
/**
 * A summation/product limit (lower or upper bound) must be numeric. Accept a
 * `Nothing` sentinel (an open bound), an already-invalid operand, and anything
 * that could evaluate to a number (a number literal, a numeric expression, or
 * an unknown symbol). Reject a *provably* non-numeric bound (a string, a
 * boolean) with a type error so the enclosing big-op stays symbolic instead of
 * silently coercing it — e.g. `Sum(x, (x, "lo", 10))` must not read "lo" as 1
 * and evaluate to 55.
 */
function checkBound(bound: Expression | null): Expression | null {
  if (bound === null) return null;
  if (isSymbol(bound) && bound.symbol === 'Nothing') return bound;
  if (!bound.isValid) return bound;
  if (bound.isNumber) return bound;
  const t = bound.type;
  if (t.isUnknown || t.type === 'any') return bound;
  if (t.matches('number')) return bound;
  return bound.engine.typeError('number', t, bound);
}

export function canonicalIndexingSet(expr: Expression): Expression | undefined {
  const ce = expr.engine;
  let index: Expression;
  let upper: Expression | null = null;
  let lower: Expression | null = null;

  // Handle Element expressions - preserve them in canonical form
  // e.g., ["Element", "n", ["Set", 1, 2, 3]]
  // or with condition: ["Element", "n", ["Set", 1, 2, 3], ["Greater", "n", 0]]
  if (isFunction(expr, 'Element')) {
    const indexExpr = expr.op1;
    const collection = expr.op2;
    const condition = expr.op3; // Optional condition (EL-3)
    if (!isSymbol(indexExpr)) return undefined;
    // Guarded like every other branch below: the binder hook may already have
    // declared the index in this scope, and `ce.declare` throws on a redeclare.
    if (
      indexExpr.symbol !== 'Nothing' &&
      !ce.context.lexicalScope.bindings.has(indexExpr.symbol)
    )
      ce.declare(indexExpr.symbol, 'integer');
    if (condition) {
      return ce.function('Element', [
        indexExpr.canonical,
        collection.canonical,
        condition.canonical,
      ]);
    }
    return ce.function('Element', [indexExpr.canonical, collection.canonical]);
  }

  // If this is already a canonical Limits expression, return it (after
  // canonicalizing its operands) so re-canonicalization paths (like `subs`)
  // preserve the bounds.
  if (isFunction(expr, 'Limits')) {
    // Explicitly declare the index BEFORE canonicalizing the bounds.
    // This ensures the index lands in the current (BigOp) scope even when
    // noAutoDeclare is set, so bounds like 'M' (which are free variables)
    // are correctly promoted to the parent scope via noAutoDeclare.
    const rawIndex = expr.op1;
    if (isSymbol(rawIndex) && rawIndex.symbol !== 'Nothing') {
      if (!ce.context.lexicalScope.bindings.has(rawIndex.symbol))
        ce.declare(rawIndex.symbol, 'integer');
    }
    const canonicalIndex = expr.op1.canonical;
    const canonicalLower =
      checkBound(expr.op2?.canonical ?? null) ?? ce.Nothing;
    const canonicalUpper =
      checkBound(expr.op3?.canonical ?? null) ?? ce.Nothing;
    if (!isSymbol(canonicalIndex))
      return ce.function('Limits', [
        ce.typeError('symbol', undefined, canonicalIndex),
      ]);
    return ce.function('Limits', [
      canonicalIndex,
      canonicalLower,
      canonicalUpper,
    ]);
  }

  // Mathematica-style iterator set: `{i, lo, hi}` or `{i, lo, hi, step}`.
  // This reinterpretation is POSITIONAL — it only applies here, in a big
  // operator's iterator slot. The `Set` is held (raw), so its index symbol
  // has not been canonicalized (e.g. `i` → imaginary unit) and its operands
  // have not been sorted/de-duplicated. Only a proper iterator triple is
  // recognized; any other `Set` shape returns `undefined` (today's behavior).
  if (isFunction(expr, 'Set')) {
    const setOps = expr.ops ?? [];
    const idx = setOps[0];
    if (!idx || !isSymbol(idx) || setOps.length < 3 || setOps.length > 4)
      return undefined;
    if (
      idx.symbol !== 'Nothing' &&
      !ce.context.lexicalScope.bindings.has(idx.symbol)
    )
      ce.declare(idx.symbol, 'integer');
    if (setOps.length === 4) {
      // With a step, use the Range/Element form: `Limits` has no step slot.
      return ce.function('Element', [
        idx.canonical,
        ce.function('Range', [
          setOps[1].canonical,
          setOps[2].canonical,
          setOps[3].canonical,
        ]),
      ]);
    }
    // `{i, lo, hi}` → `Limits(i, lo, hi)` — same result as the `Tuple`/
    // `Element` forms, and (unlike Range) preserves symbolic bounds.
    return ce.function('Limits', [
      idx.canonical,
      checkBound(setOps[1].canonical) ?? ce.Nothing,
      checkBound(setOps[2].canonical) ?? ce.Nothing,
    ]);
  }

  if (
    expr.operator === 'Tuple' ||
    expr.operator === 'Triple' ||
    expr.operator === 'Pair' ||
    expr.operator === 'Single'
  ) {
    if (!isFunction(expr)) return undefined;
    // The paren spelling of the Mathematica-style iterator set handled by the
    // `Set` branch above: `(i, lo, hi)` and, with a step, `(i, lo, hi, step)`.
    // The step operand MUST be read here — the branch used to look at the
    // first three operands only, silently dropping it, so
    // `Sum(k, (k, 1, 10, 2))` answered 55 while the equivalent
    // `Sum(k, {k, 1, 10, 2})` answered 25. Mirror the `Set` branch exactly,
    // including its arity guard, so the two spellings are interchangeable.
    const tupleOps = expr.ops;
    if (tupleOps.length > 4) return undefined;
    if (tupleOps.length === 4) {
      let idx = tupleOps[0];
      if (isFunction(idx, 'Hold')) idx = idx.op1;
      if (!isSymbol(idx)) return undefined;
      if (
        idx.symbol !== 'Nothing' &&
        !ce.context.lexicalScope.bindings.has(idx.symbol)
      )
        ce.declare(idx.symbol, 'integer');
      // With a step, use the Range/Element form: `Limits` has no step slot.
      return ce.function('Element', [
        idx.canonical,
        ce.function('Range', [
          tupleOps[1].canonical,
          tupleOps[2].canonical,
          tupleOps[3].canonical,
        ]),
      ]);
    }
    index = expr.op1;
    lower = checkBound(expr.ops[1]?.canonical ?? null);
    upper = checkBound(expr.ops[2]?.canonical ?? null);
  } else index = expr;

  if (isFunction(index, 'Hold')) index = index.op1;

  if (!isSymbol(index)) return undefined;

  if (
    index.symbol !== 'Nothing' &&
    !ce.context.lexicalScope.bindings.has(index.symbol)
  )
    ce.declare(index.symbol, 'integer');

  if (upper && lower) return ce.function('Limits', [index, lower, upper]);
  if (upper) return ce.function('Limits', [index, ce.One, upper]);
  if (lower) return ce.function('Limits', [index, lower]);
  return ce.function('Limits', [index]);
}

export function canonicalBigop(
  bigOp: string,
  body: Expression,
  indexingSets: Expression[],
  scope: Scope | undefined
): Expression | null {
  const ce = body.engine;

  // The scope, its `noAutoDeclare` flag, the push/pop around this handler and
  // the declaration of each index are all provided by the binder hook in
  // `box.ts`: `Sum`/`Product` declare their index operands with
  // `scoped: indexingSetSites(1, 'integer')`. What that buys, beyond deleting
  // this prologue, is that the index is bound in the operator's OWN scope on
  // every route — see `docs/plans/2026-07-26-binder-mechanism-design.md`.
  //
  // A defensive fallback for a caller that did not come through the hook.
  const bigOpScope: Scope = scope ?? {
    parent: ce.context.lexicalScope,
    bindings: new Map(),
  };

  // Canonicalize indexes first: `canonicalIndexingSet` still declares an index
  // the hook did not see (a reshaped operand), and the body may reference it.
  const indexes: Expression[] = indexingSets.map(
    (x) => canonicalIndexingSet(x) ?? ce.error('missing')
  );
  body = body?.canonical ?? ce.error('missing');

  // A function-literal body (e.g. `Sum(n ↦ n, (n, 1, 3))`) is not a valid
  // summand/factor: reducing lambdas produces a mistyped `k·λ`. Reject it with
  // a type error so the big-op stays symbolic rather than silently evaluating
  // to nonsense.
  const bodyType = body.type.type;
  if (typeof bodyType !== 'string' && bodyType.kind === 'signature')
    body = ce.typeError('number', body.type, body);

  // The no-index COLLECTION-REDUCE form: `Sum([1, 2, 3])` is the sum of the
  // collection's elements. Gated on there being no indexing set — an INDEXED
  // big op over a collection-valued body (`Σ_{k=0}^{2} [k, 2]`) is a different
  // operator entirely: it iterates the index and accumulates element-wise
  // (`[0+1+2, 2+2+2]`). Rewriting THAT to `Reduce` silently DISCARDED the
  // indexing set, so `Σ_{k=0}^{2} [k, 2]` answered `k + 2` — the range gone,
  // the bound index leaking out free (Tycho item 121, witness check 5: it is
  // what let a Sum body reach the emitters with its index unbound, hence
  // `NaN + "ab"`).
  if (indexes.length === 0 && body.isCollection) {
    if (bigOp === 'Sum') return ce.expr(['Reduce', body, 'Add', 0]);

    return ce.expr(['Reduce', body, 'Multiply', 1]);
  }

  // A degenerate indexing set (`Σ_{i=d}^{d}`) describes the single point
  // `i = d`, so every term of the operator is the body. When the index does
  // not occur in the body, the set carries no information at all and is
  // dropped; if that leaves none, the operator IS its body — the "identity
  // wrapper" spelling `\sum_{i=d}^{d} f(x)` folds to `f(x)`. Same family as
  // the other generic-symbol folds (`x/x → 1`) done at canonicalization.
  //
  // The occurrence test is by NAME, so a shadowing inner binder of the same
  // name reads as an occurrence and the fold is declined — conservative in
  // the safe direction. A body that DOES use the index keeps its indexing
  // set; the evaluate path reduces it (`degenerateBigOpTerm`).
  const usedIndexes =
    indexes.length === 0
      ? indexes
      : indexes.filter((x) => !isVacuousIndexingSet(x, body, indexes));
  if (usedIndexes.length === 0 && indexes.length > 0) return body;

  return ce._fn(bigOp, [body, ...usedIndexes], { scope: bigOpScope });
}

/**
 * Is this indexing set a degenerate `Limits(i, a, a)` whose index `i` is
 * referenced nowhere? Such a set contributes nothing: it can be dropped from
 * the big operator (see `canonicalBigop`).
 *
 * "Nowhere" means neither in `body` NOR in the bounds of any SIBLING indexing
 * set: `Σ_{i=5}^{5} Σ_{j=i}^{10} j` reads `i` in the second set's lower bound,
 * so dropping the first would strand that `i` free. The sibling test is
 * deliberately conservative — every other set is checked, not just the ones
 * that survive — since a set retained only by this check can itself keep
 * another alive.
 */
function isVacuousIndexingSet(
  set: Expression,
  body: Expression,
  siblings: ReadonlyArray<Expression>
): boolean {
  if (!isFunction(set, 'Limits') || set.ops.length < 3) return false;
  if (!isDegenerateBounds(set.op2, set.op3, true)) return false;
  if (!isSymbol(set.op1)) return false;
  const index = set.op1.symbol;
  if (index === 'Nothing') return true;
  if (body.has(index)) return false;
  for (const other of siblings) {
    if (other === set || !isFunction(other, 'Limits')) continue;
    // Skip the sibling's own index operand: only its BOUNDS can reference us.
    if (other.ops.slice(1).some((bound) => bound.has(index))) return false;
  }
  return true;
}

/**
 * A special symbol used to signal that a BigOp could not be evaluated
 * because the domain is non-enumerable (e.g., infinite set, unknown symbol).
 * When this is returned, the Sum/Product should keep the expression symbolic
 * rather than returning NaN.
 */
export const NON_ENUMERABLE_DOMAIN = Symbol('non-enumerable-domain');

/**
 * A special symbol used to signal that a BigOp has bounds that cannot be
 * enumerated at `number` precision (see `nonEnumerableIndexingSet`). Unlike
 * `NON_ENUMERABLE_DOMAIN` this is NOT a "stay symbolic" outcome: the bounds
 * describe a definite, finite range that the engine simply cannot walk, so
 * the caller must surface an error rather than silently returning a
 * truncated result. Use `bigOpBoundsError()` to build it.
 */
export const NON_ENUMERABLE_BOUNDS = Symbol('non-enumerable-bounds');

/**
 * Build the error expression a Sum/Product returns when `reduceBigOp` reports
 * `NON_ENUMERABLE_BOUNDS`. `indexes` are the raw (un-normalized) indexing set
 * operands, as the evaluate handlers have them.
 */
export function bigOpBoundsError(
  ce: ComputeEngine,
  indexes: ReadonlyArray<Expression>
): Expression {
  const set = nonEnumerableIndexingSet(normalizeIndexingSets(indexes));
  return ce.error([
    'out-of-range',
    `a bound with magnitude at most ${Number.MAX_SAFE_INTEGER}`,
    set ? `${set.lower}..${set.upper}` : 'unknown',
  ]);
}

/**
 * Result type for reduceBigOp that includes reason for failure
 */
export type BigOpResult<T> =
  | { status: 'success'; value: T }
  | { status: 'non-enumerable'; reason: string; domain?: Expression }
  | { status: 'error'; reason: string };

/**
 * Assign a big-op loop index as an EPHEMERAL write: it bumps `_anyVersion`
 * and the index definition's `_writeVersion` (so anything that actually
 * references the index still invalidates), but not `ce._semanticVersion`
 * — an interleaved `Sum`/`Product` evaluation must not invalidate
 * mutation-keyed caches (the `Comprehension` element memo) of expressions
 * that never mention its index (Tycho item 38). Only the assign itself is
 * wrapped: any side effect of evaluating the BODY still bumps normally.
 */
export function assignLoopIndex(
  ce: ComputeEngine,
  index: string,
  value: Expression | number
): void {
  ce._ephemeralWriteDepth += 1;
  try {
    ce.assign(index, value);
  } finally {
    ce._ephemeralWriteDepth -= 1;
  }
}

/**
 * Fold `collection` with `fn`, reporting `NON_ENUMERABLE_DOMAIN` when the
 * collection's iterator DECLINED — it claims to have elements but produced
 * none, so the fold would silently answer the bare initial value (`Sum → 0`).
 *
 * The decline is read off THIS walk rather than probed before it. Probing
 * means enumerating the collection a second time to look for a first element,
 * which re-runs the element callback of a lazy `Map`/`Filter` once more than
 * there are elements; with mutation in the language, that extra run is
 * observable. `enumerationDeclinedAfterWalk` (`library/collections.ts`) turns
 * the element count into the verdict.
 */
function* reduceCollectionOrDecline<T>(
  collection: Expression,
  fn: (acc: T, x: Expression) => T | null,
  initial: T
): Generator<T | undefined, T | typeof NON_ENUMERABLE_DOMAIN | undefined> {
  let walked = 0;
  const result = yield* reduceCollection(
    collection,
    (acc: T, x: Expression) => {
      walked += 1;
      return fn(acc, x);
    },
    initial
  );
  if (enumerationDeclinedAfterWalk(collection, walked))
    return NON_ENUMERABLE_DOMAIN;
  return result;
}

/**
 * The index bindings in force for ONE term of an indexed big operator: each
 * index name with the value `reduceBigOp`/`reduceElementIndexingSets` has
 * just assigned to it, in indexing-set order.
 */
export type BigOpIndexBindings = ReadonlyArray<
  readonly [index: string, value: Expression | number]
>;

/**
 * The per-term step of an indexed big operator (`Sum`/`Product` over `Limits`
 * or `Element` indexing sets): evaluate `body` for the CURRENT index values,
 * which the loop has just assigned, and repair a term that came back with an
 * index still FREE in it.
 *
 * The loop binds each index by ASSIGNMENT (`assignLoopIndex`), so a body
 * whose evaluation reads every index resolves on its own. A body can come
 * back with an index unresolved when a lazy operator inside it holds an
 * operand and then declines: `Which(x < k, k, True, 0)` under `k := 1`
 * evaluates its condition to `x < 1`, finds it undecided, and returns
 * `undefined` — the framework then keeps the ORIGINAL node, so both the
 * condition and the held arm still spell `k` (`If` behaves the same). Every
 * term of `Σ_{k=1}^{3} Which(x < k, k, True, 0)` was therefore the SAME
 * expression, and the sum answered `Which(x < k, 9, True, 0)`: three copies
 * of one arm, `3k` re-evaluated at the last index value, and the bound `k`
 * leaked into the result (measured 2026-08-16; the honest value is
 * `Which(x < 1, 1, True, 0) + Which(x < 2, 2, True, 0) + Which(x < 3, 3,
 * True, 0)`, and that is what this now yields). Substituting the index
 * values into the evaluated term is a no-op for a body that already resolved
 * them — the same repair `comprehensionStream`
 * (`library/control-structures.ts`) applies to each comprehension element,
 * where a captured function literal would otherwise share one `i`.
 *
 * The substitution is BINDER-AWARE (`substituteFreeNames`, on the
 * `rewriteWithBinders` walk): a term whose own binders rebind an index name —
 * a nested `Σ_{k}` inside a held arm — keeps that inner binding, and only the
 * FREE occurrences (the ones the loop's assignment was meant to reach) take
 * the value. Plain `subs` rewrites through binders by name and would capture
 * them.
 *
 * Returns `undefined` — DECLINE, the caller must keep the whole operator
 * symbolic rather than accumulate this term — when the substitution would
 * not be capture-safe in the other direction: a replacement VALUE (an
 * `Element`-domain element can be an arbitrary expression) whose own free
 * symbols collide with a binder inside the term would have those symbols
 * captured once inserted (`k → t` substituted into a held `t ↦ k + t`).
 * Shadow-narrowing cannot repair that, and substituting anyway is a silent
 * wrong value — the same decline the degenerate-bounds substitution applies
 * (`DEGENERATE_CAPTURE_UNSAFE` above). `Limits` indices are plain numbers
 * (no free symbols), so they never decline.
 *
 * Cost note: the `has` screen below runs once per term. For a term that is a
 * number literal — the common case in a large numeric loop — `has` is O(1);
 * it is term-proportional only for symbolic terms, which are exactly the
 * ones the repair exists for.
 */
export function evaluateBigOpTerm(
  body: Expression,
  bindings: BigOpIndexBindings | undefined,
  numericApproximation: boolean | undefined
): Expression | undefined {
  const term = body.evaluate({ numericApproximation });
  if (bindings === undefined || bindings.length === 0) return term;
  const leaked = bindings.filter(([name]) => term.has(name));
  if (leaked.length === 0) return term;
  const ce = body.engine;
  const subs: Record<string, Expression> = {};
  let anyExpressionValue = false;
  for (const [name, value] of leaked) {
    if (typeof value === 'number') subs[name] = ce.number(value);
    else {
      subs[name] = value;
      anyExpressionValue = true;
    }
  }
  // Capture guard (see the doc comment): a replacement value's free symbols
  // must not collide with any binder inside the term. Only expression-valued
  // bindings can trip this, so the binder collection is skipped entirely for
  // the numeric (`Limits`) case.
  if (anyExpressionValue) {
    const binders = collectBinderNames(term);
    if (binders.size > 0)
      for (const name of Object.keys(subs))
        for (const sym of subs[name].symbols)
          if (binders.has(sym)) return undefined;
  }
  const repaired = substituteFreeNames(term, subs);
  return repaired === term ? term : repaired.evaluate({ numericApproximation });
}

/**
 * Replace every FREE occurrence of the names in `subs` by the given value,
 * leaving occurrences bound by a binder inside `expr` (a `Function` literal's
 * parameters, a `Sum`/`Product`/`Block`/… scope) untouched.
 *
 * Built on `rewriteWithBinders` (`boxed-expression/binders.ts`), which owns
 * the three behaviors a hand-rolled walk gets wrong: it tracks shadowing
 * through binder nodes (an occurrence under a binder that rebinds the name is
 * not free and stays), it descends into DICTIONARY values (not function
 * operands, so a plain `ops` recursion never reaches them), and a rebuilt
 * scoped node keeps its original `localScope` and form — a bare
 * `ce.function` rebuild would mint a fresh empty scope, leaving untouched
 * operands bound to the old scope while the node advertises a new one (a
 * `Sum` whose body no longer resolves its index). Returns `expr` itself when
 * nothing was replaced.
 */
function substituteFreeNames(
  expr: Expression,
  subs: Readonly<Record<string, Expression>>
): Expression {
  return rewriteWithBinders(expr, (sym, shadowed) =>
    shadowed?.has(sym.symbol) ? sym : (subs[sym.symbol] ?? sym)
  );
}

/**
 * Process an expression of the form
 * - ['Operator', body, ['Tuple', index1, lower, upper]]
 * - ['Operator', body, ['Tuple', index1, lower, upper], ['Tuple', index2, lower, upper], ...]
 * - ['Operator', body, ['Element', index, collection]]
 * - ['Operator', body]
 * - ['Operator', collection]
 *
 * `fn()` is the processing done on each element
 * Apply the function `fn` to the body of a big operator, according to the
 * indexing sets.
 *
 * Returns either the reduced value, or `typeof NON_ENUMERABLE_DOMAIN` if the
 * domain cannot be enumerated (in which case the expression should remain symbolic).
 */
export function* reduceBigOp<T>(
  body: Expression,
  indexes: ReadonlyArray<Expression>,
  fn: (acc: T, x: Expression, bindings?: BigOpIndexBindings) => T | null,
  initial: T
): Generator<
  T | typeof NON_ENUMERABLE_DOMAIN | typeof NON_ENUMERABLE_BOUNDS | undefined
> {
  // If the body is a collection AND there is no indexing set, reduce it
  // i.e. Sum({1, 2, 3}) = 6.
  //
  // With an indexing set the operator is the INDEXED form and the collection
  // is its summand, accumulated element-wise once per index value
  // (`Σ_{k=0}^{2} [k, 2]` = `[3, 6]`) — the loop below already does that, and
  // does it today for a body that is a list-valued CALL (`Σ_{k} a(k)`, whose
  // `isCollection` is false before evaluation). Reducing here instead
  // discarded the indexing set and left the index free, so the literal-body
  // spelling answered `k + 2` where the call spelling answered `[3, 6]`
  // (Tycho item 121).
  if (indexes.length === 0 && body.isCollection) {
    const collection = body.evaluate();
    // A collection whose iterator declines (e.g. symbolic elements or
    // bounds) would fold to the bare initial value: keep it symbolic.
    return yield* reduceCollectionOrDecline(collection, fn, initial);
  }

  // If there are no indexes, the summation is a constant
  // i.e. Sum(3) = 3
  if (indexes.length === 0) {
    // A body that is not *structurally* a collection may still evaluate to
    // one — e.g. a broadcast chain over a list literal,
    // `Sum(mod(floor(7/2^[0...10]), 2))`. Reduce the value; returning
    // `fn(initial, body)` would fold the broadcast list in whole (`0 + [...]`)
    // and hand back the list unchanged.
    const value = body.evaluate();
    if (value.isCollection) {
      if (value.isFiniteCollection !== true) return NON_ENUMERABLE_DOMAIN;
      return yield* reduceCollectionOrDecline(value, fn, initial);
    }
    // A body that is DEFINITELY collection-typed but carries no value — a
    // symbol declared `list<number>`, or a call whose head returns one — is
    // not the scalar this fall-through assumes. Accumulating it treats the
    // whole collection as one term, so `Sum(L)` answered `0 + L` = `L`, a
    // plausible-looking value that the same expression contradicts once `L`
    // is assigned (`Sum(L)` → 6 for `L := [1,2,3]`). DECLINE instead, which
    // leaves the big op symbolic until the value arrives.
    //
    // Declining is not interchangeable with widening the `isCollection` test
    // above: that would send the valueless body into `reduceCollection`,
    // which walks zero elements and folds to the bare `initial` — `Sum(L)`
    // → 0, a WORSE wrong answer than `L` because it is indistinguishable
    // from a correct sum over an empty collection. This is the same
    // resolution the 2026-08-11 ruling gave `ListFrom`/`SetFrom`/`TupleFrom`
    // for the same operand class.
    if (isValuelessCollectionTyped(value)) return NON_ENUMERABLE_DOMAIN;
    return fn(initial, value) ?? undefined;
  }

  const ce = body.engine;

  // Check for Element-based indexing sets
  const elementSets = indexes.filter((x) => x.operator === 'Element');
  if (elementSets.length > 0) {
    // Handle Element-based indexing sets using extractFiniteDomainWithReason
    // Use the internal generator that returns detailed results
    const gen = reduceElementIndexingSets(body, indexes, fn, initial, true);

    // Properly iterate the generator to capture both yielded values and the
    // return value. Re-yield each intermediate accumulator so a wrapping
    // `run()` / `runAsync()` can enforce the engine deadline *between*
    // iterations. The accumulators are `BoxedExpression` objects; an earlier
    // `typeof result !== 'object'` guard here silently swallowed every one of
    // them, so nothing was ever yielded, a single `gen.next()` ran the whole
    // (possibly 10⁴-term) reduction to completion, and an infinite or
    // expensive domain would hang past the timeout instead of being cancelled.
    let iterResult = gen.next();
    while (!iterResult.done) {
      yield iterResult.value;
      iterResult = gen.next();
    }

    // The final return value is in iterResult.value when done is true
    const finalResult = iterResult.value;

    // Check the final result type
    if (
      finalResult &&
      typeof finalResult === 'object' &&
      'status' in finalResult
    ) {
      const typedResult = finalResult as ReduceElementResult<T>;
      if (typedResult.status === 'success') {
        return typedResult.value;
      }
      if (typedResult.status === 'non-enumerable') {
        // Signal that the domain is non-enumerable
        return NON_ENUMERABLE_DOMAIN;
      }
      // Error case - return undefined (will become NaN)
      return undefined;
    }

    return finalResult as T | undefined;
  }

  //
  // We have one or more Limits indexing sets, i.e. `["Limits", index, lower, upper]`
  // Create a cartesian product of the indexing sets.
  //
  const indexingSets = normalizeIndexingSets(indexes);

  // Bounds beyond the safe-integer range cannot be walked by the odometer
  // below: it would terminate the wheel after a single term, silently
  // truncating a result the caller asked for. Report it so the caller can
  // surface an error instead.
  if (nonEnumerableIndexingSet(indexingSets)) return NON_ENUMERABLE_BOUNDS;

  // @todo: special case when there is only one index

  // Stream the index tuples rather than materializing the whole product: a
  // large *finite* bound (`Σ_{i=1}^{10⁸}`) otherwise exhausted the heap
  // before the first `yield`, so neither `run()`/`runAsync()` nor the
  // deadline below ever got a chance to cancel it.
  const cartesianArray = indexingSetCartesianProductIterator(indexingSets);

  //
  // Iterate over the cartesian product and evaluate the body
  //
  let result: T | undefined = initial;
  let count = 0;
  for (const element of cartesianArray) {
    // `run()`/`runAsync()` enforce the deadline between yields, but
    // `reduceBigOp` is also driven directly (and a single body evaluation can
    // be slow), so check the engine deadline here too. Amortize `Date.now()`
    // with a stride.
    if ((++count & 0xff) === 0) checkDeadline(ce._deadlineFrame);
    // An index-less bounds pair (`Limits(Nothing, 1, 9)`) iterates a constant
    // body: there is no index variable to assign.
    const bindings: Array<readonly [string, number]> = [];
    indexingSets.forEach((x, i) => {
      if (x.index && x.index !== 'Nothing') {
        assignLoopIndex(ce, x.index, element[i]);
        bindings.push([x.index, element[i]]);
      }
    });
    result = fn(result, body, bindings) ?? undefined;
    yield result;
    if (result === undefined) break;
  }

  return result ?? undefined;
}

/**
 * Result type for reduceElementIndexingSets to distinguish between
 * successful evaluation, non-enumerable domains (keep symbolic), and errors.
 */
export type ReduceElementResult<T> =
  | { status: 'success'; value: T }
  | { status: 'non-enumerable'; reason: string; domain?: Expression }
  | { status: 'error'; reason: string };

/**
 * Handle Element-based indexing sets by extracting finite domains
 * and iterating over their values.
 *
 * Returns a detailed result to distinguish between:
 * - Success: domain was enumerated and reduced
 * - Non-enumerable: domain is valid but cannot be enumerated (keep expression symbolic)
 * - Error: invalid indexing expression
 */
function* reduceElementIndexingSets<T>(
  body: Expression,
  indexes: ReadonlyArray<Expression>,
  fn: (acc: T, x: Expression, bindings?: BigOpIndexBindings) => T | null,
  initial: T,
  returnReason = false
  // Yields only accumulator values (`T | undefined`) between iterations; the
  // detailed `ReduceElementResult` classification is delivered as the *return*
  // value. Splitting yield/return types lets `reduceBigOp` re-yield each
  // accumulator (for deadline checks) without widening its own yield type.
): Generator<T | undefined, T | ReduceElementResult<T> | undefined> {
  const ce = body.engine;

  // Separate Element and Limits indexing sets
  const elementDomains: Array<{ variable: string; values: Expression[] }> = [];
  const limitsSets: IndexingSet[] = [];

  for (const idx of indexes) {
    if (idx.operator === 'Element') {
      const domainResult = extractFiniteDomainWithReason(idx, ce);

      if (domainResult.status === 'error') {
        // Invalid indexing expression - return error
        if (returnReason) {
          return {
            status: 'error',
            reason: domainResult.reason,
          } as ReduceElementResult<T>;
        }
        return undefined;
      }

      if (domainResult.status === 'non-enumerable') {
        // EL-4: Check if this is a known infinite integer set that can be
        // converted to Limits form for iteration
        if (
          domainResult.reason === 'infinite-domain' &&
          domainResult.domain &&
          isSymbol(domainResult.domain)
        ) {
          const limits = convertInfiniteSetToLimits(domainResult.domain.symbol);
          if (limits) {
            // Convert to Limits and continue with iteration
            limitsSets.push({
              index: domainResult.variable,
              ...limits,
            });
            continue; // Process next index, don't return early
          }
        }

        // Domain exists but cannot be enumerated - keep expression symbolic
        if (returnReason) {
          return {
            status: 'non-enumerable',
            reason: domainResult.reason,
            domain: domainResult.domain,
          } as ReduceElementResult<T>;
        }
        return undefined;
      }

      // Success - domain was extracted
      elementDomains.push({
        variable: domainResult.variable,
        values: domainResult.values,
      });
    } else {
      limitsSets.push(normalizeIndexingSet(idx));
    }
  }

  // If we have mixed Element and Limits sets, we need to handle both
  if (limitsSets.length > 0) {
    // Mixed case: combine Element domains with Limits ranges
    // Convert Limits to a similar format
    for (const limits of limitsSets) {
      const values: Expression[] = [];
      for (let i = limits.lower; i <= limits.upper; i++) {
        values.push(ce.number(i));
      }
      elementDomains.push({ variable: limits.index!, values });
    }
  }

  // Generate Cartesian product indices
  const indices = elementDomains.map(() => 0);
  const lengths = elementDomains.map((d) => d.values.length);

  // Check for empty domains
  if (lengths.some((l) => l === 0)) {
    if (returnReason) {
      return { status: 'success', value: initial } as ReduceElementResult<T>;
    }
    return initial;
  }

  let result: T | undefined = initial;

  while (true) {
    // Apply current combination of assignments
    const bindings: Array<readonly [string, Expression]> = [];
    for (let i = 0; i < elementDomains.length; i++) {
      const value = elementDomains[i].values[indices[i]];
      assignLoopIndex(ce, elementDomains[i].variable, value);
      bindings.push([elementDomains[i].variable, value]);
    }

    // Evaluate and accumulate
    result = fn(result, body, bindings) ?? undefined;
    yield result;
    if (result === undefined) break;

    // Move to next combination
    let dim = elementDomains.length - 1;
    while (dim >= 0) {
      indices[dim]++;
      if (indices[dim] < lengths[dim]) break;
      indices[dim] = 0;
      dim--;
    }
    if (dim < 0) break; // Exhausted all combinations
  }

  if (returnReason) {
    return { status: 'success', value: result as T } as ReduceElementResult<T>;
  }
  return result ?? undefined;
}
