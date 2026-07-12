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

import { MAX_ITERATION } from '../numerics/numeric.js';
import { extrapolate } from '../numerics/richardson.js';
import {
  fromRange,
  reduceCollection,
  enumerationDeclined,
} from './collections.js';
import { extractFiniteDomainWithReason } from './logic-analysis.js';

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
        !(isSymbol(b) && b.symbol === 'Nothing') && Number.isNaN(b.re);
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
 * Attempt a symbolic closed form for `Sum(body, [index, lower, upper])` when the
 * domain is symbolic (free bounds). Currently handles telescoping sums:
 *   Σ_{k=a}^{b} (g(k+1) − g(k)) = g(b+1) − g(a)   (and the mirror orientation).
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
        { structural: true }
      );
    }
    // Σ (t(k) − t(k+1)) = t(a) − t(b+1), where t = pos (so neg = t(k+1)).
    return ce.function(
      'Subtract',
      [pos.subs({ [index]: lower }), neg.subs({ [index]: upper })],
      { structural: true }
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
      : ce.function('Multiply', rest, { structural: true });
  const numExpr = num.isSame(1)
    ? restExpr
    : ce.function('Multiply', [num, restExpr], { structural: true });
  return ce.function('Divide', [numExpr, den], { structural: true });
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
    terms.push(body.subs({ [index]: k }).evaluate().neg());
  return asReadableFraction(ce.function('Add', terms).evaluate(), ce);
}

/**
 * Attempt a closed form for `Sum(body, [index, lower, +∞])` on an infinite
 * upper domain. Handles:
 *   - p-series `Σ_{k=a}^∞ k^{-s} = ζ(s) − Σ_{k=1}^{a−1} k^{-s}`
 *     (exact real `s > 1`, positive-integer `a`);
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
    return ce.function('Add', pieces, { structural: true });
  }

  return pSeriesClosedForm(body, index, lower, ce);
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
  if (!lower.isSame(1)) return undefined;

  // Wallis: Π_{k=1}^∞ (1 − 1/(2k)²) = 2/π. Match the canonicalized body.
  const wallis = ce.box([
    'Subtract',
    1,
    ['Divide', 1, ['Power', ['Multiply', 2, index], 2]],
  ]);
  if (wallis.isSame(body)) return ce.function('Divide', [ce.number(2), ce.Pi]);

  return undefined;
}

/**
 * Accelerated `.N()` of a convergent infinite sum `Σ_{k=a}^∞ f(k)`.
 *
 * A plain truncation of a smooth monotone-decay series is off by ~ the tail
 * `∫_N^∞ f` (e.g. `Σ 1/k²` truncated at 10⁴ terms is ~1e-4 low). Instead we
 * Richardson-extrapolate the partial sums `S(N) → S(∞)`: the sequence
 * `S(1), S(2), S(4), …, S(2ᵐ)` (exact doubling, so every sample index is an
 * exact integer) has an asymptotic expansion in `1/N` that the Neville tableau
 * eliminates term by term, reaching near machine precision from ~2⁹ evaluated
 * terms.
 *
 * Returns undefined — so the caller falls back to plain truncation — when the
 * domain isn't a single `[index, finite, +∞]` range, the body isn't
 * real-numeric, or the extrapolation does not converge within the evaluation
 * budget (divergent or slowly/non-smoothly decaying series, e.g. a half-integer
 * p-series whose expansion is not in integer powers of `1/N`).
 */
export function acceleratedInfiniteSum(
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
  const a = Math.round(lower.re);
  if (!Number.isFinite(a)) return undefined;

  // Numeric value of the body at integer index `k` (real series only).
  const term = (k: number): number => {
    ce.assign(index, k);
    const v = body.N();
    if (!isNumber(v) || v.im !== 0) return NaN;
    return v.re;
  };

  // Partial sum S(N) = Σ_{k=a}^{N} f(k), accumulated across the strictly
  // increasing (doubling) schedule `extrapolate` samples. Bound total work: on
  // overflow the sequence stops changing, which would masquerade as
  // convergence, so record it and reject below.
  // Cap total term evaluations near the plain-truncation budget: convergent
  // smooth series reach machine precision from ~2¹⁰ terms, well under this,
  // while a divergent/non-converging series stops here, trips `overflow`, and
  // is rejected below (caller falls back to truncation) without a runaway grind.
  const MAX_TERMS = 1 << 15; // 32768
  let cachedN = a - 1;
  let cachedSum = 0;
  let overflow = false;
  const partialSum = (x: number): number => {
    let n = Math.round(x);
    if (n < a) return 0;
    if (n > MAX_TERMS) {
      n = MAX_TERMS;
      overflow = true;
    }
    // The schedule is monotone increasing; guard defensively anyway.
    if (n < cachedN) {
      cachedN = a - 1;
      cachedSum = 0;
    }
    for (let k = cachedN + 1; k <= n; k++) cachedSum += term(k);
    cachedN = n;
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

  if (overflow || !Number.isFinite(val)) return undefined;
  // Require genuine convergence (a divergent or non-smooth series stalls with a
  // large error estimate) before trusting the accelerated value.
  if (!(err <= Math.max(1e-10, 1e-9 * Math.abs(val)))) return undefined;
  return ce.number(val);
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
  lower = Math.floor(fn.op2.re);
  if (isNaN(lower)) lower = 1;

  if (!Number.isFinite(lower)) isFinite = false;

  const op3 = fn.op3;
  const op3Sym = isSymbol(op3) ? op3.symbol : undefined;
  if (op3Sym === 'Nothing' || op3.isInfinity) {
    isFinite = false;
    upper = Infinity;
  } else {
    if (!isNaN(op3.re)) upper = Math.floor(op3.re ?? upper);
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

export function indexingSetCartesianProduct(
  indexingSets: IndexingSet[]
): number[][] {
  console.assert(indexingSets.length > 0, 'Indexing sets must not be empty');

  //
  // Start with the first index
  //
  const { index: _index, lower, upper: upper0, isFinite } = indexingSets[0];
  const upper = !isFinite ? lower + MAX_ITERATION : upper0;
  let result = fromRange(lower, upper).map((x) => [x]);

  // We had a single index, we're done
  if (indexingSets.length === 1) return result;

  //
  // We have multiple indexes
  //
  for (let i = 1; i < indexingSets.length; i++) {
    const { index: _index2, lower, upper: upperI, isFinite } = indexingSets[i];
    const upper = !isFinite ? lower + MAX_ITERATION : upperI;

    result = cartesianProduct(
      result.map((x) => x[0]),
      fromRange(lower, upper)
    );
  }
  return result;
}

/**
 * Calculates the cartesian product of two arrays.
 * ```ts
 * // Example usage
 * const array1 = [1, 2, 3];
 * const array2 = ['a', 'b', 'c'];
 * const result = cartesianProduct(array1, array2);
 * console.log(result);
 * // Output: [[1, 'a'], [1, 'b'], [1, 'c'], [2, 'a'], [2, 'b'], [2, 'c'], [3, 'a'], [3, 'b'], [3, 'c']]
 * ```
 * @param array1 - The first array.
 * @param array2 - The second array.
 * @returns The cartesian product as a 2D array.
 */
export function cartesianProduct(
  array1: number[],
  array2: number[]
): number[][] {
  return array1.flatMap((item1) => array2.map((item2) => [item1, item2]));
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
      result.push(canonicalLimits(fnOp.ops, options) ?? ce.error('missing'));
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
    if (indexExpr.symbol !== 'Nothing') ce.declare(indexExpr.symbol, 'integer');
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

  if (
    expr.operator === 'Tuple' ||
    expr.operator === 'Triple' ||
    expr.operator === 'Pair' ||
    expr.operator === 'Single'
  ) {
    if (!isFunction(expr)) return undefined;
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

  // Always ensure we have a concrete scope object so we can set noAutoDeclare
  // and pass it to ce._fn at the end (for localScope tracking).
  const bigOpScope: Scope = scope ?? {
    parent: ce.context.lexicalScope,
    bindings: new Map(),
  };

  // Set noAutoDeclare so auto-declarations of free variables (M, x) in the
  // bounds and body are promoted to the enclosing scope instead of the BigOp
  // scope. Explicit ce.declare() calls (used for index variable declaration)
  // are not affected by noAutoDeclare — they always go to the target scope
  // passed in. canonicalIndexingSet now calls ce.declare(index, 'integer')
  // before canonicalizing bounds, so the index lands in BigOpScope correctly.
  bigOpScope.noAutoDeclare = true;

  // Push BigOp scope for both index and body canonicalization.
  // canonicalIndexingSet explicitly declares the index variable (k) in the
  // current (BigOp) scope before canonicalizing bounds, so k correctly lands
  // in BigOpScope even though noAutoDeclare is set.
  // Free variables in the bounds and body (M, x) are promoted to the enclosing
  // scope via noAutoDeclare. noAutoDeclare is always cleared in the finally
  // block so the scope behaves normally during evaluation (where ce.assign
  // needs to work).
  ce.pushScope(bigOpScope);
  let indexes: Expression[];
  try {
    // Canonicalize indexes first to declare the index variable before
    // canonicalizing the body (the body may reference the index).
    indexes = indexingSets.map(
      (x) => canonicalIndexingSet(x) ?? ce.error('missing')
    );
    body = body?.canonical ?? ce.error('missing');
  } finally {
    ce.popScope();
    bigOpScope.noAutoDeclare = false;
  }

  // A function-literal body (e.g. `Sum(n ↦ n, (n, 1, 3))`) is not a valid
  // summand/factor: reducing lambdas produces a mistyped `k·λ`. Reject it with
  // a type error so the big-op stays symbolic rather than silently evaluating
  // to nonsense.
  const bodyType = body.type.type;
  if (typeof bodyType !== 'string' && bodyType.kind === 'signature')
    body = ce.typeError('number', body.type, body);

  if (body.isCollection) {
    if (bigOp === 'Sum') return ce.expr(['Reduce', body, 'Add', 0]);

    return ce.expr(['Reduce', body, 'Multiply', 1]);
  }

  return ce._fn(bigOp, [body, ...indexes], { scope: bigOpScope });
}

/**
 * A special symbol used to signal that a BigOp could not be evaluated
 * because the domain is non-enumerable (e.g., infinite set, unknown symbol).
 * When this is returned, the Sum/Product should keep the expression symbolic
 * rather than returning NaN.
 */
export const NON_ENUMERABLE_DOMAIN = Symbol('non-enumerable-domain');

/**
 * Result type for reduceBigOp that includes reason for failure
 */
export type BigOpResult<T> =
  | { status: 'success'; value: T }
  | { status: 'non-enumerable'; reason: string; domain?: Expression }
  | { status: 'error'; reason: string };

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
  fn: (acc: T, x: Expression) => T | null,
  initial: T
): Generator<T | typeof NON_ENUMERABLE_DOMAIN | undefined> {
  // If the body is a collection, reduce it
  // i.e. Sum({1, 2, 3}) = 6
  if (body.isCollection) {
    const collection = body.evaluate();
    // A collection whose iterator declines (e.g. symbolic elements or
    // bounds) would fold to the bare initial value: keep it symbolic.
    if (enumerationDeclined(collection)) return NON_ENUMERABLE_DOMAIN;
    return yield* reduceCollection(collection, fn, initial);
  }

  // If there are no indexes, the summation is a constant
  // i.e. Sum(3) = 3
  if (indexes.length === 0) return fn(initial, body) ?? undefined;

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

  // @todo: special case when there is only one index

  const cartesianArray = indexingSetCartesianProduct(indexingSets);

  //
  // Iterate over the cartesian product and evaluate the body
  //
  let result: T | undefined = initial;
  for (const element of cartesianArray) {
    indexingSets.forEach((x, i) => ce.assign(x.index!, element[i]));
    result = fn(result, body) ?? undefined;
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
  fn: (acc: T, x: Expression) => T | null,
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
    for (let i = 0; i < elementDomains.length; i++) {
      ce.assign(
        elementDomains[i].variable,
        elementDomains[i].values[indices[i]]
      );
    }

    // Evaluate and accumulate
    result = fn(result, body) ?? undefined;
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
