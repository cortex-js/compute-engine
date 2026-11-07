import type { Expression, RuleStep } from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import { asRational } from '../boxed-expression/numerics.js';
import { add } from '../boxed-expression/arithmetic-add.js';
import { mul } from '../boxed-expression/arithmetic-mul-div.js';
import { isTransitivelyPure } from '../boxed-expression/transitive-purity.js';

/**
 * The inversion identity of the Gauss hypergeometric function for the
 * parameters `(1, a; a + 1)`, applied to the terms of a sum.
 *
 * Write `G_a(z) = ₂F₁(1, a; a + 1; −z)`. For `z > 0`,
 * `G_a(z) = a·z^(−a)·∫_0^z u^(a−1)/(1 + u) du`, and the substitution
 * `u → 1/u` in the integral from `z` to `∞` gives
 *
 * ```
 * G_a(z) = π·a·z^(−a)/sin(πa) − a/(1 − a) · z^(−1) · G_(1−a)(1/z)
 * ```
 *
 * The identity holds for every `a` that is not an integer (both sides are
 * meromorphic in `a`) and every real `z > 0`, where `z^(−a)` is the positive
 * real power.
 *
 * Rubi writes the antiderivative of a rational function such as
 * `(1 + x²)/(x² + x⁹)` with `₂F₁(1, 1/7; 8/7; −x⁷)` and
 * `₂F₁(1, 6/7; 13/7; −x⁷)`. A definite integral from `1/b` to `b` then holds
 * these functions at `−b⁷` and at `−1/b⁷`, and its value is a rational
 * number, but the four hypergeometric terms cancel only when each term at
 * `−b⁷` is written with the argument `−1/b⁷`.
 *
 * The rule rewrites a term `P·₂F₁(1, a; a + 1; w)` of a sum when:
 *
 * - `a` and `w` are exact rational numbers, `a` is not an integer and
 *   `w < −1` (the rewrite goes from the argument outside the unit disk to
 *   the argument inside it, so the two directions never alternate);
 * - the sum also holds a term with `₂F₁(1, 1 − a; 2 − a; 1/w)`, the function
 *   that the rewrite produces, so that the two terms can combine;
 * - the cofactor `P` is pure, because the rewrite copies it into two terms;
 * - the rewritten term, added to its partner terms, is cheaper by
 *   `ce.costFunction` than the term added to its partner terms.
 *
 * The cost check of `simplify()` then compares the rewritten sum with the
 * original sum.
 *
 * `sin(πa)` is written as `±sin(πf)` with `f` in `(0, 1/2]`, so that the
 * terms that come from `a` and from `1 − a` hold the same `sin(πf)` and
 * combine: `sin(6π/7)` is written `sin(π/7)`.
 *
 * IMPORTANT: Do not call .simplify() on the result, to avoid an infinite
 * recursion.
 */
export function simplifyHypergeometricSum(x: Expression): RuleStep | undefined {
  if (!isFunction(x, 'Add')) return undefined;

  const terms = x.ops.map(termFactor);
  if (!terms.some((t) => t !== undefined && t.w[0] < -t.w[1])) return undefined;

  const ce = x.engine;
  let changed = false;
  const result: Expression[] = [];
  for (let i = 0; i < x.ops.length; i++) {
    const t = terms[i];
    // `w < −1`, with a positive denominator. The cofactor is copied into the
    // two terms of the rewrite, so it must be pure: a copy of `Random()`
    // would draw two values where the sum drew one.
    if (
      t === undefined ||
      !(t.w[0] < -t.w[1]) ||
      !isTransitivelyPure(t.cofactor)
    ) {
      result.push(x.ops[i]);
      continue;
    }
    const a = t.a;
    const oneMinusA: BigRational = [a[1] - a[0], a[1]];
    const inverseW = normalized([t.w[1], t.w[0]]);
    const partnerIndexes = terms.flatMap((u, j) =>
      u !== undefined &&
      sameRational(u.a, oneMinusA) &&
      sameRational(u.w, inverseW)
        ? [j]
        : []
    );
    if (partnerIndexes.length === 0) {
      result.push(x.ops[i]);
      continue;
    }

    // z = −w > 1
    const z: BigRational = [-t.w[0], t.w[1]];
    const [sign, f] = reducedSineArgument(a);
    const aExpr = ce.number(a);
    const zExpr = ce.number(z);
    // P · (±π·a·z^(−a)/sin(πf))
    const first = mul(
      t.cofactor,
      ce.number(sign),
      aExpr,
      ce.Pi,
      zExpr.pow(aExpr.neg()).evaluate(),
      ce.function('Sin', [mul(ce.number(f), ce.Pi)]).pow(-1)
    );
    // P · (−a/(1 − a)) · z^(−1) · ₂F₁(1, 1 − a; 2 − a; 1/w). The function is
    // the one of a partner term, with its order of the first two
    // parameters: `₂F₁(1 − a, 1; …)` and `₂F₁(1, 1 − a; …)` are not combined
    // as like terms.
    const second = mul(
      t.cofactor,
      ce.number(normalized([-a[0] * a[1], a[1] * oneMinusA[0]])),
      ce.number([z[1], z[0]]),
      terms[partnerIndexes[0]]!.fn
    );
    // The rewrite of this term is kept only when, with its partner terms, it
    // is cheaper than the term and its partners. Otherwise a family whose
    // terms do not cancel would be rewritten whenever another family in the
    // same sum cancels, and the cost check of the whole sum accepted both.
    const partners = partnerIndexes.map((j) => x.ops[j]);
    const before = ce.costFunction(add(x.ops[i], ...partners));
    const after = ce.costFunction(add(first, second, ...partners));
    if (!(after < before)) {
      result.push(x.ops[i]);
      continue;
    }
    result.push(first, second);
    changed = true;
  }
  if (!changed) return undefined;
  return {
    value: add(...result),
    because: 'hypergeometric 2F1 inversion',
  };
}

/** A rational number as a pair of bigints with a positive denominator. */
type BigRational = [bigint, bigint];

/** A function `fn = ₂F₁(1, a; a + 1; w)`, with its `a` and `w`. */
type Hypergeometric = { fn: Expression; a: BigRational; w: BigRational };

/**
 * When the term `t` of a sum is `P·₂F₁(1, a; a + 1; w)` (or the function
 * alone, or its negation), with `a` and `w` exact rational numbers and `a`
 * not an integer, the cofactor `P` and the function. Otherwise `undefined`. The
 * first two parameters can be in either order: `₂F₁` is symmetric in them.
 */
function termFactor(
  t: Expression
): ({ cofactor: Expression } & Hypergeometric) | undefined {
  const ce = t.engine;
  if (isFunction(t, 'Hypergeometric2F1')) {
    const p = hypergeometricParameters(t);
    return p ? { cofactor: ce.One, ...p } : undefined;
  }
  if (isFunction(t, 'Negate')) {
    if (!isFunction(t.op1, 'Hypergeometric2F1')) return undefined;
    const p = hypergeometricParameters(t.op1);
    return p ? { cofactor: ce.NegativeOne, ...p } : undefined;
  }
  if (!isFunction(t, 'Multiply')) return undefined;
  const index = t.ops.findIndex((f) => isFunction(f, 'Hypergeometric2F1'));
  if (index < 0) return undefined;
  // A product with two such factors is not a linear term in either of them.
  if (t.ops.some((f, i) => i !== index && isFunction(f, 'Hypergeometric2F1')))
    return undefined;
  const p = hypergeometricParameters(t.ops[index]);
  if (!p) return undefined;
  const others = t.ops.filter((_, i) => i !== index);
  return { cofactor: others.length === 1 ? others[0] : mul(...others), ...p };
}

/** The function `₂F₁(1, a; a + 1; w)` with its `a` and `w`, or `undefined`. */
function hypergeometricParameters(f: Expression): Hypergeometric | undefined {
  if (!isFunction(f) || f.nops !== 4) return undefined;
  const [p, q, c, w] = f.ops.map(bigRational);
  if (!p || !q || !c || !w) return undefined;
  const one: BigRational = [1n, 1n];
  let a: BigRational;
  if (sameRational(p, one)) a = q;
  else if (sameRational(q, one)) a = p;
  else return undefined;
  if (a[1] === 1n) return undefined;
  if (!sameRational(c, [a[0] + a[1], a[1]])) return undefined;
  return { fn: f, a, w };
}

/** The value of an exact rational number literal, or `undefined`. */
function bigRational(x: Expression): BigRational | undefined {
  const r = asRational(x);
  if (!r) return undefined;
  return normalized([BigInt(r[0]), BigInt(r[1])]);
}

/** The rational `[n, d]` in lowest terms, with `d > 0`. */
function normalized([n, d]: BigRational): BigRational {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n < 0n ? -n : n, d);
  return [n / g, d / g];
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

function sameRational(a: BigRational, b: BigRational): boolean {
  return a[0] * b[1] === b[0] * a[1];
}

/**
 * For a rational `a` that is not an integer, the sign `s` and the rational
 * `f` in `(0, 1/2]` with `sin(πa) = s·sin(πf)`. With `k = ⌊a⌋`,
 * `sin(πa) = (−1)^k·sin(π(a − k))`, and `sin(πg) = sin(π(1 − g))`.
 */
function reducedSineArgument(a: BigRational): [number, BigRational] {
  const [n, d] = a;
  // Floor division of bigints: `/` truncates toward 0.
  let k = n / d;
  if (n < 0n && k * d !== n) k -= 1n;
  const g: BigRational = [n - k * d, d];
  const f: BigRational = 2n * g[0] > d ? [d - g[0], d] : g;
  return [k % 2n === 0n ? 1 : -1, normalized(f)];
}
