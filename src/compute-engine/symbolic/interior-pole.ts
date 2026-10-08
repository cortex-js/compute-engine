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
// divisor), a pole of a hyperbolic function of a linear argument (`csch`,
// `coth`, and a `sinh`/`tanh` divisor), and the zero of a logarithmic divisor
// of a linear argument (`1/ln t` at `t = 1`). A divisor that is a product is
// examined factor by factor (`1/(t·ln²t)`).
// Every located point is then CONFIRMED by sampling the integrand on both
// sides of it, so a denominator that cancels (`(t² − 1)/(t − 1)`) and an
// integrable singularity (`1/√(t − r)`) are rejected.
//
// The detection is deliberately one-sided: a FALSE POSITIVE would turn a
// correct closed form into an inert `Integrate` for every consumer (including
// the compile targets, which try a closed-form antiderivative before falling
// back to quadrature), so a pole is reported only when it has been both
// located exactly and confirmed numerically. Anything the analysis cannot
// settle — symbolic bounds, a denominator that is neither a
// polynomial nor one of the circular functions above, a denominator with free
// symbols besides the integration variable — is reported as "no pole", leaving
// the caller's previous behavior untouched. An infinite bound is accepted by
// `interiorPoleVerdict` (a pole at a finite point is inside `(−∞, b)` when it
// is less than `b`), but not by the checks that need a finite range.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { isValueDef } from '../boxed-expression/definition-guards.js';
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
 * Used for the integration bounds when the check needs a finite range
 * ({@link endpointPoleVerdict}, {@link isRealOnInterval}): a symbolic bound
 * (`∫₀^a`), an infinite one, or a complex one yields `null`, which switches
 * that check off.
 */
function finiteRealValue(expr: Expression | undefined): number | null {
  if (expr === undefined) return null;
  const n = expr.N();
  if (!isNumber(n) || !n.isNumberLiteral) return null;
  if (n.isComplex) return null;
  return Number.isFinite(n.re) ? n.re : null;
}

/**
 * The real value of `expr`, `+Infinity` or `-Infinity` for a real infinity,
 * or `null` when it is not a real number or a real infinity.
 *
 * Used for the bounds of {@link interiorPoleVerdict}, which accepts an
 * infinite bound. A symbolic bound, a complex bound (`~∞` included) and
 * `NaN` give `null`.
 */
function realBoundValue(expr: Expression | undefined): number | null {
  if (expr === undefined) return null;
  const n = expr.N();
  if (!isNumber(n) || !n.isNumberLiteral) return null;
  if (n.isComplex) return null;
  return Number.isNaN(n.re) ? null : n.re;
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
    const value = constantRealValue(c);
    if (value === null) return null;
    numeric.push(value);
  }
  return numeric;
}

/**
 * The value of the polynomial coefficient `c` as a finite real number, or
 * `null` when it has no such value.
 *
 * A number literal gives its value. A coefficient that is not a literal but
 * has a known real value — a constant such as `Pi` or `ExponentialE`, a
 * symbol declared constant with a value, or an expression of those (`-Pi`,
 * `Pi²`, `2e`, `ln 2`) — gives its numeric approximation, so that the pole of
 * `(t − π)⁻²` is found at `t = π`. The approximation is a double: the site
 * and the bounds are then compared in doubles, and a site within rounding
 * distance of a bound counts as AT the bound (see `PoleSite`), which gives no
 * interior verdict (a pole at a bound is examined by `endpointPoleVerdict`).
 * A free symbol with no value (`a` in `t − a`) has no numeric value,
 * so its coefficient gives `null` and the pole location stays unknown.
 */
function constantRealValue(c: Expression): number | null {
  if (isNumber(c) && c.isNumberLiteral) {
    if (c.isComplex || !Number.isFinite(c.re)) return null;
    return c.re;
  }
  // An impure coefficient (`Random()`) has no fixed value, and evaluating it
  // here would run its effect once more than the integration does.
  if (!c.isPure) return null;
  const n = c.N();
  if (!isNumber(n) || !n.isNumberLiteral || n.isComplex) return null;
  return Number.isFinite(n.re) ? n.re : null;
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
  let kLo = Math.ceil(Math.min(kAt(lo), kAt(hi)));
  let kHi = Math.floor(Math.max(kAt(lo), kAt(hi)));
  if (Number.isNaN(kLo) || Number.isNaN(kHi)) return false;
  let truncated = false;
  // An infinite bound puts infinitely many sites in the range. The
  // enumeration then starts at the finite end of the range of `k` (around
  // `k = 0` when both ends are infinite), and is cut short at
  // `MAX_PERIODIC_SITES`.
  if (!Number.isFinite(kLo) && !Number.isFinite(kHi)) {
    kLo = -Math.floor(MAX_PERIODIC_SITES / 2);
    kHi = kLo + MAX_PERIODIC_SITES - 1;
    truncated = true;
  } else if (!Number.isFinite(kLo)) {
    kLo = kHi - MAX_PERIODIC_SITES + 1;
    truncated = true;
  } else if (!Number.isFinite(kHi)) {
    kHi = kLo + MAX_PERIODIC_SITES - 1;
    truncated = true;
  } else if (kHi - kLo >= MAX_PERIODIC_SITES) {
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
 * canonicalized to `csc`/`cot`/`csch`, so these spellings do reach here); the
 * zero of a logarithmic divisor of a linear argument (`1/ln t` at `t = 1`);
 * the zeros of each factor of a divisor that is a product, or a positive
 * power, and not a polynomial (`1/(t·ln²t)` at `t = 0` and `t = 1`); and the
 * poles of `tan`/`cot`/`sec`/`csc`/`coth`/`csch` of a linear argument
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

  // Add the real roots of `poly`, and return whether it is a polynomial in
  // the variable with numeric coefficients.
  const addPolynomialRoots = (poly: Expression): boolean => {
    if (!poly.has(variable)) return true;
    const coeffs = numericCoefficients(poly, variable);
    if (coeffs === null) return false;
    if (coeffs.length < 2) return true;
    const roots = realPolynomialRoots(coeffs, ce._deadline);
    if (roots === null) {
      converged = false;
      return true;
    }
    for (const r of roots) sites.push(rootSite(r, coeffs));
    return true;
  };

  // A divisor contributes its ZEROS. A divisor that is not a polynomial
  // contributes the zeros of each factor of a product, and of the base of a
  // positive power: `t·ln²t` is zero at `t = 0` and at `t = 1`.
  const addDenominatorSites = (d: Expression): void => {
    if (budget-- <= 0) return;
    if (addPolynomialRoots(d)) return;
    if (!isFunction(d)) return;
    if (d.operator === 'Multiply') {
      for (const factor of d.ops) addDenominatorSites(factor);
      return;
    }
    if (d.operator === 'Power') {
      const exponent = d.op2;
      if (isNumber(exponent) && exponent.isNumberLiteral && exponent.re > 0)
        addDenominatorSites(d.op1);
      return;
    }
    // A logarithm of a linear argument `c₁·t + c₀` is zero where the argument
    // is 1, whatever the base.
    if (d.operator === 'Ln' || d.operator === 'Log') {
      const linear = linearArgument(d.op1, variable);
      if (linear !== null) {
        const [c0, c1] = linear;
        sites.push(exactSite((1 - c0) / c1));
      }
      return;
    }
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
  // The body of a function literal can be a `Block` of one expression
  // (`\int_{-1}^1 \frac{\pi}{t}\,dt` on the parse route). `.N()` of a `Block`
  // does not make its body numeric (`Block(π/0.001).N()` is `1000π`), so the
  // sample would not be a number: the one expression is sampled instead.
  while (isFunction(integrand, 'Block') && integrand.nops === 1)
    integrand = integrand.op1;
  const v = integrand.subs({ [variable]: ce.number(x) }).N();
  if (!isNumber(v) || !v.isNumberLiteral || v.isComplex) return NaN;
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
 * The smallest pole order, measured at the closest samples, that
 * {@link endpointDivergesOnSide} accepts. See {@link ENDPOINT_LIMIT_ORDER}.
 */
const ENDPOINT_MIN_ORDER = 0.99;

/**
 * The smallest EXTRAPOLATED pole order that {@link endpointDivergesOnSide}
 * accepts.
 *
 * A slowly varying factor raises the measured order of an integrable
 * singularity: `|f| = δ^(−p)·|ln δ|ᵏ` at a distance `δ` from the bound has
 * the local order `p + k/L`, with `L = ln(1/δ)`. Even 30 decades from the
 * bound, `t^(−0.995)·ln t` (convergent, `∫₀¹ = −40000`) shows the order
 * `1.003`. So the order is measured over three ranges of distance, and its
 * trend is extrapolated to the bound: a pole (`1/t`, `tan t` at `π/2`) has a
 * constant order, or an order that approaches 1 geometrically (a regular part
 * such as the `−100` in `1/t − 100`), while a logarithmic factor makes the
 * order approach `p` as `k/L`. The extrapolated order must be 1 within this
 * margin, which is far below the change the model `p + k/L` attributes to a
 * logarithmic factor at the sampled distances.
 */
const ENDPOINT_LIMIT_ORDER = 1 - 1e-4;

/**
 * The largest quotient of two successive changes of the measured order that
 * {@link endpointDivergesOnSide} reads as a geometric approach to the limit.
 * A regular part `c·δ^s` changes the order by a quotient `10^(−s·D/4)` from one
 * range to the next (at most about `0.06` for `√δ` next to a nonzero bound);
 * a logarithmic factor by a quotient between `0.4` and `0.6`.
 */
const ENDPOINT_GEOMETRIC_QUOTIENT = 0.1;

/**
 * The relative distance from a NONZERO bound below which the samples of
 * {@link endpointDivergesOnSide} stop: closer than this, the double nearest
 * the sample point and the double nearest the bound (which is itself a
 * rounded value of `π/2` or of a root) leave too few significant digits in
 * the distance between them.
 */
const ENDPOINT_RELATIVE_SPACING = 1e-12;

/**
 * How many decades of distance from the bound the samples of
 * {@link endpointDivergesOnSide} span at most (next to a bound at 0, where the
 * floating-point numbers allow it).
 */
const ENDPOINT_MAX_DECADES = 60;

/**
 * The strict version of {@link divergesOnSide} for a pole AT a bound: whether
 * `|f|` grows at least as fast as `1/δ` at a distance `δ` from `bound` on the
 * given side, inside the interval, and with what sign. `undefined` when the
 * divergence is not certain.
 *
 * The integrand is sampled at the distances `reach·10^(−D·j/4)` from the
 * bound, `j = 0…4`, where `D` is at most `ENDPOINT_MAX_DECADES` (a bound at
 * 0) and is limited by `ENDPOINT_RELATIVE_SPACING` next to a nonzero bound.
 * The pole order is measured over the three ranges between the four closest
 * samples; the farthest sample is skipped, so that a large regular part
 * (`1/t − 100`, which is 0 at `t = 0.01`) does not distort the measure. The
 * integral diverges when the closest order is at least `ENDPOINT_MIN_ORDER`
 * and the order extrapolated to the bound is at least `ENDPOINT_LIMIT_ORDER`
 * (see `ENDPOINT_GEOMETRIC_QUOTIENT`). The sign is the sign of the two
 * closest samples, which must agree.
 *
 * A sample that overflows is the sign of a steep pole: it is accepted when
 * the samples closer to the bound overflow too, and either the first
 * overflow is at one of the two shallowest samples or the order measured
 * just before it is at least 1.5.
 */
function endpointDivergesOnSide(
  integrand: Expression,
  variable: string,
  bound: number,
  side: 1 | -1,
  reach: number,
  ce: ComputeEngine
): DivergenceSign | undefined {
  const closest = Math.max(
    reach * 10 ** -ENDPOINT_MAX_DECADES,
    Math.abs(bound) * ENDPOINT_RELATIVE_SPACING
  );
  const decades = Math.log10(reach / closest);
  if (!(decades >= 6)) return undefined;

  // Five distances, `reach·10^(−D·j/4)` for `j = 0…4`. Only the last four
  // measure the order; the first one only tells where an overflow starts.
  const points: { delta: number; value: number }[] = [];
  for (let j = 0; j <= 4; j++) {
    const x = bound + side * reach * 10 ** ((-decades * j) / 4);
    // The distance actually sampled: `x − bound` is exact for a nearby `x`.
    const delta = Math.abs(x - bound);
    if (!(delta > 0)) return undefined;
    const value = valueAt(integrand, variable, x, ce);
    if (Number.isNaN(value)) return undefined;
    points.push({ delta, value });
  }

  // The order measured between the samples `i` and `i + 1`.
  const order = (i: number) =>
    Math.log(Math.abs(points[i + 1].value) / Math.abs(points[i].value)) /
    Math.log(points[i].delta / points[i + 1].delta);

  const firstOverflow = points.findIndex((p) => !Number.isFinite(p.value));
  if (firstOverflow >= 0) {
    // Once a sample overflows, every closer one must overflow too.
    if (points.slice(firstOverflow).some((p) => Number.isFinite(p.value)))
      return undefined;
    if (firstOverflow >= 2 && !(order(firstOverflow - 2) >= 1.5))
      return undefined;
    const value = points[firstOverflow].value;
    return value > 0 ? 'positive' : 'negative';
  }

  if (points.slice(1).some((p) => p.value === 0)) return undefined;
  // The order over three ranges of distance, from the farthest to the
  // closest.
  const far = order(1);
  const near = order(2);
  const nearer = order(3);
  if (!(nearer >= ENDPOINT_MIN_ORDER)) return undefined;

  // The order at the bound, extrapolated from its trend.
  const change = near - nearer;
  const previousChange = far - near;
  let limit: number;
  if (Math.abs(change) <= 1e-9) limit = nearer;
  else if (
    Number.isFinite(previousChange) &&
    previousChange !== 0 &&
    Math.abs(change / previousChange) <= ENDPOINT_GEOMETRIC_QUOTIENT
  ) {
    // A geometric approach: the changes still to come sum to `change·q/(1−q)`.
    const q = change / previousChange;
    limit = nearer - (change * q) / (1 - q);
  } else {
    // Solve `order = p + k/L` for `p`, where each measured order is read at
    // the logarithmic mean of `L = ln(1/δ)` over its range. The model needs
    // `L > 0` (a distance below 1); a wider range gives no verdict.
    const L = points.map((p) => -Math.log(p.delta));
    if (!(L[2] > 0)) return undefined;
    const mean = (a: number, b: number) => (b - a) / Math.log(b / a);
    const mNear = mean(L[2], L[3]);
    const mNearer = mean(L[3], L[4]);
    limit = (nearer * mNearer - near * mNear) / (mNearer - mNear);
  }
  if (!(limit >= ENDPOINT_LIMIT_ORDER)) return undefined;

  const [a, b] = [points[3].value, points[4].value];
  if (Math.sign(a) !== Math.sign(b)) return undefined;
  return b > 0 ? 'positive' : 'negative';
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
 * `undefined` means "not proven", never "no pole": bounds that are not real
 * numbers or real infinities, a denominator that is neither polynomial nor
 * one of the circular, hyperbolic or logarithmic functions above (`ln(t²)`,
 * `eᵗ − 1`), a denominator with another free symbol, or a root finder that
 * did not converge all report `undefined` so the caller keeps its existing
 * behavior. Every candidate is examined (no early exit) so that the
 * verdict's sign accounts for every pole in the range.
 *
 * The bounds may be expressions or plain numbers; a symbolic bound switches
 * the detection off. A bound can be `+∞` or `−∞`: a finite site is then
 * inside the range when it is on the finite side of the other bound. An
 * infinite range has infinitely many sites of a pole lattice (`tan t`), so
 * that enumeration is cut short and gives `unknown`, as above. With an
 * infinite bound, the integral over the tail can also diverge: a `positive`
 * or `negative` verdict becomes `unknown` when the samples of the tail do
 * not show that its integral is finite or diverges with the same sign (see
 * `tailAgrees`).
 */
export function interiorPoleVerdict(
  integrand: Expression,
  variable: string,
  lower: Expression | number | undefined,
  upper: Expression | number | undefined,
  ce: ComputeEngine
): PoleVerdict | undefined {
  const a = typeof lower === 'number' ? lower : realBoundValue(lower);
  const b = typeof upper === 'number' ? upper : realBoundValue(upper);
  if (a === null || b === null || Number.isNaN(a) || Number.isNaN(b))
    return undefined;

  // The bounds may be given in either order (`∫₂¹`); the interior is the same.
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (!(lo < hi)) return undefined;

  const scan = poleSites(integrand, variable, lo, hi, ce);
  if (scan === null || scan.sites.length === 0) return undefined;
  const sites = scan.sites;

  // The distance from `t` to the bound `bound`. For an infinite bound, a
  // finite distance on the scale of `t` is used instead, so that the samples
  // next to a site stay at a finite point.
  const distance = (t: number, bound: number) =>
    Number.isFinite(bound) ? Math.abs(bound - t) : Math.max(1, Math.abs(t));

  let verdict: PoleVerdict | undefined;
  for (const site of sites) {
    // Outside the range, or AT a bound (an endpoint singularity, not an
    // interior pole — see `PoleSite`). A finite site is never at an infinite
    // bound.
    if (!(site.t > lo && site.t < hi)) continue;
    if (Number.isFinite(lo) && site.atBound(lo)) continue;
    if (Number.isFinite(hi) && site.atBound(hi)) continue;

    // Sample close enough to the site to stay inside the interval and clear of
    // every other candidate site.
    let reach = Math.min(distance(site.t, lo), distance(site.t, hi)) / 100;
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

  // An infinite bound: the integral over the tail can diverge too. The
  // verdict `positive` or `negative` stays only when every infinite tail is
  // finite or diverges with the same sign (see `tailAgrees`). Otherwise the
  // integral still diverges at the pole, but its direction is not
  // established: `∫₋₁^∞ (1/t² − 1) dt` is `+∞ − ∞`.
  if (verdict.sign === 'positive' || verdict.sign === 'negative') {
    const scale = Math.max(
      1,
      ...[lo, hi].filter((x) => Number.isFinite(x)).map((x) => Math.abs(x)),
      ...sites.map((site) => Math.abs(site.t))
    );
    for (const [bound, side] of [
      [lo, -1],
      [hi, 1],
    ] as const) {
      if (Number.isFinite(bound)) continue;
      if (!tailAgrees(integrand, variable, side, scale, verdict.sign, ce)) {
        verdict = { sign: 'unknown' };
        break;
      }
    }
  }

  // Orientation: a reversed range negates the integral.
  if (a > b) {
    if (verdict.sign === 'positive') verdict = { sign: 'negative' };
    else if (verdict.sign === 'negative') verdict = { sign: 'positive' };
  }
  return verdict;
}

/**
 * Minimum decay order of the integrand at an infinite bound for its tail to
 * count as integrable in {@link tailAgrees}. `∫^∞ dt/t^p` is finite exactly
 * when `p > 1`; the margin above 1 allows for floating-point error and for a
 * slowly varying factor (`1/(t·ln t)` measures an order a little above 1, and
 * is not integrable).
 */
const MIN_TAIL_ORDER = 1.1;

/**
 * Whether the integral of `integrand` over the infinite tail on the given
 * `side` (`+1` toward `+∞`, `−1` toward `−∞`) is finite, or diverges with the
 * sign `sign`. The integrand is sampled at `side · scale · 10ᵏ` for
 * `k = 2, 3, 5, 8`, where `scale` is at least the magnitude of every finite
 * bound and pole site, so that every sample is past all of them.
 *
 * - When every sample is zero or has the sign `sign`, the tail is taken to
 *   keep that sign: its integral is then finite or diverges with that sign.
 * - Otherwise, when the magnitudes of the last two samples decrease at least
 *   as fast as `t^(−MIN_TAIL_ORDER)`, the tail is taken to be integrable.
 * - Otherwise (a sample is not a real number, a tail of the other sign that
 *   does not decrease fast enough), the result is `false`.
 *
 * This is a test from samples: it cannot exclude an integrand that changes
 * its behavior past the last sample.
 */
function tailAgrees(
  integrand: Expression,
  variable: string,
  side: 1 | -1,
  scale: number,
  sign: DivergenceSign,
  ce: ComputeEngine
): boolean {
  const points = [2, 3, 5, 8].map((k) => side * scale * 10 ** k);
  const values = points.map((x) => valueAt(integrand, variable, x, ce));
  if (values.some((v) => Number.isNaN(v))) return false;
  const expected = sign === 'positive' ? 1 : -1;
  if (values.every((v) => v === 0 || Math.sign(v) === expected)) return true;
  const [near, far] = [Math.abs(values[2]), Math.abs(values[3])];
  if (!Number.isFinite(near) || !Number.isFinite(far)) return false;
  // The far sample is below the smallest double: the tail decreases faster
  // than any power.
  if (far === 0) return true;
  if (near === 0) return false;
  const order =
    Math.log(near / far) / Math.log(Math.abs(points[3] / points[2]));
  return order >= MIN_TAIL_ORDER;
}

/**
 * Whether — and toward what — `integrand` diverges at a pole AT a bound of a
 * definite integral in `variable` (`∫₀¹ t⁻² dt`, `∫₀^π (y − π)⁻² dy`): a
 * {@link PoleVerdict} when a pole at a bound was confirmed, `undefined`
 * otherwise. Poles strictly inside the bounds are not examined here (see
 * {@link interiorPoleVerdict}).
 *
 * The improper integral at a bound is a one-sided limit from inside the
 * interval, so only that side is sampled. The sign of the divergence is the
 * sign of the integrand on that side, next to the bound: `1/t` on `(0, 1]` is
 * positive, so `∫₀¹ dt/t` is `+∞`, and `1/t` on `[−1, 0)` is negative, so
 * `∫₋₁⁰ dt/t` is `−∞`. The order of the pole does not decide the sign. Poles
 * at both bounds with different signs give `mixed` (`∫₀¹ (1/t − 1/(1 − t))
 * dt` has no value). A reversed range swaps `positive` and `negative`, as in
 * {@link interiorPoleVerdict}.
 *
 * A site is located as in {@link interiorPoleVerdict}, and confirmed by
 * {@link endpointDivergesOnSide}, a stricter test than the interior one: it
 * samples much closer to the bound and extrapolates the pole order, so that
 * an integrable singularity with a logarithmic factor (`t^(−0.95)·ln t`,
 * whose order measured next to the bound is above 1) is rejected. A test
 * from samples cannot be certain for an order very close to 1, so the
 * callers use this verdict only when another method already found that the
 * integral has no finite value: the antiderivative is not finite at the
 * bounds, or the quadrature reports a divergence. This verdict then gives
 * the sign. When the test is not certain, the verdict is `undefined`, and
 * the caller keeps its result without a sign (`NaN`, or the integral
 * unevaluated).
 */
export function endpointPoleVerdict(
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

  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (!(lo < hi)) return undefined;

  // The range is widened by the rounding slack, so that a lattice site at a
  // bound (`tan t` at `π/2`) is not dropped by the rounding of `k`.
  const slack = (x: number) => ROUNDING_SLACK * Math.max(1, Math.abs(x));
  const scan = poleSites(
    integrand,
    variable,
    lo - slack(lo),
    hi + slack(hi),
    ce
  );
  if (scan === null || scan.sites.length === 0) return undefined;
  const sites = scan.sites;

  let verdict: PoleVerdict | undefined;
  for (const [bound, side] of [
    [lo, 1],
    [hi, -1],
  ] as const) {
    const atThisBound = sites.filter((site) => site.atBound(bound));
    if (atThisBound.length === 0) continue;

    // Sample from the bound toward the inside of the interval, close enough
    // to stay clear of every candidate site that is not at this bound.
    let reach = (hi - lo) / 100;
    for (const other of sites)
      if (!atThisBound.includes(other))
        reach = Math.min(reach, Math.abs(other.t - bound) / 100);
    if (!(reach > 0)) continue;

    const sign = endpointDivergesOnSide(
      integrand,
      variable,
      bound,
      side,
      reach,
      ce
    );
    if (sign === undefined) continue;
    if (verdict === undefined) verdict = { sign };
    else if (verdict.sign !== sign) verdict = { sign: 'mixed' };
  }
  if (verdict === undefined) return undefined;

  // Orientation: a reversed range negates the integral.
  if (a > b) {
    if (verdict.sign === 'positive') verdict = { sign: 'negative' };
    else if (verdict.sign === 'negative') verdict = { sign: 'positive' };
  }
  return verdict;
}

/**
 * Whether the polynomial coefficient `c` has a value that depends on a symbol
 * with no value (`a` in `t − a`, `2a + π` in `t − 2a − π`).
 */
function isFreeCoefficient(c: Expression): boolean {
  return constantRealValue(c) === null && c.unknowns.length > 0;
}

/**
 * Whether the symbol `name` has no value and was never declared: its type
 * was only inferred (`inferredType`), and does not say that it is real. In a
 * definite integral over a real interval, such a symbol is taken to be real,
 * as the antiderivatives already do (`∫ dt/(t − a)` is `ln|t − a|`).
 *
 * The decision reads the provenance of the type, not the type itself: an
 * inferred type changes with the history of the engine. The antiderivative
 * of `1/(x² + a²)` widens the inferred type of `a` to `complex | infinity`,
 * and a test of the type string (`number` or `unknown`) then left
 * `∫₀¹ dx/(x² + a² + 1)` unevaluated in that engine, while a new engine
 * evaluated it.
 *
 * A symbol declared by the user (`complex`, `number`, …) is left as it is.
 * So is a symbol with a real type (inferred, or narrowed by an assumption:
 * `ce.assume(a > 4)` makes it `real<4<..>`): it needs no declaration, and a
 * declaration would hide the assumption. A symbol whose inferred type is not
 * numeric (`boolean`, `string`, …) is not a real number either.
 */
function isUntypedFree(ce: ComputeEngine, name: string): boolean {
  const def = ce.lookupDefinition(name);
  if (!isValueDef(def) || def.value.isConstant === true) return false;
  if (def.value.value !== undefined && def.value.value !== null) return false;
  if (!def.value.inferredType) return false;
  const type = def.value.type;
  if (type.isUnknown) return true;
  return type.matches('number') && !type.matches('real');
}

/**
 * The proven sign of `d`, `-1` or `1`, or `undefined` when the sign is not
 * proven. Every symbol of `d` with no value and a type that does not say
 * whether it is real (see {@link isUntypedFree}) is taken to be real: `d` is
 * read again in a scope where these symbols are declared `real`, so that
 * `a² + 1` is proven positive. A symbol whose type was narrowed by an
 * assumption (`ce.assume(a > 4)` makes it `real<4<..>`) is not redeclared,
 * so the assumption still applies.
 */
function realSign(d: Expression, ce: ComputeEngine): -1 | 1 | undefined {
  const read = (e: Expression): -1 | 1 | undefined => {
    if (e.isNegative === true) return -1;
    if (e.isPositive === true) return 1;
    // A sum of terms with symbols and of a constant `K` with a numeric value
    // (`a − sin 1`): the sign is not always proven with `K` itself, so it is
    // proven with a number just below `K` (for a positive sign) or just
    // above it (for a negative sign). `a − 0.8414709838 > 0` proves
    // `a − sin 1 > 0`.
    if (!isFunction(e, 'Add')) return undefined;
    const fixed = e.ops.filter((op) => op.unknowns.length === 0);
    const rest = e.ops.filter((op) => op.unknowns.length > 0);
    if (fixed.length === 0 || rest.length === 0) return undefined;
    if (fixed.every((op) => isNumber(op) && op.isNumberLiteral))
      return undefined;
    const k = constantRealValue(ce.function('Add', fixed));
    if (k === null) return undefined;
    const margin = 1e-9 * Math.max(1, Math.abs(k));
    const withConstant = (c: number) =>
      ce.function('Add', [...rest, ce.number(c)]);
    if (withConstant(k - margin).isPositive === true) return 1;
    if (withConstant(k + margin).isNegative === true) return -1;
    return undefined;
  };
  const names = d.unknowns.filter((name) => isUntypedFree(ce, name));
  if (names.length === 0) return read(d);
  ce.pushScope();
  try {
    for (const name of names) ce.declare(name, 'real');
    return read(ce.box(d.json));
  } finally {
    ce.popScope();
  }
}

/**
 * Generic real values given to the free symbols of an integrand, to sample
 * it: values that are unlikely to make a factor zero or to put a pole on a
 * bound.
 */
const FREE_SYMBOL_SAMPLES = [
  0.6180339887498949, -1.324717957244746, 2.23606797749979,
];

/**
 * Whether `term`, a function of `variable` only, is monotone on `[lo, hi]`:
 * a numeric multiple of `F(c₁·t + c₀)` with numeric coefficients, where `F`
 * is one of `exp`, `ln`, `√`, `arctan`, `sinh`, `tanh`, `arsinh`, a power of
 * a positive constant, a power of an argument that is positive on the
 * interval, or `sin`/`cos` when the argument stays in one interval on which
 * they are monotone.
 */
function isMonotoneOn(
  term: Expression,
  variable: string,
  lo: number,
  hi: number
): boolean {
  if (isFunction(term, 'Negate')) term = term.op1;
  if (isFunction(term, 'Multiply')) {
    const dependent = term.ops.filter((op) => op.has(variable));
    if (dependent.length !== 1) return false;
    if (
      term.ops.some((op) => !op.has(variable) && constantRealValue(op) === null)
    )
      return false;
    term = dependent[0];
  }
  if (!isFunction(term)) return false;
  // The range `[u₁, u₂]` of the linear argument `arg` on the interval.
  const argRange = (arg: Expression): [number, number] | null => {
    const linear = linearArgument(arg, variable);
    if (linear === null) return null;
    const [c0, c1] = linear;
    const a = c1 * lo + c0;
    const b = c1 * hi + c0;
    return [Math.min(a, b), Math.max(a, b)];
  };
  if (term.operator === 'Power') {
    if (!term.op1.has(variable)) {
      const base = constantRealValue(term.op1);
      return base !== null && base > 0 && argRange(term.op2) !== null;
    }
    const range = argRange(term.op1);
    return (
      range !== null &&
      range[0] > 0 &&
      isNumber(term.op2) &&
      term.op2.isNumberLiteral &&
      !term.op2.isComplex
    );
  }
  const range = argRange(term.op1);
  if (range === null) return false;
  switch (term.operator) {
    case 'Exp':
    case 'Ln':
    case 'Sqrt':
    case 'Arctan':
    case 'Sinh':
    case 'Tanh':
    case 'Arsinh':
      return true;
    case 'Sin':
      return (
        Math.floor((range[0] + Math.PI / 2) / Math.PI) ===
        Math.floor((range[1] + Math.PI / 2) / Math.PI)
      );
    case 'Cos':
      return Math.floor(range[0] / Math.PI) === Math.floor(range[1] / Math.PI);
  }
  return false;
}

/**
 * Whether the pole sites of `integrand` include a lattice of a circular
 * function (`tan t`, `1/sin t`): the sites that {@link poleSites} enumerates
 * between two bounds. Without numeric bounds the lattice cannot be
 * enumerated.
 */
function hasPoleLattice(integrand: Expression, variable: string): boolean {
  let budget = SCAN_NODE_BUDGET;
  const inDenominator = (d: Expression): boolean => {
    if (budget-- <= 0 || !isFunction(d) || !d.has(variable)) return false;
    if (d.operator === 'Multiply') return d.ops.some(inDenominator);
    if (d.operator === 'Power') {
      const k = d.op2;
      return (
        isNumber(k) && k.isNumberLiteral && k.re > 0 && inDenominator(d.op1)
      );
    }
    return ZERO_LATTICE_PHASE[d.operator] !== undefined;
  };
  const walk = (e: Expression): boolean => {
    if (budget-- <= 0 || !isFunction(e)) return false;
    if (e.operator === 'Divide' && inDenominator(e.op2)) return true;
    if (e.operator === 'Power') {
      const k = e.op2;
      if (isNumber(k) && k.isNumberLiteral && k.re < 0 && inDenominator(e.op1))
        return true;
    }
    if (POLE_LATTICE_PHASE[e.operator] !== undefined && e.op1.has(variable))
      return true;
    return e.ops.some(walk);
  };
  return walk(integrand);
}

/**
 * Whether `integrand` MAY have a pole in the closed interval between `lower`
 * and `upper` that the antiderivative difference cannot see: a pole whose
 * position depends on a symbol with no value, a pole that depends on such a
 * symbol to exist, or a pole at a fixed position when a bound depends on
 * such a symbol. `(y − a)⁻²` has a pole at `y = a`, which is inside `[0, 4]`
 * for `0 ≤ a ≤ 4`. Then the antiderivative difference (`−1/a − 1/(4 − a)`)
 * is wrong for those values of `a`, since the integral diverges there, and
 * the caller keeps the integral unevaluated.
 *
 * The pole sites are the ones {@link interiorPoleVerdict} locates, with
 * coefficients that are expressions instead of numbers: the roots of a
 * polynomial divisor of degree 1 or 2 (`1/(t − a)`, `1/(a·t + 1)`,
 * `1/(t² − a)`), examined factor by factor for a product
 * (`1/((t − a)(t − b))`), and through a square root, an absolute value or a
 * power (`1/√(t − a)`, `(t − a)^(−n)`, where a power whose exponent is not
 * a number and not proven positive counts as a divisor); the zero of a
 * logarithmic divisor of a linear argument (`1/ln(t − a)` at `t = a + 1`);
 * the one pole of `csch`/`coth` and zero of a `sinh`/`tanh` divisor of a
 * linear argument; and the zero of a divisor `g(t) − c`, where `g` is
 * monotone on the interval (see {@link isMonotoneOn}) and `c` does not
 * depend on the variable (`1/(eᵗ − a)`): it is inside the interval when `c`
 * is between `g(lower)` and `g(upper)`.
 *
 * A site is outside the interval when its distance to both bounds has a
 * proven sign, from the declared types of the symbols or from the
 * assumptions (`a` declared `real<..<0>`, or `ce.assume(a > 4)`). A
 * quadratic divisor whose discriminant is proven negative has no real root.
 * A symbol with no value and no declared real or complex type is taken to
 * be real in these proofs (see {@link realSign}).
 *
 * Some sites cannot be located, and give `true`: a polynomial divisor of
 * degree 3 or more with a free coefficient, the pole lattice of a circular
 * function with a free symbol in its argument (`tan(t − a)`), and any other
 * divisor with a free symbol whose zeros no rule above locates.
 *
 * A site at a NUMBER (`t = 0` in `1/(t·(t² + a² + 1))`) is located by
 * {@link poleSites}. When the integrand has another free symbol, its samples
 * are not numbers, so the caller could not confirm the pole: the free
 * symbols are given a few generic real values (`FREE_SYMBOL_SAMPLES`) and
 * the site is a possible pole when the integrand diverges next to it for
 * one of them. A removable site (`a·sin(t)/t` at `t = 0`) gives `false`.
 * When a bound depends on a free symbol (`∫ₐ¹ dt/t`), every confirmed site
 * at a number must be proven outside the interval in the same way as a site
 * with a free position; a pole lattice then gives `true`, since it cannot be
 * enumerated without numeric bounds. A scan over {@link SCAN_NODE_BUDGET}
 * nodes gives `false`.
 *
 * `integrand` must have the values of the assigned symbols substituted (the
 * caller uses `withAssignedValues`), so that every symbol left in it, other
 * than `variable`, has no value.
 *
 * `ranges` gives the integration variables of the enclosing integrals and
 * their bounds. A site that depends on one of them is examined over its
 * range: in `∫₀¹⁰ ∫₃⁴ (y − x)⁻² dx dy`, the pole of the integral in `x` is at
 * `x = y`, which is in `[3, 4]` for some `y` of `[0, 10]`, while in
 * `∫₅¹⁰ ∫₃⁴ (y − x)⁻² dx dy` it is outside `[3, 4]` for every `y`. The
 * distance from the site to a bound must then be linear in each of these
 * variables (there are at most three): its sign is proven at every corner of
 * the box of their ranges, which proves it on the whole box.
 */
export function symbolicPoleMayBeInside(
  integrand: Expression,
  variable: string,
  lower: Expression,
  upper: Expression,
  ce: ComputeEngine,
  ranges: ReadonlyArray<{
    name: string;
    lower: Expression;
    upper: Expression;
  }> = []
): boolean {
  const sites: Expression[] = [];
  // The zeros of a divisor `g(t) − c` with `g` monotone on the interval:
  // the zero is inside when `c` is between `low = min(g)` and
  // `high = max(g)` on the interval.
  const monotoneZeros: { c: Expression; low: Expression; high: Expression }[] =
    [];
  let budget = SCAN_NODE_BUDGET;
  // A site with a free position that could not be located.
  let unlocated = false;

  // The bounds as numbers, when they are finite real numbers.
  const lo = finiteRealValue(lower);
  const hi = finiteRealValue(upper);

  const hasFree = (e: Expression): boolean =>
    e.unknowns.some((name) => name !== variable);

  // The coefficients `[c₀, c₁]` of a linear argument `c₁·t + c₀` when one of
  // them is free, or `null`.
  const freeLinear = (arg: Expression): [Expression, Expression] | null => {
    const coeffs = getPolynomialCoefficients(arg, variable);
    if (coeffs === null || coeffs.length !== 2) return null;
    if (!coeffs.some(isFreeCoefficient)) return null;
    return [coeffs[0], coeffs[1]];
  };

  // The point where `c₁·t + c₀ = value`.
  const linearSite = ([c0, c1]: [Expression, Expression], value: number) =>
    ce.function('Divide', [
      ce.function('Subtract', [ce.number(value), c0]),
      c1,
    ]);

  // Add the real roots of the polynomial `poly`, and return whether `poly` is
  // a polynomial in the variable.
  const addPolynomialRoots = (poly: Expression): boolean => {
    if (!poly.has(variable)) return true;
    const coeffs = getPolynomialCoefficients(poly, variable);
    if (coeffs === null) return false;
    if (coeffs.length < 2 || !coeffs.some(isFreeCoefficient)) return true;
    if (coeffs.length === 2) {
      sites.push(linearSite([coeffs[0], coeffs[1]], 0));
      return true;
    }
    if (coeffs.length === 3) {
      const [c0, c1, c2] = coeffs;
      const discriminant = ce.function('Subtract', [
        ce.function('Power', [c1, ce.number(2)]),
        ce.function('Multiply', [ce.number(4), c2, c0]),
      ]);
      if (realSign(discriminant, ce) === -1) return true;
      const root = ce.function('Sqrt', [discriminant]);
      const twice = ce.function('Multiply', [ce.number(2), c2]);
      for (const r of [root, ce.function('Negate', [root])])
        sites.push(
          ce.function('Divide', [ce.function('Subtract', [r, c1]), twice])
        );
      return true;
    }
    unlocated = true;
    return true;
  };

  // Record the zero of the divisor `d = g(t) + rest`, where `g` is monotone
  // on the interval and has no free symbol, and `rest` does not depend on
  // the variable. Return whether `d` has this form.
  const addMonotoneZero = (d: Expression): boolean => {
    if (lo === null || hi === null || !isFunction(d, 'Add')) return false;
    const dependent = d.ops.filter((op) => op.has(variable));
    if (dependent.length !== 1) return false;
    const g = dependent[0];
    if (hasFree(g)) return false;
    if (!isMonotoneOn(g, variable, Math.min(lo, hi), Math.max(lo, hi)))
      return false;
    const atLower = valueAt(g, variable, lo, ce);
    const atUpper = valueAt(g, variable, hi, ce);
    if (!Number.isFinite(atLower) || !Number.isFinite(atUpper)) return false;
    const gLower = g.subs({ [variable]: lower });
    const gUpper = g.subs({ [variable]: upper });
    const c = ce.function('Negate', [
      ce.function(
        'Add',
        d.ops.filter((op) => !op.has(variable))
      ),
    ]);
    monotoneZeros.push(
      atLower <= atUpper
        ? { c, low: gLower, high: gUpper }
        : { c, low: gUpper, high: gLower }
    );
    return true;
  };

  const addDenominatorSites = (d: Expression): void => {
    if (budget-- <= 0) return;
    if (!d.has(variable)) return;
    if (isFunction(d, 'Multiply')) {
      for (const factor of d.ops) addDenominatorSites(factor);
      return;
    }
    // The zeros of `−u`, `√u`, `|u|` and `u/v` are zeros of `u`.
    if (
      isFunction(d, 'Negate') ||
      isFunction(d, 'Sqrt') ||
      isFunction(d, 'Abs') ||
      isFunction(d, 'Divide')
    ) {
      addDenominatorSites(d.op1);
      return;
    }
    if (isFunction(d, 'Power')) {
      const exponent = d.op2;
      if (isNumber(exponent) && exponent.isNumberLiteral) {
        if (exponent.re > 0) addDenominatorSites(d.op1);
        return;
      }
      // An exponent that is not a number: the zeros of the base are zeros
      // of `d` when the exponent is positive, and are kept as candidates
      // when its sign is not proven.
      if (realSign(exponent, ce) !== -1) addDenominatorSites(d.op1);
      return;
    }
    if (addPolynomialRoots(d)) return;
    if (!isFunction(d)) return;
    if (d.operator === 'Exp') return;
    if (d.operator === 'Ln' || d.operator === 'Log') {
      const linear = freeLinear(d.op1);
      if (linear !== null) sites.push(linearSite(linear, 1));
      else if (hasFree(d.op1)) unlocated = true;
      return;
    }
    if (ZERO_LATTICE_PHASE[d.operator] !== undefined) {
      if (hasFree(d.op1)) unlocated = true;
      return;
    }
    if (d.operator === 'Sinh' || d.operator === 'Tanh') {
      const linear = freeLinear(d.op1);
      if (linear !== null) sites.push(linearSite(linear, 0));
      else if (hasFree(d.op1)) unlocated = true;
      return;
    }
    // A divisor with a free symbol whose zeros no rule above locates
    // (`eᵗ − a`, `sin t − a`): its zero is located when it is a monotone
    // function minus a constant, and is unknown otherwise.
    if (hasFree(d) && !addMonotoneZero(d)) unlocated = true;
  };

  const walk = (e: Expression): boolean => {
    if (budget-- <= 0) return false;
    if (!isFunction(e)) return true;
    if (e.operator === 'Divide') addDenominatorSites(e.op2);
    else if (e.operator === 'Power') {
      const exponent = e.op2;
      if (isNumber(exponent) && exponent.isNumberLiteral) {
        if (exponent.re < 0) addDenominatorSites(e.op1);
      } else if (e.op1.has(variable) && realSign(exponent, ce) !== 1) {
        // An exponent that is not a number and not proven positive
        // (`(t − a)^(−n)`): the zeros of the base may be poles.
        addDenominatorSites(e.op1);
      }
    } else if (POLE_LATTICE_PHASE[e.operator] !== undefined) {
      if (hasFree(e.op1)) unlocated = true;
    } else if (e.operator === 'Csch' || e.operator === 'Coth') {
      const linear = freeLinear(e.op1);
      if (linear !== null) sites.push(linearSite(linear, 0));
      else if (hasFree(e.op1)) unlocated = true;
    }
    for (const op of e.ops) if (!walk(op)) return false;
    return true;
  };

  if (!walk(integrand) || budget <= 0) return false;
  if (unlocated) return true;

  // The sign of `site − bound`, proven for every value of the variables of
  // the enclosing integrals it depends on.
  const sign = (site: Expression, bound: Expression): -1 | 1 | undefined => {
    const d = ce.function('Subtract', [site, bound]);
    const outer = ranges.filter((r) => d.has(r.name));
    if (outer.length === 0) return realSign(d, ce);
    if (outer.length > 3) return undefined;
    for (const r of outer) {
      const coeffs = getPolynomialCoefficients(d, r.name);
      if (coeffs === null || coeffs.length > 2) return undefined;
    }
    let result: -1 | 1 | undefined;
    for (let corner = 0; corner < 1 << outer.length; corner++) {
      const values: Record<string, Expression> = {};
      outer.forEach((r, k) => {
        values[r.name] = (corner >> k) & 1 ? r.upper : r.lower;
      });
      // `subs()` does not fold an infinite bound (`y − 3` at `y = +∞` is
      // `−3 + ∞`), `evaluate()` does.
      const s = realSign(d.subs(values).evaluate(), ce);
      if (s === undefined || (result !== undefined && s !== result))
        return undefined;
      result = s;
    }
    return result;
  };

  // The sites at a NUMBER (see the description above). A bound is "free"
  // when it is not a number and depends on a symbol with no value.
  const isFreeBound = (b: Expression) =>
    finiteRealValue(b) === null &&
    b.isInfinity !== true &&
    b.unknowns.length > 0;
  const freeBound = isFreeBound(lower) || isFreeBound(upper);
  const freeNames = integrand.unknowns.filter((name) => name !== variable);
  const numericBounds =
    lo !== null && hi !== null && Number.isFinite(lo) && Number.isFinite(hi);
  if (freeBound && hasPoleLattice(integrand, variable)) return true;
  if (freeBound || (freeNames.length > 0 && numericBounds && lo !== hi)) {
    const [wLo, wHi] =
      numericBounds && lo !== hi
        ? [Math.min(lo!, hi!), Math.max(lo!, hi!)]
        : [-1, 1];
    // The integrand with the free symbols given generic values, once per
    // sample; the integrand itself when it has no free symbol.
    const samples: Record<string, Expression>[] =
      freeNames.length === 0
        ? [{}]
        : FREE_SYMBOL_SAMPLES.map((_, k) => {
            const values: Record<string, Expression> = {};
            freeNames.forEach((name, j) => {
              values[name] = ce.number(
                FREE_SYMBOL_SAMPLES[(j + k) % FREE_SYMBOL_SAMPLES.length]
              );
            });
            return values;
          });
    // The numeric sites at which the integrand diverges for some sample.
    const confirmed: number[] = [];
    for (const values of samples) {
      const g = freeNames.length === 0 ? integrand : integrand.subs(values);
      const scan = poleSites(g, variable, wLo, wHi, ce);
      if (scan === null) continue;
      // The positions of the sites with a free position, for these values:
      // those sites are examined below, not here.
      const moving = sites
        .map((site) => finiteRealValue(site.subs(values)))
        .filter((t): t is number => t !== null);
      const positions = scan.sites.map((site) => site.t);
      for (const site of scan.sites) {
        const t = site.t;
        if (
          moving.some((m) => Math.abs(m - t) <= 1e-9 * Math.max(1, Math.abs(t)))
        )
          continue;
        let reach = 1e-2 * Math.max(1, Math.abs(t));
        if (!freeBound) {
          if (!(t > wLo && t < wHi) || site.atBound(wLo) || site.atBound(wHi))
            continue;
          reach = Math.min(reach, (t - wLo) / 100, (wHi - t) / 100);
        }
        for (const other of positions)
          if (other !== t) reach = Math.min(reach, Math.abs(other - t) / 100);
        if (!(reach > 0)) continue;
        const left = divergesOnSide(g, variable, t, -1, reach, ce);
        const right = divergesOnSide(g, variable, t, 1, reach, ce);
        // Inside numeric bounds, the caller's test: a pole on both sides.
        // With a free bound, a pole on either side, since the interval may
        // end at the site.
        if (!freeBound) {
          if (left !== undefined && right !== undefined) return true;
        } else if (left !== undefined || right !== undefined) confirmed.push(t);
      }
    }
    for (const t of confirmed) {
      const s = sign(ce.number(t), lower);
      if (s === undefined || s !== sign(ce.number(t), upper)) return true;
    }
  }

  for (const site of sites) {
    const s = sign(site, lower);
    if (s === undefined || s !== sign(site, upper)) return true;
  }
  for (const { c, low, high } of monotoneZeros) {
    if (sign(c, low) === -1 || sign(c, high) === 1) continue;
    return true;
  }
  return false;
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

/**
 * Whether `integrand` takes real values on the interval between the bounds
 * `lower` and `upper`, as far as three samples tell: at a quarter, half and
 * three quarters of the interval, the integrand must evaluate to a real
 * number. A bound that is not a finite real number gives `false`.
 */
export function isRealOnInterval(
  integrand: Expression,
  variable: string,
  lower: Expression | number | undefined,
  upper: Expression | number | undefined,
  ce: ComputeEngine
): boolean {
  const a = typeof lower === 'number' ? lower : finiteRealValue(lower);
  const b = typeof upper === 'number' ? upper : finiteRealValue(upper);
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b))
    return false;
  if (!integrand.isPure) return false;
  for (const w of [0.25, 0.5, 0.75])
    if (!Number.isFinite(valueAt(integrand, variable, a + w * (b - a), ce)))
      return false;
  return true;
}
