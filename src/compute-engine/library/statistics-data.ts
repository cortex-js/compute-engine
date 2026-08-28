import { isNumber } from '../boxed-expression/type-guards.js';
import { numberLiteralOf } from '../boxed-expression/numerics.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

/**
 * Data validation and the real projection shared by the statistics operators
 * (`library/statistics.ts`) and the empirical branch of `Quantile`
 * (`library/distributions.ts`).
 *
 * These live in their own module because `statistics.ts` imports
 * `distributions.ts` (for the distribution branches of `Mean`/`Variance`),
 * so a helper defined in `statistics.ts` cannot be imported back from
 * `distributions.ts` without a dependency cycle — and the two files must
 * reject non-real data with the SAME error shape.
 */

/**
 * The one error shape every statistic uses to reject a data point that is not
 * a real number: the `incompatible-type` code carrying the `real` constraint
 * and the offending datum. The bivariate heads raise it for any complex datum;
 * the univariate order-based and higher-moment heads raise it through
 * `nonRealUnivariateError` (`library/statistics.ts`).
 *
 * The numeric paths behind those heads read a datum through `realProjection`
 * below, which is its real part, so a complex datum would make the operator
 * answer the question for different data with no hint that it had done so:
 * `Covariance([1, 1+2i], [2, 3])` is the covariance of `[1, 1]` under that
 * projection, namely `0`. Erroring is the same resolution the trigonometric
 * kernels reached for the same problem (see the note in
 * `library/trigonometry.ts` on silently using the real part).
 */
export function nonRealDataError(
  ce: ComputeEngine,
  name: string,
  datum: Expression
): Expression {
  return dataConstraintError(ce, name, datum, 'real');
}

/**
 * The constraint a datum (or an explicit bin edge) failed:
 *
 * - `real` — the value has no finite real reading. It covers both failure
 *   modes, because `real` now names the FINITE reals: the value is a complex
 *   number and the statistic has no convention-free complex extension, or the
 *   value is `NaN`, a real `±∞`, or the complex infinity `~oo`.
 * - `machine_range` — the value IS a finite real, but its magnitude lies
 *   outside the double range the asking kernel computes in.
 */
export type DataConstraint = 'real' | 'machine_range';

/** The expectation a `machine_range` rejection names. */
const MACHINE_RANGE_EXPECTATION =
  'a value within the machine floating-point range';

/**
 * The error a statistic raises for a datum (or an explicit bin edge) that
 * fails one of the constraints above, naming the operator and the (truncated)
 * datum alongside it.
 *
 * A `real` rejection is an `incompatible-type` error carrying the failed
 * constraint and the datum's own type: it is a statement about what the value
 * IS. The binning heads `Histogram`/`BinCounts`
 * (`library/statistics.ts`) raise `real` where the heads that ABSORB a
 * non-finite datum (`Mean([1, NaN, 5])` is `NaN`) cannot, because a
 * histogram's result is a vector of COUNTS and no count means "the data had no
 * reading". The alternative those heads used to take — dropping the non-finite
 * values from the sample — answers a different question than the one asked,
 * silently: `BinCounts([1, +oo, 5], 2)` reported the counts of the two-point
 * dataset `[1, 5]`. A non-finite explicit bin EDGE is worse still: every
 * interval comparison against it is false, so the head fabricated a row of
 * zero counts.
 *
 * A `machine_range` rejection is deliberately NOT an `incompatible-type`
 * error, because nothing is wrong with the value's type: `10^400` is an exact
 * `integer`, so reporting `incompatible-type real /
 * integer<0..>` would contradict its own evidence. What such a value
 * exceeds is the range of the kernel doing the asking, so it takes the
 * `out-of-range` shape used elsewhere for a value outside what an operation
 * accepts (a `RandomSample` count, a distribution parameter).
 */
export function dataConstraintError(
  ce: ComputeEngine,
  name: string,
  datum: Expression,
  expected: DataConstraint
): Expression {
  if (expected === 'machine_range')
    return ce.error(
      ['out-of-range', MACHINE_RANGE_EXPECTATION, renderDatum(datum)],
      name
    );
  return ce.error(
    ['incompatible-type', expected, datum.type.toString()],
    `${name}: ${renderDatum(datum)}`
  );
}

/** How many characters of a datum the error message reproduces. */
const MAX_DATUM_MESSAGE_LENGTH = 40;

/**
 * A datum's serialization, shortened for an error message. The message names
 * the offending datum; it is not a place to reproduce it in full, and a datum
 * can be arbitrarily large (a 300-digit literal, a deeply nested expression).
 */
function renderDatum(datum: Expression): string {
  const s = datum.toString();
  if (s.length <= MAX_DATUM_MESSAGE_LENGTH) return s;
  return `${s.slice(0, MAX_DATUM_MESSAGE_LENGTH)}…`;
}

/**
 * True when `v` is a complex number: its imaginary part is non-zero and
 * finite.
 *
 * A complex literal whose imaginary part is zero canonicalizes to a real
 * number (`Complex(2, 0)` boxes as `2`), so a non-zero imaginary part here is
 * genuine. `.im` is a machine float, and an exact imaginary component below
 * the smallest double would round to `0` in it, so the exact channel
 * (`bignumIm`) has the last word when `.im` reads zero. Boxing currently
 * drops such a component before it reaches here, so this consults a channel
 * that has no known witness; it costs one comparison and removes the machine
 * projection as a source of missed complex data.
 *
 * An infinite imaginary part is the complex infinity `~oo`, which is NOT
 * reported here: it is not a sample point off the real line but the single
 * point at infinity, and it has no real part to misuse because every kernel
 * reads its data through `realProjection` below, which maps it to `NaN`. It
 * therefore propagates `NaN` the way a `NaN` datum does, instead of being
 * rejected as complex data.
 */
export function isComplexDatum(v: Expression): boolean {
  if (!isNumber(v)) return false;
  const n = v.numericValue;
  if (typeof n === 'number') return false;
  if (n.im !== 0) return Number.isFinite(n.im);
  return n.isExact && n.bignumIm?.isZero() === false;
}

/**
 * The first datum that is a complex number, or `null` when the data is
 * real-valued throughout.
 */
export function nonRealDatum(
  ...data: ReadonlyArray<ReadonlyArray<Expression>>
): Expression | null {
  for (const vals of data)
    for (const v of vals) if (isComplexDatum(v)) return v;
  return null;
}

/**
 * The first datum that has no FINITE real value — `NaN`, a real `±∞`, or the
 * complex infinity `~oo` under either spelling — or `null` when every datum is
 * a finite real.
 *
 * The question is asked of the VALUE (`isFinite`), never of the machine
 * projection `realProjection` below: an exact literal outside the double range
 * is a perfectly finite real whose projection is `Infinity`, so a projection
 * test misclassified it and made the fits answer `(NaN, NaN)` for
 * `LinearRegression([1, 10^400, 5], [2, 3, 9])` — data they fit exactly. A
 * datum that is not a number literal has no finite real value either and is
 * reported here too, though callers gate on `isNumber` first, so that case
 * does not arise in practice.
 *
 * Whether a datum is representable in MACHINE floats is a different question,
 * asked only by the kernels that compute in doubles — it is the
 * `machine_range` constraint of `dataConstraintError` above.
 */
export function nonFiniteDatum(
  ...data: ReadonlyArray<ReadonlyArray<Expression>>
): Expression | null {
  for (const vals of data)
    for (const v of vals) if (!(isNumber(v) && v.isFinite === true)) return v;
  return null;
}

/**
 * True when `v` has an infinite imaginary part, i.e. it is the complex
 * infinity `~oo` under one of its spellings.
 *
 * The real part such a value reports is an artifact of the spelling —
 * `ComplexInfinity` reports `Infinity`, `Complex(1, Infinity)` reports `1` —
 * so no statistic may read it. Callers either project it to `NaN` (see
 * `realProjection`) or answer `NaN` outright.
 */
export function hasNonFiniteImaginaryPart(v: Expression): boolean {
  const n = numberLiteralOf(v);
  return n !== undefined && !Number.isFinite(n.im);
}

/**
 * The real number the real-valued statistics kernels read from a datum, or
 * `NaN` when the datum has no real value.
 *
 * This is the ONE projection every real-valued path goes through — the
 * machine and bignum kernels of the bivariate statistics, the univariate
 * float/bignum kernels, and the binning of `Histogram`/`BinCounts`. Routing
 * them all through it is what keeps the two spellings of the complex infinity
 * `~oo` from being read differently: `ComplexInfinity` reports a real part of
 * `Infinity` and `Complex(1, Infinity)` reports `1`, so reading `.re` made the
 * same value answer `Mean([1, ~oo, 5])` as `+oo` under one spelling and as
 * `2.33…` under the other. Neither is a reading of the data; `NaN` is.
 *
 * A `NaN` propagates on its own through the kernels that SUM their data. The
 * ORDER-based heads need an explicit test, because a `NaN` sort key does not
 * propagate through a comparison — see `hasValuelessDatum` in
 * `library/statistics.ts`.
 *
 * A real `±∞` still passes through unchanged, so the `±∞` data behavior is
 * untouched.
 *
 * `numberLiteralOf` rather than a bare `.N()`: a datum carrying a free
 * variable has no numeric value, so numericizing it is pure waste (and
 * exponential over nested applications).
 */
export function realProjection(v: Expression): number {
  const n = numberLiteralOf(v);
  if (!n || !Number.isFinite(n.im)) return NaN;
  return n.re;
}
