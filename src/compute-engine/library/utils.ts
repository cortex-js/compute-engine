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

import { checkDeadline } from '../../common/interruptible.js';
import { isSubtype } from '../../common/type/subtype.js';
import { MAX_ITERATION } from '../numerics/numeric.js';
import { extrapolate } from '../numerics/richardson.js';
import { reduceCollection, enumerationDeclined } from './collections.js';
import { extractFiniteDomainWithReason } from './logic-analysis.js';
import { isTuple } from '../collection-utils.js';

/**
 * Result type of the Euclidean norm of a fixed-arity point (`Tuple`
 * operand of `Norm`/`Abs`): a scalar, unless a component carries a
 * broadcasting collection — `‖(x+[0.5,1], y)‖` zips into one norm per
 * element, so the honest type is `list<number>`, not `number` (Tycho
 * item 74: a `number`-typed expression evaluating to a `List` breaks
 * consumers that dispatch on the declared type).
 *
 * A tuple-typed component is NOT a broadcasting collection (tuples are
 * indexed collections in the type lattice but bind atomically): the norm
 * of `((3,4), 12)` takes the inner point's norm and stays scalar.
 *
 * A non-literal point (a tuple-TYPED symbol or parameter) has no operands
 * to walk — inspect its declared element types instead, so
 * `p: tuple<list<real>, real>` reports the same `list<number>` its
 * evaluation produces.
 */
export function pointNormType(point: Expression): string {
  if (isFunction(point))
    return point.ops.some(
      (op) => op.type.matches('indexed_collection') && !isTuple(op)
    )
      ? 'list<number>'
      : 'number';
  const t = point.type.type;
  if (
    typeof t !== 'string' &&
    t.kind === 'tuple' &&
    t.elements.some((el) => {
      const et = el.type;
      if (typeof et !== 'string' && et.kind === 'tuple') return false;
      return isSubtype(et, 'indexed_collection');
    })
  )
    return 'list<number>';
  return 'number';
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
    return ce.function('Add', pieces, { structural: true });
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
    assignLoopIndex(ce, index, k);
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

/**
 * Accelerated `.N()` of a convergent infinite product
 * `Π_{k=a}^∞ f(k)`. For positive real factors, accumulate
 * `L(N) = Σ log(f(k))` and Richardson-extrapolate `L(N)` using the same
 * doubling schedule as infinite sums, then return `exp(L(∞))`.
 *
 * Restricting factors to finite positive reals avoids branch/sign ambiguity
 * and makes zero-crossing or oscillatory products fail closed to the existing
 * truncation path.
 */
export function acceleratedInfiniteProduct(
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
  const a = lower.re;
  if (!Number.isSafeInteger(a)) return undefined;

  let invalid = false;
  const logTerm = (k: number): number => {
    assignLoopIndex(ce, index, k);
    const value = body.N();
    if (!isNumber(value) || value.im !== 0 || !(value.re > 0)) {
      invalid = true;
      return NaN;
    }
    return Math.log(value.re);
  };

  const MAX_TERMS = 1 << 15;
  const maxN = a + MAX_TERMS - 1;
  let cachedN = a - 1;
  let cachedLogSum = 0;
  let overflow = false;
  const partialLogSum = (x: number): number => {
    let n = Math.round(x);
    if (n < a) return 0;
    if (n > maxN) {
      n = maxN;
      overflow = true;
    }
    if (n < cachedN) {
      cachedN = a - 1;
      cachedLogSum = 0;
    }
    for (let k = cachedN + 1; k <= n; k++) cachedLogSum += logTerm(k);
    cachedN = n;
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
 * Assign a big-op loop index as an EPHEMERAL write: it bumps `_generation`
 * and the index definition's `_writeVersion` (so anything that actually
 * references the index still invalidates), but not `ce._mutationGeneration`
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
): Generator<
  T | typeof NON_ENUMERABLE_DOMAIN | typeof NON_ENUMERABLE_BOUNDS | undefined
> {
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
  if (indexes.length === 0) {
    // A body that is not *structurally* a collection may still evaluate to
    // one — e.g. a broadcast chain over a list literal,
    // `Sum(mod(floor(7/2^[0...10]), 2))`. Reduce the value; returning
    // `fn(initial, body)` would fold the broadcast list in whole (`0 + [...]`)
    // and hand back the list unchanged.
    const value = body.evaluate();
    if (value.isCollection) {
      if (value.isFiniteCollection !== true) return NON_ENUMERABLE_DOMAIN;
      if (enumerationDeclined(value)) return NON_ENUMERABLE_DOMAIN;
      return yield* reduceCollection(value, fn, initial);
    }
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
    indexingSets.forEach((x, i) => {
      if (x.index && x.index !== 'Nothing')
        assignLoopIndex(ce, x.index, element[i]);
    });
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
      assignLoopIndex(
        ce,
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
