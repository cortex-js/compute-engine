import {
  bigBetaRegularized,
  bigGammaQ,
  betaRegularized,
  gammaQ,
} from '../numerics/special-functions.js';
import { apply2, applyN, shouldNumericize } from '../boxed-expression/apply.js';
import {
  isAbsentValue,
  isFunction,
  isNumber,
} from '../boxed-expression/type-guards.js';
import {
  dataConstraintError,
  hasNonFiniteImaginaryPart,
  nonRealDataError,
  nonRealDatum,
} from './statistics-data.js';
import { typeFact } from '../boxed-expression/operand-descriptor.js';
import { nonNegativeSign, positiveSign } from '../boxed-expression/sgn.js';
import {
  infinitePoint,
  isNonPositiveIntegerLiteral,
  isRealLiteral,
} from '../boxed-expression/infinite-point.js';
import { parseType } from '../../common/type/parse.js';
import {
  binomialQuantile,
  poissonQuantile,
} from '../numerics/distributions.js';
import type {
  Expression,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

//
// Probability distributions (Phase 1).
//
// Distributions are first-class inert *values* built by constructor heads
// (`NormalDistribution`, …), Mathematica-style. The generic `PDF`/`CDF`/
// `Quantile` operators consume them and **lower to a closed form** — a plain
// expression in the remaining symbolic arguments — so display, `simplify`,
// `D`, `Integrate`, `compile`, and plotting all work with no
// distribution-specific support. See `docs/plans/2026-07-04-statistics-design.md`.
//
// The two regularized incomplete functions the discrete CDFs lower to
// (`GammaRegularized`, `BetaRegularized`) are exposed as first-class special
// functions here as well, following the `Erf` template in `library/statistics.ts`.
//

const DISTRIBUTION_HEADS = [
  'NormalDistribution',
  'BinomialDistribution',
  'PoissonDistribution',
  'UniformDistribution',
  'ExponentialDistribution',
];

/** True if `x` is one of the five distribution constructor expressions. */
export function isDistributionExpression(x: Expression): boolean {
  return DISTRIBUTION_HEADS.includes(x.operator);
}

/** Operands of a distribution expression (always a function). */
function distOps(dist: Expression): ReadonlyArray<Expression> {
  return isFunction(dist) ? dist.ops : [];
}

/**
 * True when `x` is a number literal at a finite point of the real line —
 * the carrier every distribution parameter declares. A `NaN`, a signed
 * infinity, `~oo` and a genuinely complex value all answer `false`.
 *
 * This is a question about the VALUE, so it never consults the machine
 * projection `x.re`: a finite bignum beyond the double range (`10^400`)
 * projects `re` to `Infinity` and is nonetheless a finite real.
 */
function isFiniteRealLiteral(x: Expression): boolean {
  return isNumber(x) && x.im === 0 && x.isFinite === true;
}

/**
 * The machine-comparable value of a number literal, or `undefined` when
 * there is none: a non-literal, a non-finite point, or a finite real whose
 * magnitude falls outside the double range — `10^400` projects `re` to
 * `Infinity`, and an exact `10^-400` projects it to `0`.
 *
 * A caller that gets `undefined` must fall through to the symbolic/exact
 * route, never treat the point as absent from the support: comparing the
 * `Infinity` projection of `10^400` against the support of
 * `UniformDistribution(0, 10^500)` answered `CDF = 1` instead of `10^-100`.
 */
function litVal(x: Expression): number | undefined {
  if (!isFiniteRealLiteral(x)) return undefined;
  const v = x.re;
  if (!Number.isFinite(v)) return undefined;
  // A nonzero magnitude that underflows the double range would compare equal
  // to the support bound `0` and lose the same way an overflow does.
  if (v === 0 && x.sgn !== 'zero') return undefined;
  return v;
}

/**
 * The order of two finite real number literals: `-1` for `x < y`, `0` for
 * `x = y`, `1` for `x > y`, and `undefined` when either operand is not such
 * a literal (a symbol, an infinity, `NaN`, a complex value).
 *
 * A support test asks this rather than comparing `litVal` doubles, because
 * a magnitude outside the double range has no double to compare: `10^400`
 * and `10^500` both project to `Infinity`, so `10^400 < 10^500` is not
 * decided by the projections. When either operand is off the double scale
 * the answer is read from the SIGN of the exact difference, which the
 * bignum arithmetic computes exactly.
 *
 * Two DISTINCT exact literals can also round to the SAME double — an exact
 * rational within an ulp of a support bound, such as `1 + 10^(-20)` against
 * `1` — so equal projections are not evidence of equality: they too fall
 * through to the exact difference. Reporting them equal put a point just
 * OUTSIDE a support at the boundary (`PDF(UniformDistribution(0, 1),
 * 1 + 10^(-20))` answered the density instead of 0).
 */
function litOrder(
  ce: ComputeEngine,
  x: Expression,
  y: Expression
): -1 | 0 | 1 | undefined {
  if (!isFiniteRealLiteral(x) || !isFiniteRealLiteral(y)) return undefined;
  const xv = litVal(x);
  const yv = litVal(y);
  if (xv !== undefined && yv !== undefined) {
    if (xv < yv) return -1;
    if (xv > yv) return 1;
    if (x.isSame(y)) return 0;
  }
  const s = ce.function('Subtract', [x, y]).evaluate().sgn;
  if (s === 'negative') return -1;
  if (s === 'positive') return 1;
  if (s === 'zero') return 0;
  return undefined;
}

/** Build an out-of-range error node for a bad literal parameter. */
function rangeError(ce: ComputeEngine, expected: string, x: Expression) {
  return ce.error(['out-of-range', expected, x.toString()]);
}

/**
 * The `incompatible-type` error a distribution constructor raises for a
 * parameter literal outside its declared carrier, in the shape the boxing
 * seam mints for an operand that fails signature validation. The location
 * names the constructor alongside the offending literal, as
 * `dataConstraintError` (`library/statistics-data.ts`) does for a datum: an
 * error read on its own has to say which head raised it.
 *
 * The five constructors have a `canonical` handler, and a head with one is
 * NOT validated against its declared signature: `applyOperatorDefinition`
 * (`boxed-expression/box.ts`) re-runs only the lenient `checkNumericArgs` on
 * the handler's result, which rejects a provably non-numeric operand
 * (`NormalDistribution("a", 1)` errors today) but admits `NaN`, the signed
 * infinities, `~oo` and the complex numbers. The handler is therefore the
 * enforcement seam for the carriers these definitions declare — the same
 * arrangement as `Power` (`library/arithmetic.ts`), and a tracked timing
 * deviation of `docs/SIGNATURE-GUIDELINES.md` §4.
 */
function carrierError(
  ce: ComputeEngine,
  name: string,
  expected: string,
  x: Expression
) {
  return ce.error(
    ['incompatible-type', expected, x.type.toString()],
    `${name}: ${x}`
  );
}

/**
 * True when `x` is a number literal that is not a finite real: `NaN`, a
 * signed infinity, the complex infinity `~oo`, or a genuinely complex value.
 * Every distribution parameter carries `real` (or a range below it), so such
 * a literal is off-carrier.
 *
 * A SYMBOL answers `false` here whatever it holds — canonicalization does not
 * read a symbol's value, so an off-carrier value reaching a parameter through
 * a symbol is not caught (the ROADMAP item "a distribution parameter held by
 * a symbol is not validated").
 *
 * Membership of the carrier is asked of the VALUE (`isFiniteRealLiteral`),
 * never of the machine projection: `NormalDistribution(0, 10^400)` has a
 * finite real standard deviation and is a valid distribution, even though
 * `10^400` has no double.
 */
function offRealCarrier(x: Expression): boolean {
  return isNumber(x) && !isFiniteRealLiteral(x);
}

/**
 * `1` for `+oo`, `-1` for `-oo`, `undefined` for anything else — including
 * `~oo`, whose imaginary part is infinite.
 *
 * The signed infinities are the only non-finite points the `PDF`/`CDF`
 * carrier `real | signed_infinity` admits, and every distribution here has
 * the same limits there: the density vanishes and the CDF reaches its
 * bounds.
 *
 * The classification is asked of `infinitePoint`, which reads the numeric
 * value, and never of the machine projection `x.re`: a FINITE bignum beyond
 * the double range (`10^400`) projects `re` to `Infinity`, and such a point
 * must reach the closed form rather than the limit.
 */
function signedInfinitySign(x: Expression): 1 | -1 | undefined {
  const p = infinitePoint(x);
  if (p === '+oo') return 1;
  if (p === '-oo') return -1;
  return undefined;
}

/** The closed unit interval, the proven-domain claim for
 * `BetaRegularized`'s first operand (a literal `0.5` subtypes it; a bare
 * `real` symbol does not, and stays on the wide claim). */
const UNIT_INTERVAL = parseType('real<0..1>')!;

/**
 * Largest first operand for which `GammaRegularized(n, z)` expands to its
 * finite closed form `e^{−z}·Σ_{k<n} z^k/k!`. The sum has `n` terms, so a
 * large `n` would materialize a long expression for no benefit — above the
 * cap the numeric kernel answers instead (on the `z ≥ 0` half it covers).
 */
const MAX_GAMMA_Q_SERIES_ORDER = 20;

/** Whether `x` is provably a positive, finite value. */
function isProvablyPositiveFinite(x: Expression): boolean {
  return x.isPositive === true && x.isFinite === true;
}

/**
 * Whether `x` is PROVABLY finite. An unproven operand answers `false`: a
 * symbol whose type admits an infinity (`real | signed_infinity`, or the
 * `complex | infinity` carrier the Γ-family slots declare) reports
 * `isFinite === undefined`, and folding on that would be irreversible.
 */
function isProvablyFinite(x: Expression): boolean {
  return x.isFinite === true;
}

/**
 * The value of `GammaRegularized(a, z) = Γ(a, z)/Γ(a)` when at least one
 * operand is an infinite point, or `undefined` when both are finite. Exact,
 * so given on `evaluate()` and `.N()` alike. Each limit was verified against
 * an independent high-precision computation at 10², 10⁴ and 10⁶:
 *
 * - `Q(a, +∞) = 0` for every PROVABLY finite `a`: the `e^{−t}` tail of
 *   `Γ(a, z)` vanishes while `Γ(a)` stays put (`Q(2, 10⁶) = 10^(−434289)`),
 *   and where `Γ(a)` is a pole `Q` is identically 0 anyway. An `a` whose
 *   finiteness is NOT proven — a symbol whose type admits an infinity — stays
 *   symbolic, because the value at an infinite `a` is different (`NaN`) and
 *   the fold could not be taken back.
 * - `Q(+∞, z) = 1` for every provably finite `z`, negative `z` included
 *   (`Q(10⁶, −5) = 1`): the mass of `Γ(a, ·)` moves out past any fixed `z`.
 *   An unproven `z` stays symbolic, as above.
 * - `Q(n, −∞) = (−1)^{n−1}·∞` for a positive INTEGER `n`. The closed form
 *   `Q(n, z) = e^{−z}·Σ_{k<n} z^k/k!` has leading term `z^{n−1}/(n−1)!`, so
 *   at `z → −∞` the sum takes the sign `(−1)^{n−1}` while `e^{−z}` grows
 *   without bound. Measured at `z = −10²`, `−10⁴` and `−10⁶`: `n = 1` gives
 *   `+2.7·10^43`, `+8.8·10^4342`, `+3.0·10^434294`; `n = 2` gives
 *   `−2.7·10^45`, `−8.8·10^4346`, `−3.0·10^434300`; `n = 3` gives
 *   `+1.3·10^47`, `+4.4·10^4350`, `+1.5·10^434306`; `n = 4` gives
 *   `−4.3·10^48`, `−1.5·10^4354`, `−5.1·10^434311`.
 * - `Q(a, −∞) = 0` for a NON-POSITIVE integer `a`, where `1/Γ(a)` vanishes:
 *   the finite branch gives `Q(a, z) = 0` at every nonzero `z` there, so the
 *   limit is `0` too.
 * - `Q(a, −∞) = NaN` for a real literal `a` that is provably not an integer:
 *   the value is complex on the negative half-line (`Q(0.5, −1) = 1 − 1.65i`),
 *   so it has no limit on the extended real line. An `a` that is not a
 *   literal stays SYMBOLIC — a symbol declared `integer` may hold a positive
 *   integer, whose value is `±∞` by the rows above, and `NaN` could not be
 *   taken back.
 * - `Q(−∞, z)`: `NaN`. `Q` is identically 0 at every negative integer `a`
 *   (a pole of `Γ(a)`) and diverges to `−∞` between consecutive poles
 *   (`Q(−10⁶−¼, 2) = −7·10^5264672`), so there is no limit.
 * - `~oo` in either slot, an anonymous infinity such as `∞ + i`, or two
 *   infinite operands: `NaN`.
 */
function gammaRegularizedValueAtInfinity(
  a: Expression,
  z: Expression,
  ce: ComputeEngine
): Expression | undefined {
  const pa = infinitePoint(a);
  const pz = infinitePoint(z);
  if (pa === undefined && pz === undefined) return undefined;
  if (pa === 'anonymous' || pz === 'anonymous') return ce.NaN;
  if (pa !== undefined && pz !== undefined) return ce.NaN;
  if (pz === '+oo') return isProvablyFinite(a) ? ce.Zero : undefined;
  if (pz === '-oo') {
    // Only a LITERAL `a` is classified. A symbol — declared `integer`, or
    // fresh — may later hold a positive integer, whose value here is `±∞`
    // rather than the `NaN` a blanket answer would freeze in, so it stays
    // symbolic.
    if (!isRealLiteral(a)) return undefined;
    if (a.isInteger === true && a.isPositive === true)
      return a.isOdd === true ? ce.PositiveInfinity : ce.NegativeInfinity;
    // `Q(a, z) = 0` at every non-positive integer `a` and every nonzero
    // finite `z` (`1/Γ(a)` vanishes at a pole of `Γ`), so the limit as
    // `z → −∞` is `0` as well.
    if (isNonPositiveIntegerLiteral(a)) return ce.Zero;
    // A real literal that is provably not an integer: `Q` is complex on the
    // negative half-line (`Q(0.5, −1) = 1 − 1.65i`), so it has no limit on
    // the extended real line. (A `NaN` literal answers here too, matching
    // the `NaN` policy the framework applies on the other routes.)
    if (a.isInteger === false) return ce.NaN;
    return undefined;
  }
  if (pz !== undefined) return ce.NaN;
  if (pa === '+oo') return isProvablyFinite(z) ? ce.One : undefined;
  return ce.NaN;
}

/**
 * `GammaRegularized(n, z) = e^{−z}·Σ_{k<n} z^k/k!` for a positive integer
 * `n`. Repeated integration by parts of `∫_z^∞ t^{n−1}e^{−t} dt` gives this
 * finite sum, so it is an exact closed form and it holds on the whole real
 * line — for `z < 0` too, where the numeric kernel (which needs `z ≥ 0`) has
 * nothing to say. Checked against the kernel at `(2, 3)`, `(3, 2.5)` and
 * against a high-precision incomplete-gamma at `(2, −1) = 0`,
 * `(3, −1) = 1.359…`, `(4, −2) = −2.463…`, `(5, −10) = 6409701.5…`.
 */
function gammaRegularizedSeries(
  n: number,
  z: Expression,
  ce: ComputeEngine,
  numericApproximation: boolean | undefined
): Expression {
  const terms: Expression[] = [ce.One];
  let factorial = 1n;
  for (let k = 1; k < n; k++) {
    factorial *= BigInt(k);
    terms.push(
      ce.function('Divide', [
        ce.function('Power', [z, ce.number(k)]),
        ce.number(factorial),
      ])
    );
  }
  const r = ce.function('Multiply', [
    ce.function('Exp', [ce.function('Negate', [z])]),
    ce.function('Add', terms),
  ]);
  return numericApproximation ? r.N() : r.evaluate();
}

/**
 * The value of `BetaRegularized(x, a, b) = I_x(a, b)` when at least one
 * operand is an infinite point, or `undefined` where nothing is established.
 * Exact, so given on `evaluate()` and `.N()` alike; verified against an
 * independent high-precision computation.
 *
 * The head answers on the region the incomplete beta integral converges on —
 * `x ∈ [0, 1]`, `a > 0`, `b > 0` — and stays symbolic outside it at finite
 * points as well, so only the `+∞` limits of `a` and `b` get a value here:
 *
 * - `I_x(a, +∞) = 1` for `0 < x ≤ 1` (`I_{0.001}(2, 10⁶) = 1`) and `0` at
 *   `x = 0`: the mass of the Beta(a, b) law concentrates at 0.
 * - `I_x(+∞, b) = 0` for `0 ≤ x < 1` (`I_{0.9}(10⁶, 3) = 10⁻⁴⁵⁷⁴⁸`) and `1`
 *   at `x = 1`: it concentrates at 1.
 * - Both `+∞`: `NaN` for a real literal `x` in the OPEN interval `(0, 1)`.
 *   The limit follows the ratio `a/(b+a)` rather than either operand —
 *   `I_{0.3}(R, R) → 0` while `I_{0.5}(R, R) = 0.5` for every R — so there is
 *   no single value. The two ENDPOINTS survive: `I_0(a, b) = 0` and
 *   `I_1(a, b) = 1` hold for every positive `a` and `b`, so they hold in the
 *   limit as well. Anywhere else — a symbolic `x`, a complex `x`, a real `x`
 *   outside `[0, 1]` — nothing is established and the answer stays symbolic.
 * - Every other infinite point (an infinite `x`; `−∞`, `~oo` or an anonymous
 *   infinity in `a` or `b`; an unproven finite partner) is outside that
 *   region and stays SYMBOLIC, as the corresponding finite points do. A
 *   capability gap must not be reported as an indeterminate value: for
 *   integer `a` and `b`, `I_x(a, b)` is a polynomial in `x` with a perfectly
 *   good real limit at `±∞` (`I_x(2, 3) = 3x⁴ − 8x³ + 6x² → +∞`), which
 *   `NaN` would misreport.
 */
function betaRegularizedValueAtInfinity(
  x: Expression,
  a: Expression,
  b: Expression,
  ce: ComputeEngine
): Expression | undefined {
  const px = infinitePoint(x);
  const pa = infinitePoint(a);
  const pb = infinitePoint(b);
  if (px === undefined && pa === undefined && pb === undefined)
    return undefined;
  if (px !== undefined) return undefined;
  if (pa !== undefined && pb !== undefined) {
    if (pa !== '+oo' || pb !== '+oo') return undefined;
    // The endpoints of the unit interval keep their values where the
    // interior has none: `I_0(a, b) = 0` and `I_1(a, b) = 1` for every
    // positive `a` and `b`, so also in the limit.
    if (!isRealLiteral(x)) return undefined;
    if (x.isSame(0)) return ce.Zero;
    if (x.isSame(1)) return ce.One;
    // `NaN` is claimed ONLY in the open interval, the region where the
    // indeterminacy is established. A point outside `[0, 1]`, a complex `x`
    // and a symbolic `x` are all places the head has nothing to say at a
    // FINITE `a` and `b` either, so they stay symbolic: a capability gap
    // must not be reported as an indeterminate value.
    if (x.isPositive === true && x.isLess(1) === true) return ce.NaN;
    return undefined;
  }
  if (pa !== '+oo' && pb !== '+oo') return undefined;
  if (
    !isRealLiteral(x) ||
    x.isNonNegative !== true ||
    x.isLessEqual(1) !== true
  )
    return undefined;
  if (!isProvablyPositiveFinite(pa === '+oo' ? b : a)) return undefined;
  if (pa === '+oo') return x.isSame(1) ? ce.One : ce.Zero;
  return x.isSame(0) ? ce.Zero : ce.One;
}

export const DISTRIBUTIONS_LIBRARY: SymbolDefinitions[] = [
  {
    //
    // Regularized incomplete gamma / beta, following the `Erf` template:
    // exact special values fold in `evaluate()`; an inexact (float) argument
    // numericizes even under plain `evaluate()` (policy D2); `.N()` always
    // numericizes, dispatching machine vs. bignum via `shouldNumericize`.
    // Complex arguments stay symbolic (no complex kernel).
    //
    GammaRegularized: {
      description:
        'Regularized upper incomplete gamma function Q(a, z) = Γ(a, z)/Γ(a)',
      complexity: 7500,
      // Both slots take the Γ-family carrier: every finite complex point has
      // a value or a documented capability gap, and every infinity is in the
      // carrier with the values `gammaRegularizedValueAtInfinity` gives, so a
      // point with no limit answers `NaN` rather than a boxing error. `NaN`
      // propagates — stated explicitly because the carrier is not a subtype
      // of `complex`, so the policy derived from the signature alone would be
      // `reject`.
      signature: '(complex | infinity, complex | infinity) -> number',
      nanBehavior: 'propagate',
      // A finite real ONLY on the proven domain a > 0, z ≥ 0 (there
      // Q(a, z) ∈ [0, 1]); outside it the value can be negative
      // (`Q(-0.5, 2) = -0.0085`) or complex (`Q(0.5, -1) = 1 - 1.65i`), so
      // the unconditional `real` this definition used to claim was unsound.
      // Both gates NARROW on `true`, so the descriptor sign channel errs on
      // the wide side: an unproven sign claims `number`.
      type: ([a, z]) => {
        // A provably-NaN operand DECLINES: a handler answer is never widened,
        // so answering `number` here would suppress any sharper claim the
        // framework can derive.
        if (
          (a && typeFact(a.type, 'nan') === true) ||
          (z && typeFact(z.type, 'nan') === true)
        )
          return undefined;
        if (
          a !== undefined &&
          z !== undefined &&
          a.facts.finite === true &&
          z.facts.finite === true &&
          typeFact(a.type, 'real') === true &&
          typeFact(z.type, 'real') === true &&
          positiveSign(a.facts.sgn) === true &&
          nonNegativeSign(z.facts.sgn) === true
        )
          return 'real';
        return 'number';
      },
      evaluate: ([a, z], { numericApproximation, engine: ce }) => {
        if (!a || !z) return undefined;
        // The infinite points are exact, so they are answered on both routes
        // and BEFORE any kernel sees an `Infinity` argument.
        const infinite = gammaRegularizedValueAtInfinity(a, z, ce);
        if (infinite !== undefined) return infinite;

        // Q(1, z) = e^{−z} for any z, a symbolic one included.
        if (isNumber(a) && a.isSame(1)) {
          const r = ce.function('Exp', [ce.function('Negate', [z])]);
          return numericApproximation ? r.N() : r.evaluate();
        }

        // Q(a, 0) = Γ(a)/Γ(a) = 1 — but only where BOTH are finite, that is
        // a > 0. At a non-positive integer a both are poles, an ∞/∞ with no
        // value: `NaN`. At a negative non-integer a the value diverges
        // (Q(−0.5, 10⁻⁶) = −563, growing like sign(Γ(a))·z^a), and the whole
        // a < 0 region is a capability gap here, so it stays symbolic rather
        // than answer at this one point only.
        if (isNumber(z) && z.isSame(0)) {
          if (isProvablyPositiveFinite(a)) return ce.One;
          if (isNonPositiveIntegerLiteral(a)) return ce.NaN;
          return undefined;
        }

        // 1/Γ(a) = 0 at every non-positive integer a, so Q(a, z) vanishes
        // there for every z ≠ 0 (checked: Q(−1, 2) = Q(0, 2) = Q(−2, 5) = 0).
        if (isNonPositiveIntegerLiteral(a)) return ce.Zero;

        // Q(n, z) for a positive integer n and a real z: the exact finite
        // closed form, which also covers the z < 0 half the kernel cannot.
        if (
          isRealLiteral(a) &&
          a.isInteger === true &&
          a.isPositive === true &&
          a.isLessEqual(MAX_GAMMA_Q_SERIES_ORDER) === true &&
          isRealLiteral(z)
        )
          return gammaRegularizedSeries(
            Number(a.re),
            z,
            ce,
            numericApproximation
          );

        if (!isNumber(a) || !isNumber(z)) return undefined;
        if (a.im !== 0 || z.im !== 0) return undefined; // complex → symbolic
        // The kernels are the series/continued-fraction pair for a > 0,
        // z > 0. Outside that region the value exists but this head does not
        // compute it (`Q(−0.5, 2) = −0.0085`, `Q(0.5, −1) = 1 − 1.65i`) — a
        // capability gap stays SYMBOLIC; answering the kernel's `NaN` would
        // report a defined value as indeterminate.
        if (a.isPositive !== true || z.isPositive !== true) return undefined;
        if (!shouldNumericize(numericApproximation, a, z)) return undefined;
        return apply2(
          a,
          z,
          (a, z) => gammaQ(a, z),
          (a, z) => bigGammaQ(ce, a, z)
        );
      },
    },

    BetaRegularized: {
      description: 'Regularized incomplete beta function I_x(a, b)',
      complexity: 7500,
      // The three slots take the Γ-family carrier, as `GammaRegularized`
      // does; `betaRegularizedValueAtInfinity` says which infinite points
      // have a value here. `NaN` propagates (explicit: the carrier is not a
      // subtype of `complex`).
      signature:
        '(complex | infinity, complex | infinity, complex | infinity) -> number',
      nanBehavior: 'propagate',
      // A finite real ONLY on the proven domain x ∈ [0, 1], a > 0, b > 0
      // (there I_x(a, b) ∈ [0, 1]); the unconditional `real` this
      // definition used to claim was unsound outside it. As for
      // `GammaRegularized` above, every gate narrows on `true`, so an
      // unproven fact claims the wide `number`.
      type: ([x, a, b]) => {
        // A provably-NaN operand declines, as `GammaRegularized` does.
        if (
          (x && typeFact(x.type, 'nan') === true) ||
          (a && typeFact(a.type, 'nan') === true) ||
          (b && typeFact(b.type, 'nan') === true)
        )
          return undefined;
        if (
          x !== undefined &&
          a !== undefined &&
          b !== undefined &&
          typeFact(x.type, UNIT_INTERVAL) === true &&
          a.facts.finite === true &&
          b.facts.finite === true &&
          typeFact(a.type, 'real') === true &&
          typeFact(b.type, 'real') === true &&
          positiveSign(a.facts.sgn) === true &&
          positiveSign(b.facts.sgn) === true
        )
          return 'real';
        return 'number';
      },
      evaluate: ([x, a, b], { numericApproximation, engine: ce }) => {
        if (!x || !a || !b) return undefined;
        // The infinite points are exact, so they are answered on both routes
        // and BEFORE any kernel sees an `Infinity` argument.
        const infinite = betaRegularizedValueAtInfinity(x, a, b, ce);
        if (infinite !== undefined) return infinite;
        // I_0(a, b) = 0 and I_1(a, b) = 1 hold only where B(a, b) is finite
        // and the incomplete integral converges at the endpoint, that is
        // a > 0 and b > 0. Below zero the integral diverges at the endpoint
        // and the endpoint values are not 0 and 1 (I_1(−1, 3) is NaN,
        // I_1(2, −1) is NaN), so an unproven parameter stays symbolic
        // instead of folding.
        if (isProvablyPositiveFinite(a) && isProvablyPositiveFinite(b)) {
          if (isNumber(x) && x.isSame(0)) return ce.Zero;
          if (isNumber(x) && x.isSame(1)) return ce.One;
        }
        if (!isNumber(x) || !isNumber(a) || !isNumber(b)) return undefined;
        if (x.im !== 0 || a.im !== 0 || b.im !== 0) return undefined;
        if (!shouldNumericize(numericApproximation, x, a, b)) return undefined;
        return applyN(
          [x, a, b],
          (x, a, b) => betaRegularized(x, a, b),
          (x, a, b) => bigBetaRegularized(ce, x, a, b)
        );
      },
    },
  },

  {
    //
    // Distribution constructors: canonical but inert (no `evaluate`). They
    // validate arity, *literal* off-carrier parameters and *literal*
    // out-of-range parameters; symbolic parameters pass through untouched.
    //
    // Each parameter carries its mathematical domain (the finite reals, or a
    // range below them), so `NaN`, an infinity and a complex value are
    // contract violations rather than values to carry: `nanBehavior` is
    // `reject` in every slot — spelled out, though it is also the policy
    // derived from a carrier below `complex` with a non-numeric result. See
    // `carrierError` above for why the handler, not the boxing seam,
    // enforces this. The remaining conditions are inequalities the carrier
    // cannot express (σ > 0, λ > 0, n ≥ 0, a < b) and stay `out-of-range`
    // checks. Recorded in
    // `docs/plans/2026-08-30-error-model-implementation.md`, Phase F, the
    // distributions record.
    //
    NormalDistribution: {
      description:
        'Normal (Gaussian) distribution with mean μ and standard deviation σ.',
      signature: '(real, real) -> expression<NormalDistribution>',
      nanBehavior: 'reject',
      canonical: (ops, { engine: ce }) => {
        if (ops.length !== 2) return null;
        let mu = ops[0].canonical;
        let sigma = ops[1].canonical;
        if (offRealCarrier(mu))
          mu = carrierError(ce, 'NormalDistribution', 'real', mu);
        if (offRealCarrier(sigma))
          sigma = carrierError(ce, 'NormalDistribution', 'real', sigma);
        else {
          // `real<0..>` would admit σ = 0, a degenerate distribution with no
          // density, so the positivity check stays a range check. It is asked
          // of the literal's SIGN, not of its double, so a bignum beyond the
          // double range is still checked.
          if (isFiniteRealLiteral(sigma) && sigma.isPositive !== true)
            sigma = rangeError(ce, 'σ > 0', sigma);
        }
        return ce._fn('NormalDistribution', [mu, sigma]);
      },
    },

    BinomialDistribution: {
      description:
        'Binomial distribution: number of successes in n independent trials, ' +
        'each with success probability p.',
      signature: '(integer, real<0..1>) -> expression<BinomialDistribution>',
      nanBehavior: 'reject',
      canonical: (ops, { engine: ce }) => {
        if (ops.length !== 2) return null;
        let n = ops[0].canonical;
        let p = ops[1].canonical;
        // A non-integer literal (`NaN`, `+oo` and `i` included) is off the
        // `integer` carrier; only the non-negativity is a range check. It is
        // asked of the literal's SIGN, never of its double, so a bignum
        // beyond the double range is still checked.
        if (isNumber(n) && n.isInteger !== true)
          n = carrierError(ce, 'BinomialDistribution', 'integer', n);
        else if (isNumber(n) && n.isNegative === true)
          n = rangeError(ce, 'n ∈ ℤ≥0', n);
        // The whole probability condition IS the carrier `real<0..1>`, so a
        // literal outside [0, 1] is a type violation, not a range one — the
        // `Rationalize` tolerance precedent (`library/arithmetic.ts`). The
        // upper bound goes through `litOrder`, which compares the exact
        // values: `isGreater` reads the double projections, where an exact
        // rational within an ulp of `1` compares equal to it.
        if (
          offRealCarrier(p) ||
          (isFiniteRealLiteral(p) &&
            (p.isNegative === true || litOrder(ce, p, ce.One) === 1))
        )
          p = carrierError(ce, 'BinomialDistribution', 'real<0..1>', p);
        return ce._fn('BinomialDistribution', [n, p]);
      },
    },

    PoissonDistribution: {
      description: 'Poisson distribution with rate parameter λ.',
      signature: '(real) -> expression<PoissonDistribution>',
      nanBehavior: 'reject',
      canonical: (ops, { engine: ce }) => {
        if (ops.length !== 1) return null;
        let lambda = ops[0].canonical;
        if (offRealCarrier(lambda))
          lambda = carrierError(ce, 'PoissonDistribution', 'real', lambda);
        else if (isFiniteRealLiteral(lambda) && lambda.isPositive !== true)
          lambda = rangeError(ce, 'λ > 0', lambda);
        return ce._fn('PoissonDistribution', [lambda]);
      },
    },

    UniformDistribution: {
      description: 'Continuous uniform distribution on the interval [a, b].',
      signature: '(real, real) -> expression<UniformDistribution>',
      nanBehavior: 'reject',
      canonical: (ops, { engine: ce }) => {
        if (ops.length !== 2) return null;
        let a = ops[0].canonical;
        let b = ops[1].canonical;
        if (offRealCarrier(a))
          a = carrierError(ce, 'UniformDistribution', 'real', a);
        if (offRealCarrier(b))
          b = carrierError(ce, 'UniformDistribution', 'real', b);
        else {
          // The order comes from `litOrder`, which compares the exact values.
          // `isLess` reads the double projections, and two bignums beyond the
          // double range both project to `Infinity`, so `10^400 < 10^500` was
          // not decided there and the valid pair was refused as `a >= b`. An
          // UNDECIDED order (a symbolic bound) is admitted, as before.
          const ord = litOrder(ce, a, b);
          if (ord !== undefined && ord !== -1) b = rangeError(ce, 'a < b', b);
        }
        return ce._fn('UniformDistribution', [a, b]);
      },
    },

    ExponentialDistribution: {
      description: 'Exponential distribution with rate parameter λ.',
      signature: '(real) -> expression<ExponentialDistribution>',
      nanBehavior: 'reject',
      canonical: (ops, { engine: ce }) => {
        if (ops.length !== 1) return null;
        let lambda = ops[0].canonical;
        if (offRealCarrier(lambda))
          lambda = carrierError(ce, 'ExponentialDistribution', 'real', lambda);
        else if (isFiniteRealLiteral(lambda) && lambda.isPositive !== true)
          lambda = rangeError(ce, 'λ > 0', lambda);
        return ce._fn('ExponentialDistribution', [lambda]);
      },
    },
  },

  {
    //
    // `PDF`/`CDF`/`Quantile`: lower to the closed form for the distribution.
    // `evaluate` returns the exact/symbolic form; `.N()` numericizes it.
    //
    // None of the three has a `canonical` handler, so the boxing-time
    // signature validation IS their enforcement seam: an evaluation point
    // outside `real | signed_infinity` (`i`, `~oo`) and a probability
    // outside `[0, 1]` become `incompatible-type` errors there. The point
    // carrier admits the signed infinities because every one of these
    // distributions has a limit at ±∞ (density 0; CDF 0 and 1), and the
    // probability slot is the range type `real<0..1>` — the `Rationalize`
    // tolerance precedent (`library/arithmetic.ts`). A `NaN` point or
    // probability propagates to a `NaN` result, which the derived policy for
    // a distribution-shaped first slot would not give, hence the explicit
    // per-slot pairs. Recorded in
    // `docs/plans/2026-08-30-error-model-implementation.md`, Phase F, the
    // distributions record.
    //
    PDF: {
      description:
        'Probability density (continuous) or mass (discrete) function of a ' +
        'distribution, evaluated at x.',
      complexity: 7500,
      signature: '(distribution, real | signed_infinity) -> real<0..> | nan',
      nanBehavior: ['reject', 'propagate'],
      evaluate: ([dist, x], { numericApproximation, engine: ce }) => {
        if (!dist || !x || !isDistributionExpression(dist)) return undefined;
        const r = distributionPDF(ce, dist, x, !!numericApproximation);
        if (!r) return undefined;
        return numericApproximation ? r.N() : r.evaluate();
      },
    },

    CDF: {
      description:
        'Cumulative distribution function P(X ≤ x) of a distribution.',
      complexity: 7500,
      signature: '(distribution, real | signed_infinity) -> real<0..1> | nan',
      nanBehavior: ['reject', 'propagate'],
      evaluate: ([dist, x], { numericApproximation, engine: ce }) => {
        if (!dist || !x || !isDistributionExpression(dist)) return undefined;
        const r = distributionCDF(ce, dist, x);
        if (!r) return undefined;
        return numericApproximation ? r.N() : r.evaluate();
      },
    },

    Quantile: {
      description:
        'Quantile (inverse CDF): the least x with CDF(x) ≥ p, for p in [0, 1]. ' +
        'The first argument may also be a data collection, in which case the ' +
        'empirical quantile is returned.',
      complexity: 7500,
      signature:
        '(distribution | collection<any>, real<0..1>) -> real | signed_infinity | nan',
      nanBehavior: ['reject', 'propagate'],
      evaluate: ([dist, p], { numericApproximation, engine: ce }) => {
        if (!dist || !p) return undefined;
        // No range check on `p` here: the whole condition `0 ≤ p ≤ 1` IS the
        // declared carrier `real<0..1>`, and this head has no `canonical`
        // handler, so both seams that could deliver an out-of-range value
        // refuse it before the handler runs — boxing for a literal, the
        // dispatch-time conformance re-test for the value a symbol holds.
        // Both answer `incompatible-type`, where this handler used to answer
        // `out-of-range` at evaluation.
        const pv = litVal(p);
        // Empirical quantile of a data collection (distinguished from a
        // distribution by the first argument's shape).
        if (!isDistributionExpression(dist)) {
          if (!dist.isFiniteCollection) return undefined;
          const r = empiricalQuantile(ce, dist, p, pv);
          if (!r) return undefined;
          return numericApproximation ? r.N() : r.evaluate();
        }
        const r = distributionQuantile(ce, dist, p, pv, !!numericApproximation);
        if (!r) return undefined;
        return numericApproximation ? r.N() : r.evaluate();
      },
    },
  },
];

//
// Closed-form lowering. All construction uses `ce.function('Add'|…)` (never the
// `.add()`/`.mul()` methods, which fold exact literal pairs to floats), and no
// handler calls `.simplify()`. The returned expression is evaluated by the
// caller (exact under `evaluate`, float under `.N()`).
//

function distributionPDF(
  ce: ComputeEngine,
  dist: Expression,
  x: Expression,
  numericApproximation: boolean
): Expression | undefined {
  const mul = (a: Expression[]) => ce.function('Multiply', a);
  const sub = (a: Expression, b: Expression) => ce.function('Subtract', [a, b]);
  const div = (a: Expression, b: Expression) => ce.function('Divide', [a, b]);
  const pow = (a: Expression, b: Expression) => ce.function('Power', [a, b]);
  const neg = (a: Expression) => ce.function('Negate', [a]);
  const fn = (h: string, a: Expression[]) => ce.function(h, a);

  // Each of the five densities vanishes at ±∞ (a probability density is
  // integrable, so it has no mass at an infinite point). Decided here, before
  // the closed forms, which would otherwise evaluate `e^{+∞}` or a Poisson
  // pmf at an infinite index and answer `+∞` or `NaN`.
  if (signedInfinitySign(x) !== undefined) return ce.Zero;

  switch (dist.operator) {
    case 'NormalDistribution': {
      const [mu, sigma] = distOps(dist);
      const z = sub(x, mu);
      const num = fn('Exp', [
        neg(
          div(
            pow(z, ce.number(2)),
            mul([ce.number(2), pow(sigma, ce.number(2))])
          )
        ),
      ]);
      const den = mul([sigma, fn('Sqrt', [mul([ce.number(2), ce.Pi])])]);
      return div(num, den);
    }

    case 'BinomialDistribution': {
      const [n, p] = distOps(dist);
      // Discrete: the mass is 0 at a numeric non-integer point, and 0 off the
      // support `{0, …, n}`. The support test is explicit because the closed
      // form answers `NaN` above `n`: `Binomial(n, k)` is 0 there, but
      // `(1 − p)^(n − k)` is `+∞`, and `0 · ∞` is `NaN`.
      if (isFiniteRealLiteral(x)) {
        if (x.isInteger !== true || x.isNegative === true) return ce.Zero;
        if (litOrder(ce, x, n) === 1) return ce.Zero;
      }
      const k = x;
      return mul([
        fn('Binomial', [n, k]),
        pow(p, k),
        pow(sub(ce.One, p), sub(n, k)),
      ]);
    }

    case 'PoissonDistribution': {
      const [lambda] = distOps(dist);
      // The support is the NON-NEGATIVE integers; the mass is 0 at every
      // other numeric point. Without the sign test the closed form below
      // divides by `(−1)!`, which the engine reports as `~oo`.
      if (
        isFiniteRealLiteral(x) &&
        (x.isInteger !== true || x.isNegative === true)
      )
        return ce.Zero;
      // An index beyond the double range keeps the closed form off the
      // factorial: `Factorial(10^400)` has more digits than the exact cap
      // (`MAX_EXACT_FACTORIAL_DIGITS`, `library/arithmetic.ts`) and stays
      // symbolic, and the closed form's numeric reading is then the
      // indeterminate `∞ · 0 / ∞`. Under `.N()` the answer is the underflow
      // to `0`, which is the numeric route's honest reading — the mass is
      // below the smallest positive double for every rate this head can
      // hold. The EXACT route stays symbolic instead: `0` is not the value.
      // At `k = λ = 10^400` the mass is about `1/√(2πk)`, and an exact
      // result must not report a number the head did not compute.
      if (isFiniteRealLiteral(x) && litVal(x) === undefined)
        return numericApproximation ? ce.Zero : undefined;
      const k = x;
      return div(
        mul([pow(lambda, k), fn('Exp', [neg(lambda)])]),
        fn('Factorial', [k])
      );
    }

    case 'UniformDistribution': {
      const [a, b] = distOps(dist);
      const density = div(ce.One, sub(b, a));
      // Numeric point outside the support has zero density.
      const lo = litOrder(ce, x, a);
      const hi = litOrder(ce, x, b);
      if (lo !== undefined && hi !== undefined)
        return lo < 0 || hi > 0 ? ce.Zero : density;
      // A point (or a support bound) that is not a literal: the density is
      // `1/(b − a)` on `[a, b]` and 0 outside, so the closed form is that
      // piecewise. Returning the density alone claimed `1/(b − a)` at EVERY
      // point, `PDF(UniformDistribution(0, 1), x)` included.
      return fn('Which', [
        fn('And', [fn('LessEqual', [a, x]), fn('LessEqual', [x, b])]),
        density,
        ce.True,
        ce.Zero,
      ]);
    }

    case 'ExponentialDistribution': {
      const [lambda] = distOps(dist);
      const density = mul([lambda, fn('Exp', [neg(mul([lambda, x]))])]);
      if (isFiniteRealLiteral(x))
        return x.isNegative === true ? ce.Zero : density;
      // As for the uniform above: the density is 0 on the negative half-line,
      // where `λe^{−λx}` grows without bound.
      return fn('Which', [fn('Less', [x, ce.Zero]), ce.Zero, ce.True, density]);
    }
  }
  return undefined;
}

function distributionCDF(
  ce: ComputeEngine,
  dist: Expression,
  x: Expression
): Expression | undefined {
  const add = (a: Expression[]) => ce.function('Add', a);
  const mul = (a: Expression[]) => ce.function('Multiply', a);
  const sub = (a: Expression, b: Expression) => ce.function('Subtract', [a, b]);
  const div = (a: Expression, b: Expression) => ce.function('Divide', [a, b]);
  const fn = (h: string, a: Expression[]) => ce.function(h, a);

  // `P(X ≤ +∞) = 1` and `P(X ≤ −∞) = 0` for every distribution here. Decided
  // before the closed forms, and in particular before the discrete CDFs
  // delegate to `GammaRegularized`/`BetaRegularized`, which have no value at
  // an infinite parameter and left the application inert
  // (`BetaRegularized(0.5, −∞, +∞)`).
  const inf = signedInfinitySign(x);
  if (inf === 1) return ce.One;
  if (inf === -1) return ce.Zero;

  switch (dist.operator) {
    case 'NormalDistribution': {
      const [mu, sigma] = distOps(dist);
      const arg = div(sub(x, mu), mul([sigma, fn('Sqrt', [ce.number(2)])]));
      return mul([ce.Half, add([ce.One, fn('Erf', [arg])])]);
    }

    case 'BinomialDistribution': {
      const [n, p] = distOps(dist);
      // Numeric outside support: below 0 → 0, at/above n → 1.
      if (isFiniteRealLiteral(x) && x.isNegative === true) return ce.Zero;
      const rel = litOrder(ce, x, n);
      if (rel === 0 || rel === 1) return ce.One;
      // Use ⌊k⌋ only for a numeric non-integer point; symbolic/integer k pass
      // through directly.
      const k =
        isFiniteRealLiteral(x) && x.isInteger !== true
          ? fn('Floor', [x]).evaluate()
          : x;
      // CDF(k) = I_{1−p}(n−k, k+1)
      return fn('BetaRegularized', [
        sub(ce.One, p),
        sub(n, k),
        add([k, ce.One]),
      ]);
    }

    case 'PoissonDistribution': {
      const [lambda] = distOps(dist);
      if (isFiniteRealLiteral(x) && x.isNegative === true) return ce.Zero;
      const k =
        isFiniteRealLiteral(x) && x.isInteger !== true
          ? fn('Floor', [x]).evaluate()
          : x;
      // CDF(k) = Q(⌊k⌋+1, λ)
      return fn('GammaRegularized', [add([k, ce.One]), lambda]);
    }

    case 'UniformDistribution': {
      const [a, b] = distOps(dist);
      const ramp = div(sub(x, a), sub(b, a));
      const lo = litOrder(ce, x, a);
      const hi = litOrder(ce, x, b);
      if (lo !== undefined && lo <= 0) return ce.Zero;
      if (hi !== undefined && hi >= 0) return ce.One;
      if (lo !== undefined && hi !== undefined) return ramp;
      // A point (or a support bound) that is not a literal: the CDF is the
      // ramp CLAMPED to [0, 1]. The bare ramp was unbounded outside the
      // support, so `CDF(UniformDistribution(0, 1), x)` answered `x`.
      return fn('Which', [
        fn('LessEqual', [x, a]),
        ce.Zero,
        fn('GreaterEqual', [x, b]),
        ce.One,
        ce.True,
        ramp,
      ]);
    }

    case 'ExponentialDistribution': {
      const [lambda] = distOps(dist);
      const tail = sub(
        ce.One,
        fn('Exp', [ce.function('Negate', [mul([lambda, x])])])
      );
      if (isFiniteRealLiteral(x)) return x.isNegative === true ? ce.Zero : tail;
      // As for the uniform above: the CDF is 0 on the negative half-line,
      // where `1 − e^{−λx}` is negative.
      return fn('Which', [fn('Less', [x, ce.Zero]), ce.Zero, ce.True, tail]);
    }
  }
  return undefined;
}

function distributionQuantile(
  ce: ComputeEngine,
  dist: Expression,
  p: Expression,
  pv: number | undefined,
  numericApproximation: boolean
): Expression | undefined {
  const add = (a: Expression[]) => ce.function('Add', a);
  const mul = (a: Expression[]) => ce.function('Multiply', a);
  const sub = (a: Expression, b: Expression) => ce.function('Subtract', [a, b]);
  const div = (a: Expression, b: Expression) => ce.function('Divide', [a, b]);
  const neg = (a: Expression) => ce.function('Negate', [a]);
  const fn = (h: string, a: Expression[]) => ce.function(h, a);

  switch (dist.operator) {
    case 'NormalDistribution': {
      const [mu, sigma] = distOps(dist);
      if (pv === 0) return ce.NegativeInfinity;
      if (pv === 1) return ce.PositiveInfinity;
      // μ + σ·√2·ErfInv(2p − 1)
      const inner = fn('ErfInv', [sub(mul([ce.number(2), p]), ce.One)]);
      return add([mu, mul([sigma, fn('Sqrt', [ce.number(2)]), inner])]);
    }

    case 'UniformDistribution': {
      const [a, b] = distOps(dist);
      if (pv === 0) return a;
      if (pv === 1) return b;
      // a + p·(b − a)
      return add([a, mul([p, sub(b, a)])]);
    }

    case 'ExponentialDistribution': {
      const [lambda] = distOps(dist);
      if (pv === 0) return ce.Zero;
      if (pv === 1) return ce.PositiveInfinity;
      // −ln(1 − p)/λ
      return div(neg(fn('Ln', [sub(ce.One, p)])), lambda);
    }

    case 'BinomialDistribution': {
      const [n, p0] = distOps(dist);
      if (pv === 0) return ce.Zero;
      // The support tops out at `n`, whatever its magnitude; only a
      // non-literal `n` leaves the top of the support unknown.
      if (pv === 1) return isFiniteRealLiteral(n) ? n : ce.PositiveInfinity;
      // A discrete quantile has no closed form. Its value IS an exact
      // integer, but the only search available here is the FLOAT one in
      // `numerics/distributions.ts`, and that search compares the machine CDF
      // against `p` with a tolerance (`prob - 1e-12`) so that the
      // `Quantile(CDF(k)) = k` round trip survives round-off. A tolerance
      // cannot deliver the exact answer: an exact `p` a hair above a CDF jump
      // (`Quantile(Binomial(1, 1/2), 1/2 + 10^-13)`) selects the previous
      // support point. So the search stays on the `.N()` route, whose answer
      // is a float and is allowed to be approximate; under `evaluate()` the
      // application stays symbolic rather than claim an exact integer the
      // search cannot certify.
      if (!numericApproximation) return undefined;
      const nn = litVal(n);
      const ppv = litVal(p0);
      if (nn === undefined || ppv === undefined || pv === undefined)
        return undefined;
      return ce.number(binomialQuantile(nn, ppv, pv, ce._deadline));
    }

    case 'PoissonDistribution': {
      const [lambda] = distOps(dist);
      if (pv === 0) return ce.Zero;
      if (pv === 1) return ce.PositiveInfinity;
      // See the binomial above: the tolerance-based float search is a `.N()`
      // route only.
      if (!numericApproximation) return undefined;
      const lv = litVal(lambda);
      if (lv === undefined || pv === undefined) return undefined;
      return ce.number(poissonQuantile(lv, pv, ce._deadline));
    }
  }
  return undefined;
}

//
// Empirical quantile of a data collection, self-consistent with the
// `Quartiles` operator (Moore–McCabe convention) but interpolating in RANK
// space so all order statistics are used:
//
// 1. The Moore–McCabe anchors have (possibly half-integer) 1-based ranks in
//    the sorted data: min → 1; Q1 → (⌊n/2⌋+1)/2 (the median rank of the
//    lower half); median → (n+1)/2; Q3 → the mirrored upper-half rank;
//    max → n.
// 2. p maps piecewise-linearly through the anchor ranks: p ∈ [0, ¼] spans
//    [rank(min), rank(Q1)], p ∈ [¼, ½] spans [rank(Q1), rank(median)], etc.
// 3. The fractional rank r interpolates linearly between adjacent order
//    statistics: x_⌊r⌋ + (r − ⌊r⌋)·(x_⌊r⌋₊₁ − x_⌊r⌋).
//
// At p = ¼/½/¾ the mapped rank IS the anchor rank, so the result agrees
// exactly with `Quartiles`/`Median`; p = 0/1 give min/max; the map is
// monotone and continuous in p. Unlike interpolating the five anchor VALUES
// directly, large-n percentiles land on the right order statistics (n = 100,
// p = 0.9 lands near rank 90, not on a Q3–max chord that a big outlier would
// distort). No single plotting-position formula matches Moore–McCabe
// quartiles for both parities of n, which is why the map goes through the
// anchor ranks.
//
// The interpolation weight is built symbolically from `p` with integer
// coefficients (anchor ranks are integers or half-integers), so exact data +
// exact p yield an exact result; the caller evaluates/numericizes the
// returned tree. A symbolic `p` (no literal value) stays symbolic.
//
function empiricalQuantile(
  ce: ComputeEngine,
  coll: Expression,
  p: Expression,
  pv: number | undefined
): Expression | undefined {
  if (pv === undefined) return undefined; // symbolic p: no closed form
  const data = [...coll.each()];
  const n = data.length;
  // An empty sample has no order statistics — the §3.C answer for input a
  // statistic cannot read (`docs/ERROR-MODEL.md`), and what the other
  // order-based heads answer for the same sample.
  if (n === 0) return ce.NaN;

  // Every element must be a NUMBER. The sort below orders by `.re`, which is
  // `NaN` for a non-numeric element, so the comparator returns `NaN`, the sort
  // is a silent no-op, and the `pv <= 0` / `>= 1` / `n === 1` exits return
  // `sorted[0]` — handing back the element itself. For a string source (an
  // indexed collection of characters) that meant returning a CHARACTER from a
  // handler whose signature says `-> real | signed_infinity | nan`.
  //
  // The three verdicts and their ranking (ERROR > ABSENT > INERT) are the
  // ones `collectData` (`library/statistics.ts`) applies for the whole
  // statistics family, so the same sample gets the same answer from
  // `Quantile` as from `Median`:
  //
  // - A datum whose own TYPE is disjoint from `number` — a string, a
  //   character, a boolean, a nested collection — can never be a number, so
  //   it is refused. The constraint names `number`, not `real`: the value is
  //   not a number AT ALL. The `real` rejection below is for a NUMERIC datum
  //   with no finite real reading.
  // - An ABSENT datum (`Missing`, `NaN`) makes the whole aggregate `NaN`
  //   (§3.C of `docs/ERROR-MODEL.md`). It also has to be caught before the
  //   sort, which a `NaN` comparator silently leaves unordered. The signed
  //   infinities are NOT absorbed — they are ordinary points of the extended
  //   real line and sort correctly.
  // - Anything else with no literal reading yet — a valueless symbol, a
  //   numeric expression such as `Sqrt(-2)` that stays symbolic — overlaps
  //   `number`, so the application stays INERT and a later assignment or a
  //   `.N()` can still answer it.
  let absent = false;
  let inert = false;
  for (const v of data) {
    if (isAbsentValue(v)) absent = true;
    else if (!isNumber(v)) {
      // An `error` datum is exempt from the refusal: it already speaks the
      // Error channel and the engine propagates it on its own.
      if (!v.type.matches('error') && v.type.isDisjointFrom('number'))
        return dataConstraintError(ce, 'Quantile', v, 'number');
      inert = true;
    }
  }
  if (absent) return ce.NaN;
  if (inert) return undefined;

  // A quantile is an order statistic and the complex numbers have no
  // canonical order — the sort below reads `.re`, which for complex data
  // would silently answer the quantile of the real parts. Reject it with
  // the same error shape the statistics operators use.
  const nonReal = nonRealDatum(data);
  if (nonReal) return nonRealDataError(ce, 'Quantile', nonReal);

  // The complex infinity `~oo` is not complex DATA — it is the single point at
  // infinity — but it has no real value either, and the real part it reports
  // is an artifact of its spelling (`ComplexInfinity` reports `Infinity`,
  // `Complex(1, Infinity)` reports `1`). The statistics kernels project it to
  // `NaN` (`realProjection`, `library/statistics-data.ts`); a sort key cannot,
  // because a `NaN` comparator silently leaves the data unsorted and hands
  // back whatever element the ranks land on. So the whole quantile is `NaN`,
  // which is what the other order statistics answer for the same sample.
  if (data.some(hasNonFiniteImaginaryPart)) return ce.NaN;

  const sorted = [...data].sort((a, b) => a.re - b.re);
  if (pv <= 0) return sorted[0];
  if (pv >= 1) return sorted[n - 1];
  if (n === 1) return sorted[0];

  // Anchor ranks ×2 (kept as integers to avoid floats): min, Q1, median, Q3,
  // max at p = 0, ¼, ½, ¾, 1. rank(Q1)·2 = mid + 1; rank(median)·2 = n + 1;
  // rank(Q3)·2 = 2·upperStart + mid + 1 (mirror of Q1 in the upper half).
  const mid = Math.floor(n / 2);
  const upperStart = mid + (n % 2);
  const ranks2 = [2, mid + 1, n + 1, 2 * upperStart + mid + 1, 2 * n];
  const fracs = [0, 0.25, 0.5, 0.75, 1];

  // Locate the p-segment [i, i+1] and the fractional rank within it.
  let i = 0;
  while (i < 3 && pv > fracs[i + 1]) i++;
  const ra2 = ranks2[i];
  const rb2 = ranks2[i + 1];
  const rNum = (ra2 + ((pv - fracs[i]) / 0.25) * (rb2 - ra2)) / 2;

  // Bracketing order statistics x_lo, x_lo+1 (1-based). A float-rounding
  // error in `lo` self-corrects: the symbolic weight t = r − lo is exact, so
  // t = 1 reproduces x_lo+1 exactly.
  const lo = Math.min(Math.max(Math.floor(rNum + 1e-12), 1), n - 1);
  const xa = sorted[lo - 1];
  const xb = sorted[lo];

  // Weight t = r − lo, built exactly from p:
  //   r = ra + (p − pa)/(¼)·(rb − ra)   with ra = ra2/2, pa = i/4
  //   t = 2·(rb2 − ra2)·(p − pa) + (ra2 − 2·lo)/2
  const sub = (a: Expression, b: Expression) => ce.function('Subtract', [a, b]);
  const pa = ce.function('Divide', [ce.number(i), ce.number(4)]);
  const t = ce.function('Add', [
    ce.function('Multiply', [ce.number(2 * (rb2 - ra2)), sub(p, pa)]),
    ce.function('Divide', [ce.number(ra2 - 2 * lo), ce.number(2)]),
  ]);
  return ce.function('Add', [xa, ce.function('Multiply', [t, sub(xb, xa)])]);
}

//
// Distribution moments — consumed by the `Mean`/`Variance`/`StandardDeviation`
// overloads in `library/statistics.ts`. Exact/symbolic construction as above.
//

export function distributionMean(
  ce: ComputeEngine,
  dist: Expression
): Expression | undefined {
  const mul = (a: Expression[]) => ce.function('Multiply', a);
  const div = (a: Expression, b: Expression) => ce.function('Divide', [a, b]);
  const add = (a: Expression[]) => ce.function('Add', a);
  switch (dist.operator) {
    case 'NormalDistribution':
      return distOps(dist)[0].evaluate();
    case 'BinomialDistribution':
      return mul([distOps(dist)[0], distOps(dist)[1]]).evaluate();
    case 'PoissonDistribution':
      return distOps(dist)[0].evaluate();
    case 'UniformDistribution':
      return div(
        add([distOps(dist)[0], distOps(dist)[1]]),
        ce.number(2)
      ).evaluate();
    case 'ExponentialDistribution':
      return div(ce.One, distOps(dist)[0]).evaluate();
  }
  return undefined;
}

export function distributionVariance(
  ce: ComputeEngine,
  dist: Expression
): Expression | undefined {
  const mul = (a: Expression[]) => ce.function('Multiply', a);
  const div = (a: Expression, b: Expression) => ce.function('Divide', [a, b]);
  const sub = (a: Expression, b: Expression) => ce.function('Subtract', [a, b]);
  const pow = (a: Expression, b: Expression) => ce.function('Power', [a, b]);
  switch (dist.operator) {
    case 'NormalDistribution':
      return pow(distOps(dist)[1], ce.number(2)).evaluate();
    case 'BinomialDistribution': {
      const [n, p] = distOps(dist);
      return mul([n, p, sub(ce.One, p)]).evaluate();
    }
    case 'PoissonDistribution':
      return distOps(dist)[0].evaluate();
    case 'UniformDistribution': {
      const [a, b] = distOps(dist);
      return div(pow(sub(b, a), ce.number(2)), ce.number(12)).evaluate();
    }
    case 'ExponentialDistribution':
      return div(ce.One, pow(distOps(dist)[0], ce.number(2))).evaluate();
  }
  return undefined;
}

export function distributionStandardDeviation(
  ce: ComputeEngine,
  dist: Expression
): Expression | undefined {
  const div = (a: Expression, b: Expression) => ce.function('Divide', [a, b]);
  // Normal and Exponential have elementary standard deviations (σ and 1/λ);
  // the rest are the square root of the variance form.
  switch (dist.operator) {
    case 'NormalDistribution':
      return distOps(dist)[1].evaluate();
    case 'ExponentialDistribution':
      return div(ce.One, distOps(dist)[0]).evaluate();
    default: {
      const v = distributionVariance(ce, dist);
      if (!v) return undefined;
      return ce.function('Sqrt', [v]).evaluate();
    }
  }
}
