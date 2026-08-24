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
  return ce.error(
    ['incompatible-type', 'real', datum.type.toString()],
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
