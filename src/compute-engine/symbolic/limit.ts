import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { differentiate } from './derivative.js';
import {
  polynomialDegree,
  getPolynomialCoefficients,
} from '../boxed-expression/polynomials.js';
import { reduceTransformerHead } from '../boxed-expression/utils.js';
import { laurentData } from './series.js';
import { limit as numericLimit } from '../numerics/numeric.js';
import {
  checkDeadline,
  CancellationError,
} from '../../common/interruptible.js';

// The base `Expression` type exposes operands only after a type-guard narrows it
// to a function (`isFunction`). Internally we always hold real boxed expressions
// whose `op1`/`op2`/`op3`/`ops` getters are always present (returning `Nothing`
// / `[]` for non-functions), so read them through these thin typed accessors.
const o1 = (e: Expression): Expression =>
  (e as unknown as { op1: Expression }).op1;
const o2 = (e: Expression): Expression =>
  (e as unknown as { op2: Expression }).op2;
const oo = (e: Expression): ReadonlyArray<Expression> =>
  (e as unknown as { ops: ReadonlyArray<Expression> | null }).ops ?? [];

/**
 * Symbolic limit evaluation.
 *
 * A best-effort *symbolic* companion to the numeric (Richardson) limit path:
 * given the body of a `Limit`, it tries to produce an **exact closed form**
 * (`lim_{x→2} x²+1 = 5`, `lim_{x→0} sin x/x = 1`, `lim_{x→∞} (3ˣ+5ˣ)^{1/x} = 5`).
 * It returns `undefined` whenever it cannot determine the limit, so the caller
 * falls back to the numeric path — the symbolic path is purely additive and
 * cannot regress existing behavior.
 *
 * Strategies, in rough order of application:
 *  - constant (body free of the variable);
 *  - finite point: direct substitution (continuous case), then algebraic
 *    cancellation, then L'Hôpital for 0/0 and ∞/∞ (reuses `differentiate`);
 *  - infinite point: a "leading-order" rewrite that replaces every sum with its
 *    asymptotically-dominant term(s) (a Gruntz-lite — `3ˣ+5ˣ → 5ˣ`,
 *    `sin x+ln x → ln x`), then a structural evaluation of the simplified form
 *    (polynomial/rational growth, exp/ln, products, `f^g` via `exp(g·ln f)`,
 *    bounded `sin`/`cos`/`arctan`).
 *
 * @param body     the function body, e.g. `Divide(Sin(x), x)`
 * @param x        the limit variable name
 * @param point    the limit point (a number, or ±∞)
 * @param dir      +1 (from the right), −1 (from the left), 0/undefined (both)
 */
export function symbolicLimit(
  body: Expression,
  x: string,
  point: Expression,
  dir: number | undefined,
  ce: ComputeEngine
): Expression | undefined {
  try {
    // A `Function` literal wraps its body in a `Block` (`(x) ↦ {body}`); unwrap
    // it so the structural strategies see the actual operator (Divide, Power…).
    let b = body;
    while (b.operator === 'Block' && oo(b)?.length === 1) b = o1(b);

    // A transformer head (`Limit(Simplify(f), …)`, e.g. from the pipeline
    // `f |> Simplify |> Limit`) is a computation step: reduce it so the
    // structural strategies see the transformed expression rather than an
    // opaque `Simplify` node.
    b = reduceTransformerHead(b);

    // Soundness guard for special-function poles. The structural strategies
    // (notably direct substitution) don't model the poles of Gamma/Digamma/…,
    // so `(x+1)·Digamma(x)` at -1 substitutes `Digamma(-1)` as a finite symbol
    // and returns a WRONG 0. If a special function provably blows up at the
    // finite limit point, resolve the limit from the exact Laurent expansion
    // about the point instead (item 7c: the constant term is exactly the
    // quantity a leading-term rewrite gets wrong — `lim_{x→0} Gamma(x) − 1/x
    // = −γ`, not 0). When the Laurent kernel declines (branch point,
    // essential singularity, exhausted window) or the expansion has a pole
    // (negative valuation), defer (return undefined) so the caller falls back
    // rather than risk a wrong value — two-sided pole limits stay inert
    // engine-wide (`lim 1/x²` at 0), and this path keeps that convention.
    // Detection uses the pole-aware `N()` store (item 7), so it covers any
    // argument that lands on a pole.
    if (point.isFinite === true && b.has(SPECIAL_POLE_FNS)) {
      for (const fn of SPECIAL_POLE_FNS) {
        for (const s of b.getSubexpressions(fn)) {
          const at = s.subs({ [x]: point }).N();
          if (at.isNaN === true || at.isFinite !== true) {
            // W = 3: only the constant term is consulted, and the kernel
            // deepens internally where a denominator demands it.
            const L = laurentData(b, x, point, ce, 3);
            if (L && L.v > 0) return ce.Zero;
            if (L && L.v === 0) {
              const c0 = L.coeff(0).evaluate();
              if (c0.isValid && c0.isNaN !== true) return c0;
            }
            return undefined;
          }
        }
      }
    }

    const r = limitDispatch(b, x, point, dir ?? 0, ce, 0);
    if (r === undefined) return undefined;
    if (r.isNaN === true) return undefined;
    return r;
  } catch (e) {
    // A deadline/interrupt must unwind to the public evaluate boundary rather
    // than be swallowed as "couldn't determine the limit" (which would then
    // launch the numeric fallback and blow the budget a second time). Only
    // genuine internal errors are absorbed into an `undefined` (defer) result.
    if (e instanceof CancellationError) throw e;
    return undefined;
  }
}

// Special functions whose poles the structural limit strategies don't model.
// Elementary functions (ln, sin, …) are handled by the dispatch and excluded —
// listing them here would needlessly defer limits like `lim x·ln x`.
const SPECIAL_POLE_FNS = [
  'Gamma',
  'Digamma',
  'Trigamma',
  'PolyGamma',
  'Zeta',
  'Beta',
  'GammaLn',
];

const MAX_DEPTH = 14;

function limitDispatch(
  e: Expression,
  x: string,
  point: Expression,
  dir: number,
  ce: ComputeEngine,
  depth: number
): Expression | undefined {
  if (depth > MAX_DEPTH) return undefined;
  // The symbolic recursion (leading-order rewrites, L'Hôpital differentiation of
  // exp/log towers, numeric growth probes) can grind for many minutes on hard
  // Gruntz-class limits. Bound it by the engine evaluation deadline: the throw
  // unwinds to the public boundary, which returns the inert `Limit` form.
  checkDeadline(ce._deadline);
  if (!e.has(x)) return e.evaluate();

  if (point.isInfinity === true) {
    // Map x → −∞ onto x → +∞ via the substitution x ↦ −x.
    let g = point.isNegative === true ? e.subs({ [x]: ce.symbol(x).neg() }) : e;
    // Combine cancellation-prone `ln`/`√` differences BEFORE any leading-order
    // or growth ranking: co-dominant pairs like `ln(x+1) − ln x` (~1/x) defeat
    // the asymptotic pass, which ranked them by their (cancelling) leading
    // terms and produced wrong finite limits — `x·(ln(x+1) − ln x)` → 0
    // instead of 1 (CORRECTNESS_FINDINGS P0-3). The combined forms
    // (`ln((x+1)/x)`, conjugate quotients) are handled exactly by the
    // existing strategies.
    g = combineCancellingPairs(g, x, ce);
    // Bail *before* simplify (which can distribute and mangle the structure) if
    // any subexpression cancels catastrophically or overflows at the probes —
    // the symbolic pass can't rank such a form, so defer to the numeric limit.
    if (numericallyUnstable(g, x, ce, 0)) return undefined;
    // `simplify` is otherwise helpful at infinity (the leading-order rewrite
    // handles sums); at a finite point it can distribute a quotient into a sum
    // and defeat L'Hôpital, so the finite path keeps the structure instead.
    return limitAtPosInf(g.simplify(), x, ce, depth);
  }

  return limitAtFinite(e, x, point, dir, ce, depth);
}

// ──────────────────────────────────────────────────────────────────────────
// Finite point
// ──────────────────────────────────────────────────────────────────────────

function limitAtFinite(
  e: Expression,
  x: string,
  a: Expression,
  dir: number,
  ce: ComputeEngine,
  depth: number
): Expression | undefined {
  // 1. Direct substitution (continuous case).
  const direct = e.subs({ [x]: a }).evaluate();
  if (isDefiniteValue(direct, x)) return direct;

  // 1b. Fallback: a simplified form may cancel a removable singularity
  //     ((x²−1)/(x−1) → x+1) — try substituting into it too.
  const es = e.simplify();
  if (!es.isSame(e)) {
    const direct2 = es.subs({ [x]: a }).evaluate();
    if (isDefiniteValue(direct2, x)) return direct2;
  }

  // 2. L'Hôpital for a quotient that is 0/0 or ∞/∞ (use the original structure,
  //    which preserves the quotient that `simplify` would distribute away).
  const ratio = asRatio(e, ce);
  if (ratio) {
    const n0 = limitDispatch(ratio.num, x, a, dir, ce, depth + 1);
    const d0 = limitDispatch(ratio.den, x, a, dir, ce, depth + 1);
    if (n0 && d0 && isIndeterminateRatio(n0, d0)) {
      const dn = differentiate(ratio.num, x);
      const dd = differentiate(ratio.den, x);
      if (dn && dd) {
        const next = ce.function('Divide', [dn, dd]);
        return limitAtFinite(next, x, a, dir, ce, depth + 1);
      }
    }
    // Determinate quotient: n0 / d0 when d0 ≠ 0 and both finite.
    if (
      n0 &&
      d0 &&
      !d0.is(0) &&
      isDefiniteValue(n0, x) &&
      isDefiniteValue(d0, x)
    )
      return n0.div(d0).evaluate();
  }

  return undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// Infinite point (x → +∞)
// ──────────────────────────────────────────────────────────────────────────

function limitAtPosInf(
  e0: Expression,
  x: string,
  ce: ComputeEngine,
  depth: number
): Expression | undefined {
  if (depth > MAX_DEPTH) return undefined;
  checkDeadline(ce._deadline);
  // Rewrite to leading asymptotic order (drop negligible additive terms), which
  // often collapses the expression to something a structural pass can finish.
  const e = leadingOrder(e0, x, ce, depth).simplify();
  if (!e.has(x)) return e.evaluate();

  // Polynomial in x → signed infinity by leading coefficient.
  const deg = polynomialDegree(e, x);
  if (deg > 0) {
    const coeffs = getPolynomialCoefficients(e, x);
    const lead = coeffs?.[deg];
    if (lead)
      return lead.isNegative === true
        ? ce.NegativeInfinity
        : ce.PositiveInfinity;
  }

  const op = e.operator;

  if (op === 'Negate') {
    const l = limitAtPosInf(o1(e), x, ce, depth + 1);
    if (!l) return undefined;
    if (l.isInfinity === true)
      return l.isNegative === true ? ce.PositiveInfinity : ce.NegativeInfinity;
    if (isDefiniteValue(l)) return l.neg().evaluate();
    return undefined;
  }

  if (op === 'Add') {
    // After the leading-order rewrite the surviving terms are co-dominant
    // (e.g. 1/x + 1/x², both → 0); sum their individual limits.
    let acc: Expression = ce.Zero;
    let posInf = 0;
    let negInf = 0;
    for (const t of oo(e)) {
      const l = limitAtPosInf(t, x, ce, depth + 1);
      if (!l) return undefined;
      if (l.isInfinity === true) {
        if (l.isNegative === true) negInf++;
        else posInf++;
      } else if (isDefiniteValue(l)) acc = acc.add(l);
      else return undefined;
    }
    if (posInf > 0 && negInf > 0) return undefined; // ∞ − ∞ (needs cancellation)
    if (posInf > 0) return ce.PositiveInfinity;
    if (negInf > 0) return ce.NegativeInfinity;
    return acc.evaluate();
  }

  if (op === 'Divide') return limitRatioAtPosInf(o1(e), o2(e), x, ce, depth);

  if (op === 'Power') return limitPowerAtPosInf(o1(e), o2(e), x, ce, depth);

  if (op === 'Exp') {
    const inner = limitAtPosInf(o1(e), x, ce, depth + 1);
    return expOfLimit(inner, ce);
  }

  if (op === 'Ln' || op === 'Log') {
    const inner = limitAtPosInf(o1(e), x, ce, depth + 1);
    return lnOfLimit(inner, ce);
  }

  if (op === 'Multiply') return limitProductAtPosInf(oo(e), x, ce, depth);

  if (op === 'Arctan') {
    const inner = limitAtPosInf(o1(e), x, ce, depth + 1);
    if (inner?.isInfinity === true)
      return inner.isNegative === true ? ce.Pi.div(-2) : ce.Pi.div(2);
    if (inner && isDefiniteValue(inner))
      return ce.function('Arctan', [inner]).evaluate();
    return undefined;
  }

  if (op === 'Sin' || op === 'Cos' || op === 'Tan') {
    const inner = limitAtPosInf(o1(e), x, ce, depth + 1);
    if (inner && isDefiniteValue(inner))
      return ce.function(op, [inner]).evaluate();
    return undefined; // oscillatory
  }

  if (op === 'Tanh') {
    const inner = limitAtPosInf(o1(e), x, ce, depth + 1);
    if (inner?.isInfinity === true)
      return inner.isNegative === true ? ce.number(-1) : ce.One;
    if (inner && isDefiniteValue(inner))
      return ce.function('Tanh', [inner]).evaluate();
    return undefined;
  }

  return undefined;
}

function limitRatioAtPosInf(
  num: Expression,
  den: Expression,
  x: string,
  ce: ComputeEngine,
  depth: number
): Expression | undefined {
  checkDeadline(ce._deadline);
  // Bail on a numerator/denominator that suffers catastrophic cancellation or
  // overflow at the probe points (e.g. e^stuff − eˣ, whose huge terms cancel to
  // a far smaller value): neither the asymptotic nor the numeric pass can rank
  // it reliably, so defer to the numeric limit (which has its own guard).
  if (hasCancellation(num, x, ce) || hasCancellation(den, x, ce))
    return undefined;

  const n = leadingOrder(num, x, ce, depth).simplify();
  const d = leadingOrder(den, x, ce, depth).simplify();

  // Compare growth *first*. (Simplifying the quotient first can re-expand it
  // back into the original product and loop — e.g. x/(1/ln(1+a/x)).)
  const cmp = compareGrowth(n, d, x, ce);
  if (cmp !== undefined) {
    if (cmp < 0) return ce.Zero; // numerator grows slower → 0
    if (cmp > 0) {
      const s = leadingSign(n, x, ce) * leadingSign(d, x, ce);
      return s < 0 ? ce.NegativeInfinity : ce.PositiveInfinity;
    }
    // Same growth order → ratio of leading coefficients.
    const r = n.div(d).simplify();
    if (!r.has(x)) return r.evaluate();
    return leadingCoefficientRatio(n, d, x, ce);
  }

  // Growth comparison inconclusive: a genuine 0/0 or ∞/∞ that the asymptotic
  // pass couldn't rank → L'Hôpital (differentiate top and bottom, recurse).
  if (depth < MAX_DEPTH) {
    const dn = differentiate(n, x);
    const dd = differentiate(d, x);
    if (dn && dd && !dd.is(0)) {
      const lh = limitRatioAtPosInf(dn, dd, x, ce, depth + 1);
      if (lh) return lh;
    }
  }
  return undefined;
}

function limitPowerAtPosInf(
  base: Expression,
  expo: Expression,
  x: string,
  ce: ComputeEngine,
  depth: number
): Expression | undefined {
  const baseHasX = base.has(x);
  const expoHasX = expo.has(x);

  // Constant exponent: bⁿ.
  if (!expoHasX) {
    const b = limitAtPosInf(base, x, ce, depth + 1);
    if (!b) return undefined;
    if (b.isInfinity === true) {
      if (expo.isPositive === true) return ce.PositiveInfinity;
      if (expo.isNegative === true) return ce.Zero;
      return undefined;
    }
    if (isDefiniteValue(b)) return ce.function('Power', [b, expo]).evaluate();
    return undefined;
  }

  // Constant base: cˣ.
  if (!baseHasX) {
    if (base.isGreater?.(ce.One) === true) {
      // > 1: cˣ → ±∞ depending on the exponent's limit
      const el = limitAtPosInf(expo, x, ce, depth + 1);
      if (el?.isInfinity === true)
        return el.isNegative === true ? ce.Zero : ce.PositiveInfinity;
    }
  }

  // General fᵍ → exp(g · ln f), provided the base is eventually positive.
  if (
    base.isNonNegative === true ||
    base.isPositive === true ||
    baseEventuallyPositive(base, x, ce)
  ) {
    const g = expo.mul(ce.function('Ln', [base]));
    const inner = limitAtPosInf(g, x, ce, depth + 1);
    const r = expOfLimit(inner, ce);
    if (r) return r;
  }
  return undefined;
}

function limitProductAtPosInf(
  factors: ReadonlyArray<Expression>,
  x: string,
  ce: ComputeEngine,
  depth: number
): Expression | undefined {
  // Move every decaying factor (→ 0) into a denominator as its reciprocal, then
  // evaluate the resulting quotient — this resolves the 0·∞ race directly
  // (x·e^{−x} → x/eˣ → 0) via the growth comparison in `limitRatioAtPosInf`.
  const numer: Expression[] = [];
  const denom: Expression[] = [];
  for (const f of factors) {
    const l = limitAtPosInf(f, x, ce, depth + 1);
    if (l && l.is(0)) denom.push(ce.function('Power', [f, ce.number(-1)]));
    else numer.push(f);
  }
  if (denom.length > 0) {
    const num =
      numer.length === 0
        ? ce.One
        : numer.length === 1
          ? numer[0]
          : ce.function('Multiply', numer);
    const den = denom.length === 1 ? denom[0] : ce.function('Multiply', denom);
    return limitRatioAtPosInf(num, den, x, ce, depth + 1);
  }

  // No decaying factors: a straightforward product of the factor limits.
  let result: Expression = ce.One;
  let infinities = 0;
  let infinitySign = 1;
  for (const f of factors) {
    const l = limitAtPosInf(f, x, ce, depth + 1);
    if (!l) return undefined;
    if (l.isInfinity === true) {
      infinities++;
      if (l.isNegative === true) infinitySign = -infinitySign;
    } else if (isDefiniteValue(l)) {
      result = result.mul(l);
    } else return undefined;
  }
  if (infinities > 0) {
    const s = (result.isNegative === true ? -1 : 1) * infinitySign;
    return s < 0 ? ce.NegativeInfinity : ce.PositiveInfinity;
  }
  return result.evaluate();
}

// ──────────────────────────────────────────────────────────────────────────
// Leading-order rewrite + growth ordering (Gruntz-lite)
// ──────────────────────────────────────────────────────────────────────────

/** Replace every sum in `e` with its asymptotically-dominant term(s). */
function leadingOrder(
  e: Expression,
  x: string,
  ce: ComputeEngine,
  depth: number
): Expression {
  if (depth > MAX_DEPTH || !e.has(x)) return e;
  checkDeadline(ce._deadline);
  const op = e.operator;

  if (op === 'Add') {
    const terms = oo(e).map((t) => leadingOrder(t, x, ce, depth + 1));
    const dom = dominantTerms(terms, x, ce);
    // Only drop dominated terms when the dominant one is *unbounded*. If the sum
    // tends to a finite constant (1 + 1/x → 1), the vanishing terms are
    // essential to any function applied to it — ln(1+1/x) ~ 1/x, not ln(1) = 0.
    if (
      dom.length < terms.length &&
      dom.some((t) => tendsToInfinity(t, x, ce) === true)
    )
      return dom.length === 1 ? dom[0] : ce.function('Add', dom);
    return terms.length === 1 ? terms[0] : ce.function('Add', terms);
  }

  if (oo(e) && oo(e).length > 0) {
    const newOps = oo(e).map((o) => leadingOrder(o, x, ce, depth + 1));
    return ce.function(op, newOps);
  }
  return e;
}

/** From a list of terms, return those of maximal growth as x → +∞ (ties kept). */
function dominantTerms(
  terms: ReadonlyArray<Expression>,
  x: string,
  ce: ComputeEngine
): Expression[] {
  if (terms.length <= 1) return [...terms];
  let best = [terms[0]];
  for (let i = 1; i < terms.length; i++) {
    const c = compareGrowth(terms[i], best[0], x, ce);
    if (c === undefined) return [...terms]; // can't order → keep everything (safe)
    if (c > 0) best = [terms[i]];
    else if (c === 0) best.push(terms[i]);
  }
  return best;
}

/**
 * Compare the growth of `a` and `b` as x → +∞.
 * Returns 1 (a faster), −1 (a slower), 0 (same order), or undefined (unknown).
 *
 * Uses a coarse *symbolic* growth level (bounded < log < poly < exp < …) to
 * settle cross-class comparisons — moderate-x numeric probing cannot see, for
 * instance, that eˣ overtakes x¹⁰⁰ (their crossover is near x ≈ 700) and would
 * wrongly rank x¹⁰⁰ higher. Within the same level (3ˣ vs 5ˣ, x² vs x³) numeric
 * probing is reliable, so it decides those.
 */
function compareGrowth(
  a: Expression,
  b: Expression,
  x: string,
  ce: ComputeEngine
): number | undefined {
  const la = growthLevel(a, x, ce, 0);
  const lb = growthLevel(b, x, ce, 0);
  if (la !== undefined && lb !== undefined && la !== lb)
    return la < lb ? -1 : 1;
  return numericGrowthCompare(a, b, x, ce);
}

/**
 * Coarse order-of-growth level of `e` as x → +∞:
 * 0 bounded/decaying · 1 logarithmic · 2 polynomial · 3 exponential ·
 * 4+ iterated exponential. `undefined` when the form can't be classified
 * symbolically (the caller then falls back to numeric probing).
 */
function growthLevel(
  e: Expression,
  x: string,
  ce: ComputeEngine,
  depth: number
): number | undefined {
  if (depth > MAX_DEPTH) return undefined;
  checkDeadline(ce._deadline);
  if (!e.has(x)) return 0;
  const op = e.operator;

  if (
    op === 'Sin' ||
    op === 'Cos' ||
    op === 'Arctan' ||
    op === 'Arccot' ||
    op === 'Tanh'
  )
    return 0;

  const deg = polynomialDegree(e, x);
  if (deg > 0) return 2;
  if (deg === 0) return 0;

  if (op === 'Negate') return growthLevel(o1(e), x, ce, depth + 1);

  if (op === 'Ln' || op === 'Log') {
    const gl = growthLevel(o1(e), x, ce, depth + 1);
    if (gl === undefined || gl <= 0) return undefined;
    return gl <= 2 ? 1 : gl - 1; // ln(poly)→log; ln(expᴸ)→L−1
  }

  if (op === 'Exp') {
    if (tendsToInfinity(o1(e), x, ce) !== true) return 0; // e^(bounded / →−∞)
    const gl = growthLevel(o1(e), x, ce, depth + 1);
    return gl === undefined ? undefined : Math.max(3, gl + 1);
  }

  if (op === 'Power') {
    const base = o1(e);
    const expo = o2(e);
    if (!base.has(x) && expo.has(x)) {
      if (base.isGreater?.(ce.One) === true) {
        if (tendsToInfinity(expo, x, ce) !== true) return 0;
        const gl = growthLevel(expo, x, ce, depth + 1);
        return gl === undefined ? undefined : Math.max(3, gl + 1);
      }
      if (base.isPositive === true && base.isLess?.(ce.One) === true) return 0;
      return undefined;
    }
    if (base.has(x) && !expo.has(x)) {
      if (expo.isNegative === true) return 0; // base^(−k) → 0
      return growthLevel(base, x, ce, depth + 1); // (ln x)^k→1, (eˣ)^k→3
    }
    return undefined;
  }

  if (op === 'Multiply') {
    // Dominated by the fastest-growing factor — but a decaying factor (→0) can
    // pull the product down, so bail to numeric if one is present.
    let lvl = 0;
    for (const f of oo(e)) {
      const g = growthLevel(f, x, ce, depth + 1);
      if (g === undefined) return undefined;
      if (g === 0 && f.has(x)) return undefined; // possibly decaying
      lvl = Math.max(lvl, g);
    }
    return lvl;
  }

  if (op === 'Add') {
    const levels: number[] = [];
    for (const t of oo(e)) {
      const g = growthLevel(t, x, ce, depth + 1);
      if (g === undefined) return undefined;
      levels.push(g);
    }
    const maxL = Math.max(...levels);
    // Two or more terms at the top level may cancel (e^stuff − eˣ → −e²x), so
    // the net growth is indeterminate — defer to numeric rather than claiming a
    // (possibly spurious) exponential order.
    if (levels.filter((l) => l === maxL).length > 1) return undefined;
    return maxL;
  }

  return undefined; // Divide and anything else → numeric
}

/** Does |e| → ∞ as x → +∞?  true / false / undefined (unknown). */
function tendsToInfinity(
  e: Expression,
  x: string,
  ce: ComputeEngine
): boolean | undefined {
  if (!e.has(x)) return false;
  const op = e.operator;

  // Bounded functions, regardless of argument.
  if (
    op === 'Sin' ||
    op === 'Cos' ||
    op === 'Arctan' ||
    op === 'Arccot' ||
    op === 'Tanh'
  )
    return false;

  const deg = polynomialDegree(e, x);
  if (deg > 0) return true;
  if (deg === 0) return false;

  if (op === 'Exp') {
    const t = tendsToInfinity(o1(e), x, ce);
    if (t === false) return false; // e^(bounded) bounded
    return leadingSignAtInf(o1(e), x, ce) > 0 ? true : false; // e^(+∞)→∞, e^(−∞)→0
  }
  if (op === 'Ln' || op === 'Log') return tendsToInfinity(o1(e), x, ce);

  if (op === 'Power') {
    const base = o1(e);
    const expo = o2(e);
    if (!expo.has(x)) {
      const bi = tendsToInfinity(base, x, ce);
      if (expo.isPositive === true) return bi;
      if (expo.isNegative === true) return false;
    }
    if (!base.has(x)) {
      if (base.isGreater?.(ce.One) === true)
        return (
          tendsToInfinity(expo, x, ce) === true &&
          leadingSignAtInf(expo, x, ce) > 0
        );
      if (base.isPositive === true && base.isLess?.(ce.One) === true)
        return false;
    }
    // fᵍ via numeric fallback
    return numericTendsToInfinity(e, x, ce);
  }

  if (op === 'Add') {
    // → ∞ if at least one term → ∞ and the dominant term(s) don't cancel.
    const dom = dominantTerms(oo(e), x, ce);
    if (dom.some((t) => tendsToInfinity(t, x, ce) === true)) {
      const reduced = (
        dom.length === 1 ? dom[0] : ce.function('Add', dom)
      ).simplify();
      if (reduced.has(x)) return numericTendsToInfinity(reduced, x, ce);
      return false;
    }
    return false;
  }

  if (op === 'Multiply' || op === 'Divide')
    return numericTendsToInfinity(e, x, ce);

  return numericTendsToInfinity(e, x, ce);
}

// ──────────────────────────────────────────────────────────────────────────
// Numeric oracles (used only to decide ordering / divergence, never for the
// returned value, which stays symbolic)
// ──────────────────────────────────────────────────────────────────────────

const PROBES = [8, 30, 120];

// Compiled machine-float probe functions, keyed by the probed expression.
// These oracles decide only order-of-growth / divergence (never the returned
// limit value), so machine precision suffices — and, crucially, a compiled
// tower overflows cleanly to ±Infinity instead of grinding. `null` marks an
// expression that could not be compiled (fall back to interpreted `.N()`).
const probeCache = new WeakMap<object, ((x: number) => number) | null>();

function compiledProbe(
  e: Expression,
  x: string,
  ce: ComputeEngine
): ((x: number) => number) | null {
  const key = e as unknown as object;
  let fn = probeCache.get(key);
  if (fn !== undefined) return fn;
  fn = null;
  try {
    const lit = ce.function('Function', [e, ce.symbol(x)]);
    const compiled = ce._compile(lit) as { run?: (x: number) => number };
    if (typeof compiled?.run === 'function') fn = compiled.run;
  } catch {
    fn = null;
  }
  probeCache.set(key, fn);
  return fn;
}

function numericAt(
  e: Expression,
  x: string,
  xv: number,
  ce: ComputeEngine
): number {
  checkDeadline(ce._deadline);
  // Prefer a compiled MACHINE-float evaluation over arbitrary-precision `.N()`.
  // On iterated-exponential (Gruntz-class) forms the interpreted BigDecimal path
  // builds astronomically large intermediates and burns minutes of CPU per
  // probe; the compiled path overflows to ±Infinity immediately. The growth
  // oracles only read magnitude/trend, so this does not change any decision they
  // could reliably make — and it matches the numeric-limit fallback's own
  // machine-float behaviour. See CORRECTNESS_FINDINGS #28.
  const fn = compiledProbe(e, x, ce);
  if (fn) {
    try {
      const v = fn(xv);
      return typeof v === 'number' ? v : NaN;
    } catch (err) {
      if (err instanceof CancellationError) throw err;
      return NaN;
    }
  }
  // Fallback: interpreted arbitrary-precision (only when compilation fails).
  try {
    return e.subs({ [x]: ce.number(xv) }).N().re;
  } catch (err) {
    // A deadline interrupt must propagate; only genuine evaluation failures
    // (overflow, domain) degrade to NaN so probing can bail gracefully.
    if (err instanceof CancellationError) throw err;
    return NaN;
  }
}

function numericTendsToInfinity(
  e: Expression,
  x: string,
  ce: ComputeEngine
): boolean | undefined {
  const v = PROBES.map((xv) => Math.abs(numericAt(e, x, xv, ce)));
  if (v.some((y) => Number.isNaN(y))) return undefined;
  if (v[2] === Infinity) return true;
  // Growing strongly and unbounded.
  if (v[2] > v[1] && v[1] > v[0] && v[2] > 1e3 && v[2] > 100 * v[0])
    return true;
  // Clearly settling to a finite value.
  if (v[2] < 1e3 && Math.abs(v[2] - v[1]) <= 0.01 * Math.max(1, v[2]))
    return false;
  return undefined;
}

function numericGrowthCompare(
  a: Expression,
  b: Expression,
  x: string,
  ce: ComputeEngine
): number | undefined {
  // Compare growth via the trend of D(x) = ln|a(x)| − ln|b(x)| = ln|a/b|.
  // D → +∞ ⟹ a grows faster; D → −∞ ⟹ slower; D → const ⟹ same order. Using
  // log-magnitudes keeps moderate-x probes overflow-free and resolves even very
  // slow rate differences (ln x vs x) that a raw ratio misses.
  const lnMag = (e: Expression, xv: number): number => {
    const v = Math.abs(numericAt(e, x, xv, ce));
    // A probe that hits 0 (often catastrophic cancellation) or a non-finite
    // value (overflow) is unreliable for a growth comparison — bail rather than
    // read a spurious order from it (e.g. eˣ-terms cancelling to 0).
    if (!Number.isFinite(v) || v === 0) return NaN;
    return Math.log(v);
  };
  const d = PROBES.map((xv) => lnMag(a, xv) - lnMag(b, xv));
  if (d.some((v) => !Number.isFinite(v))) return undefined;
  const span = d[2] - d[0];
  // Monotone and meaningfully separating across the probe range.
  if (d[2] > d[1] && d[1] >= d[0] && span > 1) return 1;
  if (d[2] < d[1] && d[1] <= d[0] && span < -1) return -1;
  if (Math.abs(span) < 0.5) return 0; // settled → same order
  return undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────────────────────────────────

/** Split `e` into a numerator/denominator if it is a quotient. */
function asRatio(
  e: Expression,
  ce: ComputeEngine
): { num: Expression; den: Expression } | undefined {
  if (e.operator === 'Divide') return { num: o1(e), den: o2(e) };
  // a · b⁻¹ form
  if (e.operator === 'Multiply') {
    const num: Expression[] = [];
    const den: Expression[] = [];
    for (const f of oo(e)) {
      if (f.operator === 'Power' && o2(f).isNegative === true) {
        den.push(ce.function('Power', [o1(f), o2(f).neg()]));
      } else num.push(f);
    }
    if (den.length > 0) {
      return {
        num:
          num.length === 0
            ? ce.One
            : num.length === 1
              ? num[0]
              : ce.function('Multiply', num),
        den: den.length === 1 ? den[0] : ce.function('Multiply', den),
      };
    }
  }
  return undefined;
}

function isIndeterminateRatio(n0: Expression, d0: Expression): boolean {
  if (n0.is(0) && d0.is(0)) return true; // 0/0
  if (n0.isInfinity === true && d0.isInfinity === true) return true; // ∞/∞
  return false;
}

/**
 * A resolved, usable limit value: free of the limit variable, and neither
 * (complex) infinity nor NaN. Crucially this accepts finite *symbolic*
 * constants (`ln 5`, `π/4`, `e`), whose `.isFinite` is `undefined` because the
 * engine hasn't numericized them.
 */
function isDefiniteValue(e: Expression, x?: string): boolean {
  if (e.isNaN === true) return false;
  if (e.isInfinity === true) return false;
  if (x !== undefined && e.has(x)) return false;
  return true;
}

function expOfLimit(
  inner: Expression | undefined,
  ce: ComputeEngine
): Expression | undefined {
  if (!inner) return undefined;
  if (inner.isInfinity === true)
    return inner.isNegative === true ? ce.Zero : ce.PositiveInfinity;
  if (isDefiniteValue(inner)) return ce.function('Exp', [inner]).evaluate();
  return undefined;
}

function lnOfLimit(
  inner: Expression | undefined,
  ce: ComputeEngine
): Expression | undefined {
  if (!inner) return undefined;
  if (inner.isInfinity === true && inner.isNegative !== true)
    return ce.PositiveInfinity;
  if (inner.is(0)) return ce.NegativeInfinity; // ln 0⁺
  if (inner.isPositive === true && isDefiniteValue(inner))
    return ce.function('Ln', [inner]).evaluate();
  return undefined;
}

/** Sign of the leading coefficient of an (assumed unbounded) expression. */
function leadingSign(e: Expression, x: string, ce: ComputeEngine): number {
  return leadingSignAtInf(e, x, ce);
}

function leadingSignAtInf(e: Expression, x: string, ce: ComputeEngine): number {
  const v = numericAt(e, x, 120, ce);
  if (Number.isNaN(v) || v === 0) return 1;
  return v < 0 ? -1 : 1;
}

function leadingCoefficientRatio(
  n: Expression,
  d: Expression,
  x: string,
  ce: ComputeEngine
): Expression | undefined {
  // Same growth order ⟹ the limit is a finite constant (the ratio of leading
  // coefficients). Recover it with Richardson extrapolation — which converges
  // even for slow approaches such as x·ln(1+1/x) → 1 that a single large probe
  // would under-shoot — then recognize a simple rational.
  const ratio = n.div(d);
  // Shift the probe ladder a little past x = 1: forms like x·ln(1−1/x) are
  // singular there (ln 0), which would poison the extrapolation. The shift
  // leaves the x → ∞ limit unchanged.
  const v = numericLimit((xv) => numericAt(ratio, x, xv + 2, ce), Infinity);
  if (!Number.isFinite(v)) return undefined;
  const rounded = Math.round(v);
  if (Math.abs(v - rounded) < 1e-7) return ce.number(rounded);
  for (let q = 2; q <= 24; q++) {
    const p = Math.round(v * q);
    if (Math.abs(v - p / q) < 1e-9) return ce.number(p).div(ce.number(q));
  }
  return ce.number(v);
}

function baseEventuallyPositive(
  base: Expression,
  x: string,
  ce: ComputeEngine
): boolean {
  return numericAt(base, x, 120, ce) > 0;
}

/**
 * Combine cancellation-prone pairs inside sums, recursively over the whole
 * expression:
 *
 *   ln u − ln v  →  ln(u/v)                (u, v eventually positive)
 *   √u − √v      →  (u − v)/(√u + √v)      (u, v eventually positive)
 *
 * Differences of co-dominant terms like these lose their magnitude to
 * cancellation, so neither the leading-order rewrite nor the growth
 * comparison can rank them (they see the individual terms, not the ~1/x
 * difference). The combined forms are mathematically identical on the
 * eventually-positive domain and are handled exactly by the existing
 * strategies. Only unit-coefficient pairs are combined; anything else is
 * left untouched (and remains protected by the fail-closed instability
 * guards).
 */
function combineCancellingPairs(
  e: Expression,
  x: string,
  ce: ComputeEngine
): Expression {
  const eOps = oo(e);
  if (eOps.length === 0 || !e.has(x)) return e;

  // Rewrite operands first so nested sums (e.g. inside a product or an
  // exponential) are covered.
  const ops = eOps.map((op) => combineCancellingPairs(op, x, ce));
  let changed = ops.some((op, k) => op !== eOps[k]);

  if (e.operator !== 'Add') {
    if (!changed) return e;
    return ce.function(e.operator, ops);
  }

  // Decompose each term into (sign, core), pairing `Ln`/`Sqrt` terms of
  // opposite sign.
  const sign = (t: Expression): 1 | -1 => (t.operator === 'Negate' ? -1 : 1);
  const core = (t: Expression): Expression =>
    t.operator === 'Negate' ? o1(t) : t;

  const used = ops.map(() => false);
  const out: Expression[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (used[i]) continue;
    let combined: Expression | undefined = undefined;
    const si = sign(ops[i]);
    const ci = core(ops[i]);
    if (ci.operator === 'Ln' || ci.operator === 'Sqrt') {
      for (let j = i + 1; j < ops.length; j++) {
        if (used[j]) continue;
        const sj = sign(ops[j]);
        const cj = core(ops[j]);
        if (si === sj || cj.operator !== ci.operator) continue;
        // (u, v) so that the pair is `f(u) − f(v)`.
        const [u, v] = si === 1 ? [o1(ci), o1(cj)] : [o1(cj), o1(ci)];
        if (
          !baseEventuallyPositive(u, x, ce) ||
          !baseEventuallyPositive(v, x, ce)
        )
          continue;
        if (ci.operator === 'Ln') {
          combined = ce.function('Ln', [ce.function('Divide', [u, v])]);
        } else {
          combined = ce.function('Divide', [
            ce.function('Subtract', [u, v]),
            ce.function('Add', [
              ce.function('Sqrt', [u]),
              ce.function('Sqrt', [v]),
            ]),
          ]);
        }
        used[i] = used[j] = true;
        changed = true;
        break;
      }
    }
    if (combined !== undefined) out.push(combined);
    else if (!used[i]) out.push(ops[i]);
  }

  if (!changed) return e;
  if (out.length === 1) return out[0];
  return ce.function('Add', out);
}

/**
 * Does the sum `e` lose most of its magnitude to cancellation (or overflow) at
 * the probe points? A genuine sum keeps a value comparable to its largest term;
 * `e^stuff − eˣ` collapses to ~0 (or NaN past the fp horizon) while each term is
 * astronomically large — a case no black-box numeric pass can rank.
 */
function hasCancellation(e: Expression, x: string, ce: ComputeEngine): boolean {
  if (e.operator !== 'Add' || !oo(e) || oo(e).length < 2) return false;
  for (const xv of [60, 120]) {
    const sum = Math.abs(numericAt(e, x, xv, ce));
    let maxTerm = 0;
    for (const t of oo(e)) {
      const tv = Math.abs(numericAt(t, x, xv, ce));
      if (!Number.isFinite(tv)) return true; // a term overflowed
      maxTerm = Math.max(maxTerm, tv);
    }
    if (maxTerm > 0 && sum < 1e-6 * maxTerm) return true;
  }
  return false;
}

/** Recursive `hasCancellation`: true if `e` or any subexpression cancels/overflows. */
function numericallyUnstable(
  e: Expression,
  x: string,
  ce: ComputeEngine,
  depth: number
): boolean {
  if (depth > MAX_DEPTH || !e.has(x)) return false;
  if (hasCancellation(e, x, ce)) return true;
  if (oo(e))
    for (const o of oo(e))
      if (numericallyUnstable(o, x, ce, depth + 1)) return true;
  return false;
}
