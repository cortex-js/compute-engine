// Detection of a pole of an integrand strictly inside the bounds of a definite
// integral.
//
// The fundamental theorem of calculus, `∫ₐᵇ f = F(b) − F(a)`, requires `f` to
// be bounded on `[a, b]`. When it is not, differencing an antiderivative
// produces a finite number for a divergent integral: `∫₋₁¹ dt/t` comes out as
// `ln|1| − ln|−1| = 0` and `∫₋₁¹ dt/t²` as `−1 − 1 = −2`, when both diverge.
// `interiorPoleVerdict` lets the `Integrate` evaluate handler recognize that
// case — and tell whether the integral diverges to `+∞`, to `−∞`, or has no
// value at all (the integrand changes sign across the pole).
//
// Three families of pole are located: a real root of a polynomial denominator
// (`1/t`, `1/(t² − 1)`, `t⁻³`), a pole of a circular function of a linear
// argument (`tan`, `cot`, `sec`, `csc`, and a `sin`/`cos`/`tan`/`cot`
// divisor), and a pole of a hyperbolic function of a linear argument (`csch`,
// `coth`, and a `sinh`/`tanh` divisor).
// Every located point is then CONFIRMED by sampling the integrand on both
// sides of it, so a denominator that cancels (`(t² − 1)/(t − 1)`) and an
// integrable singularity (`1/√(t − r)`) are rejected.
//
// The detection is deliberately one-sided: a FALSE POSITIVE would turn a
// correct closed form into an inert `Integrate` for every consumer (including
// the compile targets, which try a closed-form antiderivative before falling
// back to quadrature), so a pole is reported only when it has been both
// located exactly and confirmed numerically. Anything the analysis cannot
// settle — symbolic or infinite bounds, a denominator that is neither a
// polynomial nor one of the circular functions above, a denominator with free
// symbols besides the integration variable — is reported as "no pole", leaving
// the caller's previous behavior untouched.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { getPolynomialCoefficients } from '../boxed-expression/polynomials.js';
import { realPolynomialRoots } from '../numerics/polynomial-roots.js';

/**
 * Number of expression nodes the pole-site scan is allowed to visit. The scan
 * runs on every definite integral whose antiderivative was found, so it must
 * not become a cost centre on a large integrand; past the budget the scan
 * gives up and reports no candidates (i.e. no pole).
 */
const SCAN_NODE_BUDGET = 256;

/**
 * Upper bound on the number of periodic pole sites enumerated for one circular
 * function. A wide integration range over `tan(1000 t)` would otherwise
 * enumerate thousands of poles; the first confirmed one already settles the
 * question, so truncating the enumeration cannot change a `true` into a
 * `false` unless every one of the first sites fails confirmation.
 */
const MAX_PERIODIC_SITES = 64;

/**
 * Minimum estimated pole order for a candidate site to count as a pole.
 *
 * The integrand is sampled at two distances from the site, `δ` and `δ/100`. If
 * `|f|` behaves as `δ^(−p)` there, the ratio of the two samples is `100^p`, so
 * `p = log₁₀₀(v₂/v₁)` estimates the order. `∫ dt/(t−r)^p` diverges exactly when
 * `p ≥ 1`; requiring `p ≥ 0.9` accepts the divergent cases with room for
 * floating-point error while rejecting an integrable singularity such as
 * `1/√(t − r)` (`p = 0.5`) and a removable one such as `(t² − 1)/(t − 1)`
 * (`p = 0`).
 */
const MIN_POLE_ORDER = 0.9;

/**
 * The real value of `expr`, or `null` when it is not a finite real number.
 *
 * Used for the integration bounds: a symbolic bound (`∫₀^a`), an infinite one,
 * or a complex one yields `null`, which switches the whole detection off.
 */
function finiteRealValue(expr: Expression | undefined): number | null {
  if (expr === undefined) return null;
  const n = expr.N();
  if (!isNumber(n) || !n.isNumberLiteral) return null;
  if (n.im !== 0) return null;
  return Number.isFinite(n.re) ? n.re : null;
}

/**
 * The coefficients of `poly` as plain numbers, ascending by power, or `null`
 * when `poly` is not a univariate polynomial in `variable` with finite real
 * numeric coefficients.
 *
 * A coefficient that is not a real number literal (`t² + x`, `t − a`) makes any
 * root location unknowable, and a non-polynomial expression (`√t`, `eᵗ`) is out
 * of scope for this detector; both give `null`.
 */
function numericCoefficients(
  poly: Expression,
  variable: string
): number[] | null {
  const coeffs = getPolynomialCoefficients(poly, variable);
  if (coeffs === null) return null;

  const numeric: number[] = [];
  for (const c of coeffs) {
    if (!isNumber(c) || !c.isNumberLiteral || c.im !== 0) return null;
    if (!Number.isFinite(c.re)) return null;
    numeric.push(c.re);
  }
  return numeric;
}
/**
 * A candidate pole site: the point itself, and a test telling whether a given
 * integration bound IS this site — up to rounding — so that a singularity AT
 * a bound (the improper-but-often-convergent case the engine already handles:
 * `∫₀¹ dt/√t → 2`, `∫₀¹ dt/t → +∞`) is told apart from one a hair inside it.
 *
 * The test is not a fixed distance. A polynomial root comes out of the numeric
 * root finder with an error that can reach ~1e-8 for a DOUBLE root (the
 * square-root-of-epsilon conditioning of a repeated root), while a genuine
 * interior pole can sit 1e-10 inside a bound (`∫₀¹ (t − 10⁻¹⁰)⁻² dt`
 * diverges); no distance threshold separates those two. What does separate
 * them is the polynomial's RESIDUAL at the bound: a root that is the bound
 * makes `D(bound)` vanish to the rounding level of its own evaluation, while
 * the root 1e-10 inside leaves `D(0) = 10⁻²⁰`, tiny but far above that level.
 * A lattice site (a circular or hyperbolic pole) is an exact formula, so for
 * it the test is the distance, at the rounding level.
 */
interface PoleSite {
  t: number;
  atBound: (bound: number) => boolean;
}

/** Rounding-level relative tolerance for the at-bound tests. */
const ROUNDING_SLACK = 64 * Number.EPSILON;

/**
 * `|D(x)|` and the sum of the magnitudes of the terms that produced it
 * (Horner's scheme), which bounds the rounding error of the evaluation.
 */
function polynomialResidual(
  coeffs: ReadonlyArray<number>,
  x: number
): { residual: number; scale: number } {
  let value = 0;
  let scale = 0;
  for (let k = coeffs.length - 1; k >= 0; k--) {
    value = value * x + coeffs[k];
    scale = scale * Math.abs(x) + Math.abs(coeffs[k]);
  }
  return { residual: Math.abs(value), scale };
}

/** A site located by an exact formula (a pole lattice, a zero at the origin). */
function exactSite(t: number): PoleSite {
  return {
    t,
    atBound: (bound) =>
      Math.abs(bound - t) <= ROUNDING_SLACK * Math.max(1, Math.abs(bound)),
  };
}

/** A site that is a numeric root of the polynomial with `coeffs`. */
function rootSite(t: number, coeffs: ReadonlyArray<number>): PoleSite {
  return {
    t,
    atBound: (bound) => {
      if (Math.abs(bound - t) <= ROUNDING_SLACK * Math.max(1, Math.abs(bound)))
        return true;
      const { residual, scale } = polynomialResidual(coeffs, bound);
      return residual <= ROUNDING_SLACK * scale;
    },
  };
}

/**
 * The coefficients `[c₀, c₁]` of a LINEAR argument `c₁·t + c₀` in `variable`,
 * or `null` for any other argument. Only a linear argument maps a function's
 * pole lattice onto `t` by a closed formula.
 */
function linearArgument(
  arg: Expression,
  variable: string
): [c0: number, c1: number] | null {
  const coeffs = numericCoefficients(arg, variable);
  if (coeffs === null || coeffs.length !== 2 || coeffs[1] === 0) return null;
  return [coeffs[0], coeffs[1]];
}

/**
 * Add to `sites` every point of `(lo, hi)` where `c₁·t + c₀` lands on the
 * lattice `phase + kπ` — the poles of `tan`/`sec` (phase π/2) or `cot`/`csc`
 * (phase 0), and the ZEROS of `sin`/`tan` (phase 0) or `cos`/`cot` (phase
 * π/2) when one of those is a divisor. Returns whether the enumeration was
 * cut short at `MAX_PERIODIC_SITES` — the poles past the cap are then
 * unexamined, which matters to the verdict's SIGN (see
 * `interiorPoleVerdict`), not to whether the integral diverges.
 */
function addLatticeSites(
  phase: number,
  arg: Expression,
  variable: string,
  lo: number,
  hi: number,
  sites: PoleSite[]
): boolean {
  const linear = linearArgument(arg, variable);
  if (linear === null) return false;
  const [c0, c1] = linear;
  // `k` at each endpoint; which one is the smaller depends on the sign of `c₁`.
  const kAt = (t: number) => (c1 * t + c0 - phase) / Math.PI;
  const kLo = Math.ceil(Math.min(kAt(lo), kAt(hi)));
  let kHi = Math.floor(Math.max(kAt(lo), kAt(hi)));
  if (!Number.isFinite(kLo) || !Number.isFinite(kHi)) return false;
  let truncated = false;
  if (kHi - kLo >= MAX_PERIODIC_SITES) {
    kHi = kLo + MAX_PERIODIC_SITES - 1;
    truncated = true;
  }
  for (let k = kLo; k <= kHi; k++)
    sites.push(exactSite((phase + k * Math.PI - c0) / c1));
  return truncated;
}

/**
 * Add to `sites` the point where `c₁·t + c₀ = 0` — the one real pole of
 * `csch`/`coth`, and the one real zero of a `sinh`/`tanh` divisor.
 */
function addOriginSite(
  arg: Expression,
  variable: string,
  sites: PoleSite[]
): void {
  const linear = linearArgument(arg, variable);
  if (linear === null) return;
  const [c0, c1] = linear;
  sites.push(exactSite(-c0 / c1));
}

/**
 * The lattice phase of the ZEROS of a circular function, for when it is a
 * divisor: `1/sin t` and `1/tan t` blow up at `kπ`, `1/cos t` and `1/cot t`
 * at `π/2 + kπ`. `sec`/`csc` have no zeros.
 */
const ZERO_LATTICE_PHASE: Record<string, number> = {
  __proto__: null as never,
  Sin: 0,
  Tan: 0,
  Cos: Math.PI / 2,
  Cot: Math.PI / 2,
};

/**
 * The lattice phase of the POLES of a circular function, wherever it
 * appears: `tan`/`sec` at `π/2 + kπ`, `cot`/`csc` at `kπ`.
 */
const POLE_LATTICE_PHASE: Record<string, number> = {
  __proto__: null as never,
  Tan: Math.PI / 2,
  Sec: Math.PI / 2,
  Cot: 0,
  Csc: 0,
};

/**
 * Every point of `(lo, hi)` at which `expr` could be unbounded: the real roots
 * of the divisor of a `Divide` and of the base of a `Power` with a negative
 * numeric exponent (`1/t²` canonicalizes to `Power(t, -2)`, not to a
 * `Divide`); the zeros of a circular or hyperbolic divisor of a linear
 * argument (`1/sin t`, `1/tan t`, `1/sinh t` — a reciprocal is NOT
 * canonicalized to `csc`/`cot`/`csch`, so these spellings do reach here); and
 * the poles of `tan`/`cot`/`sec`/`csc`/`coth`/`csch` of a linear argument
 * wherever they appear.
 *
 * Returns `null` when the walk exceeds {@link SCAN_NODE_BUDGET}, or when a
 * numeric root finder fails to converge, so the caller can tell "nothing to
 * check" from "gave up"; `truncated` reports a pole lattice cut short at
 * `MAX_PERIODIC_SITES`. The sites are candidates only — each must still be
 * confirmed against the integrand by {@link divergesOnSide}.
 */
function poleSites(
  expr: Expression,
  variable: string,
  lo: number,
  hi: number,
  ce: ComputeEngine
): { sites: PoleSite[]; truncated: boolean } | null {
  const sites: PoleSite[] = [];
  let budget = SCAN_NODE_BUDGET;
  let converged = true;
  let truncated = false;

  const addPolynomialRoots = (poly: Expression): void => {
    if (!poly.has(variable)) return;
    const coeffs = numericCoefficients(poly, variable);
    if (coeffs === null || coeffs.length < 2) return;
    const roots = realPolynomialRoots(coeffs, ce._deadline);
    if (roots === null) {
      converged = false;
      return;
    }
    for (const r of roots) sites.push(rootSite(r, coeffs));
  };

  // A divisor contributes its ZEROS.
  const addDenominatorSites = (d: Expression): void => {
    addPolynomialRoots(d);
    if (!isFunction(d)) return;
    const phase = ZERO_LATTICE_PHASE[d.operator];
    if (phase !== undefined)
      truncated =
        addLatticeSites(phase, d.op1, variable, lo, hi, sites) || truncated;
    else if (d.operator === 'Sinh' || d.operator === 'Tanh')
      addOriginSite(d.op1, variable, sites);
  };

  const walk = (e: Expression): boolean => {
    if (budget-- <= 0) return false;
    if (!isFunction(e)) return true;
    if (e.operator === 'Divide') addDenominatorSites(e.op2);
    else if (e.operator === 'Power') {
      const exponent = e.op2;
      if (isNumber(exponent) && exponent.isNumberLiteral && exponent.re < 0)
        addDenominatorSites(e.op1);
    } else {
      // A function with poles of its own is unbounded wherever it appears,
      // not only under a division bar.
      const phase = POLE_LATTICE_PHASE[e.operator];
      if (phase !== undefined)
        truncated =
          addLatticeSites(phase, e.op1, variable, lo, hi, sites) || truncated;
      else if (e.operator === 'Csch' || e.operator === 'Coth')
        addOriginSite(e.op1, variable, sites);
    }
    for (const op of e.ops) if (!walk(op)) return false;
    return true;
  };

  if (!walk(expr)) return null;
  return converged ? { sites, truncated } : null;
}

/**
 * `f(x)` as a real number, or `NaN` when the integrand does not evaluate to a
 * real number there (a complex branch, an unevaluated symbol).
 */
function valueAt(
  integrand: Expression,
  variable: string,
  x: number,
  ce: ComputeEngine
): number {
  const v = integrand.subs({ [variable]: ce.number(x) }).N();
  if (!isNumber(v) || !v.isNumberLiteral || v.im !== 0) return NaN;
  return v.re;
}

/** The sign of a divergence, as the integrand's sign on the way into it. */
export type DivergenceSign = 'positive' | 'negative';

/**
 * Whether `|f|` grows at least as fast as `1/|t − site|` on the given side of
 * `site` — i.e. whether the singularity is strong enough to make the integral
 * diverge — and with what sign: `undefined` when it does not diverge there,
 * `'unknown'` when it does but the sign has not settled by the closest
 * sample.
 *
 * `side` is `+1` or `−1`; `reach` is how far from the site the sampling may go
 * without leaving the interval or crossing another candidate site. The order
 * of the pole is read off the MAGNITUDES at `δ` and `δ/100` — never off the
 * signs, because an integrand can cross zero between those two samples and
 * still diverge (`1/t − 1/(2000t²)` is positive at `t = 0.01` and negative at
 * `t = 0.0001`, on its way to `−∞`). The sign is read off the two closest
 * samples, `δ/100` and `δ/10⁴`: the asymptotic sign is the one that no
 * longer changes as the site is approached, and two agreeing samples that
 * close are taken as it; if they still disagree the direction is `'unknown'`.
 */
function divergesOnSide(
  integrand: Expression,
  variable: string,
  site: number,
  side: 1 | -1,
  reach: number,
  ce: ComputeEngine
): DivergenceSign | 'unknown' | undefined {
  const near = valueAt(integrand, variable, site + side * reach, ce);
  const nearer = valueAt(integrand, variable, site + (side * reach) / 100, ce);

  // A sample that is not a real number at all is no evidence of a pole.
  if (Number.isNaN(near) || Number.isNaN(nearer)) return undefined;

  let diverges: boolean;
  if (!Number.isFinite(nearer)) {
    // Overflow at the closer point — whether or not the farther one
    // overflowed too (`t⁻³⁰⁰` overflows at both sampling distances) — is a
    // pole steeper than the order estimate below could measure.
    diverges = true;
  } else if (!Number.isFinite(near)) {
    // Overflow farther out with a FINITE value closer in is not a pole at the
    // site at all (the blow-up is elsewhere, or the sample hit another site).
    return undefined;
  } else {
    const ratio = Math.abs(nearer) / Math.abs(near);
    if (!(ratio > 1)) return undefined;
    diverges = Math.log(ratio) / Math.log(100) >= MIN_POLE_ORDER;
  }
  if (!diverges) return undefined;

  const nearest = valueAt(integrand, variable, site + (side * reach) / 1e4, ce);
  if (Number.isNaN(nearest) || nearer === 0 || nearest === 0) return 'unknown';
  if (Math.sign(nearer) !== Math.sign(nearest)) return 'unknown';
  return nearest > 0 ? 'positive' : 'negative';
}

/**
 * What a definite integral with a proven interior pole diverges TO.
 *
 * - `positive`: the integrand is positive on both sides of every proven pole
 *   (`1/t²` across 0), so the integral diverges to `+∞`;
 * - `negative`: negative on both sides of every pole (`−1/t²`), so `−∞`;
 * - `mixed`: the integrand changes sign across a pole (`1/t` across 0 — the
 *   Cauchy principal value is 0, but the integral itself is undefined) or
 *   different poles diverge in different directions; the integral has no
 *   value, not even an infinite one;
 * - `unknown`: the integral diverges, but its direction could not be
 *   established — the sign had not settled by the closest sample, or a pole
 *   lattice was cut short at `MAX_PERIODIC_SITES` and the unexamined poles
 *   could diverge the other way. Callers treat it as `mixed`: no value.
 *
 * The sign is that of the ORIENTED integral: for reversed bounds
 * (`∫₁⁻¹ dt/t²`, which is `−∫₋₁¹ dt/t²`) `positive` and `negative` are
 * swapped, as the antiderivative difference and the quadrature both negate
 * a reversed range.
 */
export type PoleVerdict = {
  sign: DivergenceSign | 'mixed' | 'unknown';
};

/**
 * Whether — and toward what — `integrand` diverges at a pole strictly between
 * the bounds `lower` and `upper` of a definite integral in `variable`:
 * a {@link PoleVerdict} when a pole was PROVEN, `undefined` otherwise.
 *
 * "Proven" means a point of the open interval was located exactly — as a
 * real root of a polynomial denominator, or as a pole of a circular or
 * hyperbolic function of a linear argument — AND the integrand was confirmed
 * by sampling to grow at least as fast as `1/|t − site|` on both sides of it.
 * The second half is what makes a cancelling denominator such as
 * `(t² − 1)/(t − 1)` — bounded at `t = 1` — and an integrable singularity such
 * as `1/√(t − r)` report `undefined`.
 *
 * `undefined` means "not proven", never "no pole": bounds that are not finite
 * real numbers, a denominator that is neither polynomial nor one of the
 * circular/hyperbolic functions above (`ln t`, `eᵗ − 1`), a denominator with
 * another free symbol, or a root finder that did not converge all report
 * `undefined` so the caller keeps its existing behavior. Every candidate is
 * examined (no early exit) so that the verdict's sign accounts for every
 * pole in the range.
 *
 * The bounds may be expressions or plain numbers; a symbolic or infinite
 * bound switches the detection off.
 */
export function interiorPoleVerdict(
  integrand: Expression,
  variable: string,
  lower: Expression | number | undefined,
  upper: Expression | number | undefined,
  ce: ComputeEngine
): PoleVerdict | undefined {
  const a = typeof lower === 'number' ? lower : finiteRealValue(lower);
  const b = typeof upper === 'number' ? upper : finiteRealValue(upper);
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b))
    return undefined;

  // The bounds may be given in either order (`∫₂¹`); the interior is the same.
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (!(lo < hi)) return undefined;

  const scan = poleSites(integrand, variable, lo, hi, ce);
  if (scan === null || scan.sites.length === 0) return undefined;
  const sites = scan.sites;

  let verdict: PoleVerdict | undefined;
  for (const site of sites) {
    // Outside the range, or AT a bound (an endpoint singularity, not an
    // interior pole — see `PoleSite`).
    if (!(site.t > lo && site.t < hi)) continue;
    if (site.atBound(lo) || site.atBound(hi)) continue;

    // Sample close enough to the site to stay inside the interval and clear of
    // every other candidate site.
    let reach = Math.min(site.t - lo, hi - site.t) / 100;
    for (const other of sites)
      if (other !== site && other.t !== site.t)
        reach = Math.min(reach, Math.abs(other.t - site.t) / 100);
    if (!(reach > 0)) continue;

    const left = divergesOnSide(integrand, variable, site.t, -1, reach, ce);
    const right = divergesOnSide(integrand, variable, site.t, 1, reach, ce);
    if (left === undefined || right === undefined) continue;

    const sign: PoleVerdict['sign'] =
      left === 'unknown' || right === 'unknown'
        ? 'unknown'
        : left === right
          ? left
          : 'mixed';
    if (verdict === undefined) verdict = { sign };
    else if (verdict.sign !== sign) verdict = { sign: 'mixed' };
  }
  if (verdict === undefined) return undefined;

  // Poles past the enumeration cap were not examined: the integral diverges
  // (a proven pole suffices for that) but its direction is not established.
  if (scan.truncated && verdict.sign !== 'mixed') verdict = { sign: 'unknown' };

  // Orientation: a reversed range negates the integral.
  if (a > b) {
    if (verdict.sign === 'positive') verdict = { sign: 'negative' };
    else if (verdict.sign === 'negative') verdict = { sign: 'positive' };
  }
  return verdict;
}

/**
 * Whether `integrand` has a proven pole strictly between the bounds — see
 * {@link interiorPoleVerdict}, of which this is the yes/no reading.
 */
export function integrandHasInteriorPole(
  integrand: Expression,
  variable: string,
  lower: Expression | number | undefined,
  upper: Expression | number | undefined,
  ce: ComputeEngine
): boolean {
  return (
    interiorPoleVerdict(integrand, variable, lower, upper, ce) !== undefined
  );
}
