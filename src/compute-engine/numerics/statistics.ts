import { BigDecimal } from '../../big-decimal/index.js';

export function mean(values: Iterable<number>): number {
  let sum = 0;
  let count = 0;
  for (const op of values) {
    sum += op;
    count++;
  }
  if (count === 0) return NaN;
  return sum / count;
}

export function bigMean(values: Iterable<BigDecimal>): BigDecimal {
  let sum = BigDecimal.ZERO;
  let count = 0;
  for (const op of values) {
    sum = sum.add(op);
    count++;
  }
  if (count === 0) return BigDecimal.NAN;
  return sum.div(new BigDecimal(count));
}

export function median(values: Iterable<number>): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

export function bigMedian(values: Iterable<BigDecimal>): BigDecimal {
  const sorted = [...values].sort((a, b) => a.cmp(b));
  // Median of nothing is NaN — matching `median([])`, whose
  // `sorted[-1] + sorted[0]` arithmetic yields NaN naturally. Without this,
  // `bigQuartiles` of a SINGLE datum crashed: its lower/upper halves are
  // empty, and `sorted[-1].add` is a TypeError (`Quartiles(2.5)` threw).
  if (sorted.length === 0) return BigDecimal.NAN;
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0)
    return sorted[mid - 1].add(sorted[mid]).div(BigDecimal.TWO);
  return sorted[mid];
}

//
// Variance is accumulated with Welford's update — one pass, constant memory,
// numerically stable: each value updates the running mean and the running
// sum of squared deviations `M2` through its deviation from the mean BEFORE
// and AFTER the update, so no two nearly equal quantities are ever
// subtracted. The former one-pass form `Σx² − (Σx)²/n` did exactly that when
// the data sit far from zero (`[10⁸ + 1, 10⁸ + 2, 10⁸ + 3]` has variance 1
// and sums near 3·10¹⁶, and answered 0 at machine precision). The stream is
// consumed once, so a lazy iterable is never buffered. Same shape for the
// `BigDecimal` twin, so the two precisions agree on which inputs they can
// resolve.
//

/**
 * Welford's running mean and sum of squared deviations over a stream.
 *
 * The deviation `x − mean` of two finite numbers of opposite signs can
 * overflow (`1e308 − (−1e308)`), and the update then gave an infinite mean
 * and a NEGATIVE `M2`: the variance of `[1e308, −1e308]` was `−∞`. `M2`
 * itself can overflow while the variance fits (the population variance of
 * `[1e154, −1e154]` is `1e308`). From the first update that would overflow
 * on, the update runs on the data divided by `scale`,
 * the largest magnitude seen (the mean and `M2` are converted to those
 * units, and again when a larger magnitude comes). `scale` is returned
 * with `M2` (0 when the data never left the first branch), and the caller
 * divides `M2` by the count before it multiplies by `scale²`, which gives
 * `+∞` only when the variance itself is past the largest number. Data whose deviations do not overflow never leaves the first
 * branch, so its result is the same as before, bit for bit.
 */
function welford(values: Iterable<number>): {
  n: number;
  m2: number;
  scale: number;
} {
  let n = 0;
  let mean = 0;
  let m2 = 0;
  // 0 while the update runs on the data as it is; otherwise the unit that
  // `mean` and `m2` are held in (`mean / scale`, `m2 / scale²`).
  let scale = 0;
  for (const x of values) {
    n += 1;
    if (scale === 0) {
      const before = x - mean;
      const nextMean = mean + before / n;
      const nextM2 = m2 + before * (x - nextMean);
      if (Number.isFinite(nextM2) || !Number.isFinite(x)) {
        mean = nextMean;
        m2 = nextM2;
        continue;
      }
      scale = Math.max(Math.abs(x), Math.abs(mean));
      mean /= scale;
      m2 = m2 / scale / scale;
    } else if (Math.abs(x) > scale) {
      const ratio = scale / Math.abs(x);
      mean *= ratio;
      m2 *= ratio * ratio;
      scale = Math.abs(x);
    }
    const scaled = x / scale;
    const before = scaled - mean;
    mean += before / n;
    m2 += before * (scaled - mean);
  }
  return { n, m2, scale };
}

function bigWelford(values: Iterable<BigDecimal>): {
  n: number;
  m2: BigDecimal;
} {
  let n = 0;
  let mean = BigDecimal.ZERO;
  let m2 = BigDecimal.ZERO;
  let first: BigDecimal | undefined;
  let allEqual = true;
  for (const x of values) {
    n += 1;
    // A datum that is not finite keeps the result of the update (`NaN`), as
    // in `welford()`: `[NaN]` and `[∞, ∞]` have no variance.
    if (!x.isFinite()) allEqual = false;
    else if (first === undefined) first = x;
    else if (allEqual && !x.eq(first)) allEqual = false;
    const before = x.sub(mean);
    mean = mean.add(before.div(new BigDecimal(n)));
    m2 = m2.add(before.mul(x.sub(mean)));
  }
  // When all the data are equal, every deviation from the mean is zero, so
  // the sum of squared deviations is exactly zero. The update above can give
  // a small value that is not zero: a division rounds to the working
  // precision, and a datum such as `√2` has more digits than that, so the
  // running mean of `[√2]` is not `√2` exactly.
  if (allEqual) m2 = BigDecimal.ZERO;
  return { n, m2 };
}

/**
 * The variance (or, with `root`, the standard deviation) from `welford()`.
 * The standard deviation of scaled data is `√(M2/d)·scale`, which fits where
 * the variance does not (`[1e200, −1e200]`).
 */
function varImpl(
  values: Iterable<number>,
  population: boolean,
  root = false
): number {
  const { n, m2, scale } = welford(values);
  if (n === 0) return NaN;
  const v = m2 / (population ? n : n - 1);
  if (root) return scale === 0 ? Math.sqrt(v) : Math.sqrt(v) * scale;
  return scale === 0 ? v : v * scale * scale;
}

function bigVarImpl(
  values: Iterable<BigDecimal>,
  population: boolean
): BigDecimal {
  const { n, m2 } = bigWelford(values);
  if (n === 0) return BigDecimal.NAN;
  // The sample variance of one datum is `0/0`, which has no value: `NaN`,
  // as the machine version and the exact route give.
  if (n === 1 && !population) return BigDecimal.NAN;
  return m2.div(new BigDecimal(population ? n : n - 1));
}

export function variance(values: Iterable<number>): number {
  return varImpl(values, false);
}

export function bigVariance(values: Iterable<BigDecimal>): BigDecimal {
  return bigVarImpl(values, false);
}

export function populationVariance(values: Iterable<number>): number {
  return varImpl(values, true);
}

export function bigPopulationVariance(
  values: Iterable<BigDecimal>
): BigDecimal {
  return bigVarImpl(values, true);
}

export function standardDeviation(values: Iterable<number>): number {
  return varImpl(values, false, true);
}

export function bigStandardDeviation(values: Iterable<BigDecimal>): BigDecimal {
  return bigVariance(values).sqrt();
}

export function populationStandardDeviation(values: Iterable<number>): number {
  return varImpl(values, true, true);
}

export function bigPopulationStandardDeviation(
  values: Iterable<BigDecimal>
): BigDecimal {
  return bigPopulationVariance(values).sqrt();
}

//
// Skewness and kurtosis use the sums of the 2nd, 3rd and 4th powers of the
// deviations from the mean, `M2 = Σ(x − x̄)²`, `M3 = Σ(x − x̄)³` and
// `M4 = Σ(x − x̄)⁴`. These sums are not expanded into raw power sums
// (`Σx² − (Σx)²/n` and longer forms for `M3` and `M4`): when the data are
// far from zero compared with their spread, the raw sums are nearly equal
// and their difference loses all its digits (`[10⁸, 10⁸ + 1, 10⁸ + 3]` gave
// a skewness of about `1.16·10⁸`).
//
// Each datum is first replaced by its deviation from the first datum (the
// origin). This difference is exact when the two numbers are within a
// factor of 2 of each other, and otherwise it is a number of the size of
// the spread. The deviations are then accumulated in one pass with the
// update of Terriberry and Pébay, which extends Welford's update to the
// higher moments: each deviation changes the running mean and the running
// sums through its distance to the running mean, so the rounding errors are
// relative to the spread of the data, not to its size. A running mean held
// at the size of the data cannot take small increments
// (`10¹⁶ + 2/3` is not a double), which is why the origin is subtracted
// first. The stream is consumed once, so a lazy iterable is never buffered.
// The `BigDecimal` version has the same shape.
//
// Reference: P. Pébay, "Formulas for robust, one-pass parallel computation
// of covariances and arbitrary-order statistical moments", Sandia report
// SAND2008-6212 (2008).
//

/**
 * The count and the central-moment sums `M2`, `M3` and `M4` of a stream of
 * machine numbers, or `undefined` when the moment ratios have no value: the
 * stream is empty, a datum is not finite, or all the data are equal (one
 * datum included). When all the data are equal, every deviation from the
 * mean is zero, so the moment ratio is `0/0`, which has no value: `NaN`. The test is made on the data, the
 * same test as in `bigCentralMoments()`. In that version, the update can
 * give a small `M2` that is not zero: a division rounds to the working
 * precision, and a datum such as `√2` has more digits than that.
 *
 * The sums are returned in units of `2^e`, for an exponent `e` that is not
 * returned: skewness and kurtosis do not change when all the deviations are
 * multiplied by the same factor. The unit is a power of 2 near the largest
 * deviation seen, so each scaled deviation is at most 1 in magnitude, and
 * no power of a deviation overflows or underflows. Without this, the cube
 * of the deviations of `[5·10¹⁰², −5·10¹⁰²]` overflows and the skewness is
 * `NaN`, not `0`. When a larger deviation comes, the sums are converted to
 * the new unit. A multiplication by a power of 2 is exact, so the unit does
 * not add a rounding error.
 */
function centralMoments(
  values: Iterable<number>
): { n: number; m2: number; m3: number; m4: number } | undefined {
  let n = 0;
  let origin = 0;
  // The exponent of the unit of the sums, or `undefined` while every
  // deviation from the origin is zero (the sums are then zero).
  let unit: number | undefined;
  let mean = 0;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let allEqual = true;
  for (const x of values) {
    if (!Number.isFinite(x)) return undefined;
    if (n === 0) origin = x;
    else if (x !== origin) allEqual = false;
    // The deviation from the origin is `y · 2^shift`. The difference of two
    // finite numbers of opposite signs can overflow (`10³⁰⁸ − (−10³⁰⁸)`),
    // and then the halves are subtracted.
    let y = x - origin;
    let shift = 0;
    if (!Number.isFinite(y)) {
      y = x / 2 - origin / 2;
      shift = 1;
    }
    if (y !== 0) {
      const e = Math.floor(Math.log2(Math.abs(y))) + 1 + shift;
      if (unit === undefined) unit = e;
      else if (e > unit) {
        const k = unit - e;
        mean = scaleByPowerOfTwo(mean, k);
        m2 = scaleByPowerOfTwo(m2, 2 * k);
        m3 = scaleByPowerOfTwo(m3, 3 * k);
        m4 = scaleByPowerOfTwo(m4, 4 * k);
        unit = e;
      }
    }
    const u = unit === undefined ? 0 : scaleByPowerOfTwo(y, shift - unit);
    const before = n;
    n += 1;
    const delta = u - mean;
    const deltaN = delta / n;
    const deltaN2 = deltaN * deltaN;
    const term = delta * deltaN * before;
    mean += deltaN;
    // `M4` uses the values of `M2` and `M3` before this update, and `M3`
    // uses the value of `M2` before this update.
    m4 +=
      term * deltaN2 * (n * n - 3 * n + 3) + 6 * deltaN2 * m2 - 4 * deltaN * m3;
    m3 += term * deltaN * (n - 2) - 3 * deltaN * m2;
    m2 += term;
  }
  if (n === 0 || allEqual) return undefined;
  return { n, m2, m3, m4 };
}

/**
 * The `BigDecimal` version of `centralMoments()`, with the same update, the
 * same origin and the same cases without a value. The subtraction of the
 * origin is exact (`sub()` does not round to the working precision), so
 * data such as `[10⁵⁰ + 1, 10⁵⁰ + 2, 10⁵⁰ + 3]` at 50 digits give the
 * deviations `[0, 1, 2]` exactly. A `BigDecimal` does not overflow, so the
 * sums are not scaled.
 */
function bigCentralMoments(
  values: Iterable<BigDecimal>
): { n: number; m2: BigDecimal; m3: BigDecimal; m4: BigDecimal } | undefined {
  let n = 0;
  let origin = BigDecimal.ZERO;
  let mean = BigDecimal.ZERO;
  let m2 = BigDecimal.ZERO;
  let m3 = BigDecimal.ZERO;
  let m4 = BigDecimal.ZERO;
  let allEqual = true;
  for (const x of values) {
    if (!x.isFinite()) return undefined;
    if (n === 0) origin = x;
    else if (allEqual && !x.eq(origin)) allEqual = false;
    const before = n;
    n += 1;
    const count = new BigDecimal(n);
    const delta = x.sub(origin).sub(mean);
    const deltaN = delta.div(count);
    const deltaN2 = deltaN.mul(deltaN);
    const term = delta.mul(deltaN).mul(before);
    mean = mean.add(deltaN);
    // `M4` uses the values of `M2` and `M3` before this update, and `M3`
    // uses the value of `M2` before this update. The coefficient
    // `n² − 3n + 3` is computed as a `BigDecimal`, because in doubles `n²`
    // is not exact when `n` is more than about 9.5·10⁷.
    const coefficient = count.mul(count).sub(count.mul(3)).add(3);
    m4 = m4
      .add(term.mul(deltaN2).mul(coefficient))
      .add(deltaN2.mul(m2).mul(6))
      .sub(deltaN.mul(m3).mul(4));
    m3 = m3.add(term.mul(deltaN).mul(n - 2)).sub(deltaN.mul(m2).mul(3));
    m2 = m2.add(term);
  }
  if (n === 0 || allEqual) return undefined;
  return { n, m2, m3, m4 };
}

export function kurtosis(values: Iterable<number>): number {
  const moments = centralMoments(values);
  if (moments === undefined) return NaN;
  const { n } = moments;
  // Central moments: m2 = (1/n)Σ(x−m)², m4 = (1/n)Σ(x−m)⁴.
  const m2 = moments.m2 / n;
  const m4 = moments.m4 / n;
  // Non-excess kurtosis β₂ = m4 / m2² (a normal distribution gives 3).
  return m4 / (m2 * m2);
}

export function bigKurtosis(values: Iterable<BigDecimal>): BigDecimal {
  const moments = bigCentralMoments(values);
  if (moments === undefined) return BigDecimal.NAN;
  const { n } = moments;
  // Central moments: m2 = (1/n)Σ(x−m)², m4 = (1/n)Σ(x−m)⁴.
  const m2 = moments.m2.div(n);
  const m4 = moments.m4.div(n);
  // Non-excess kurtosis β₂ = m4 / m2² (a normal distribution gives 3).
  return m4.div(m2.mul(m2));
}

export function skewness(values: Iterable<number>): number {
  const moments = centralMoments(values);
  if (moments === undefined) return NaN;
  const { n } = moments;
  // Central moments: m2 = (1/n)Σ(x−m)², m3 = (1/n)Σ(x−m)³.
  const m2 = moments.m2 / n;
  const m3 = moments.m3 / n;
  // Moment coefficient of skewness g₁ = m3 / m2^(3/2).
  return m3 / Math.pow(m2, 3 / 2);
}

export function bigSkewness(values: Iterable<BigDecimal>): BigDecimal {
  const moments = bigCentralMoments(values);
  if (moments === undefined) return BigDecimal.NAN;
  const { n } = moments;
  // Central moments: m2 = (1/n)Σ(x−m)², m3 = (1/n)Σ(x−m)³.
  const m2 = moments.m2.div(n);
  const m3 = moments.m3.div(n);
  // Moment coefficient of skewness g₁ = m3 / m2^(3/2) = m3 / (m2·√m2).
  return m3.div(m2.mul(m2.sqrt()));
}

/**
 * The most frequent value of a machine sample. Among values that occur
 * equally often, the SMALLEST one is the mode, the same tie rule as the exact
 * kernel (`exactMode` in `library/statistics.ts`), so `evaluate()` and `.N()`
 * agree on which value wins a tie.
 *
 * Two data count together only when their doubles are equal. That is the
 * precision of the sample: two machine values that differ in the last bit
 * are two values. (`0` and `-0` count together, and so do two `NaN`.)
 */
export function mode(values: Iterable<number>): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let max = 0;
  let mode = NaN;
  for (const [v, c] of counts) {
    // `NaN` compares false with everything, so a `NaN` candidate loses every
    // tie and a `NaN` datum wins only with a strictly higher count.
    if (c > max || (c === max && (v < mode || Number.isNaN(mode)))) {
      max = c;
      mode = v;
    }
  }
  return mode;
}

/**
 * The most frequent value of a big-decimal sample, with the same tie rule as
 * `mode`: the smallest value among the most frequent ones.
 *
 * Two data count together when they agree within the working precision
 * (`BigDecimal.precision`, p significant digits): when `|a - b|` is less
 * than `max(|a|, |b|) · 10^(1-p)`. Two spellings of one real value, such as
 * `ln 6` and `ln 2 + ln 3`, are computed by different operations and can
 * differ by a few units in the last digit; a comparison of the digits would
 * count them apart. Each group of equal values is anchored on its smallest
 * member, so a chain of values that each differ from the next by less than
 * the tolerance does not merge into one group.
 */
export function bigMode(values: Iterable<BigDecimal>): BigDecimal {
  const sorted = [...values].sort((x, y) => {
    // `NaN` sorts last: `cmp` answers `NaN` for it, which `sort` cannot use.
    if (x.isNaN()) return y.isNaN() ? 0 : 1;
    if (y.isNaN()) return -1;
    return x.cmp(y);
  });
  const epsilon = new BigDecimal(`1e${1 - BigDecimal.precision}`);
  const same = (a: BigDecimal, b: BigDecimal): boolean => {
    if (a.isNaN() || b.isNaN()) return a.isNaN() && b.isNaN();
    // Equal infinities: their difference is `NaN`, not zero.
    if (a.eq(b)) return true;
    if (!a.isFinite() || !b.isFinite()) return false;
    const scale = a.abs().gt(b.abs()) ? a.abs() : b.abs();
    return a.sub(b).abs().lt(scale.mul(epsilon));
  };
  let best: { count: number; val: BigDecimal } | undefined;
  let run: { count: number; val: BigDecimal } | undefined;
  for (const v of sorted) {
    if (run !== undefined && same(run.val, v)) run.count += 1;
    else run = { count: 1, val: v };
    // Strictly greater: an earlier run (a smaller value) keeps a tie.
    if (best === undefined || run.count > best.count) best = run;
  }
  return best ? best.val : BigDecimal.NAN;
}

// Quartile convention: Moore–McCabe (a.k.a. Tukey's exclusive hinges for the
// "exclude the median" variant) — split the sorted sample at its median and
// take Q1/Q3 as the medians of the *lower*/*upper* halves, excluding the
// overall median itself from either half when n is odd. This keeps Q1 and Q3
// symmetric around the median (Q1 + Q3 = 2·Q2 for symmetric data), unlike a
// mixed slicing that includes the median in only one half.
//
// A ONE-POINT sample is the convention's degenerate case and is answered
// directly: excluding the overall median leaves both halves empty, so the
// split would take the median of nothing and report `NaN` for Q1 and Q3.
// A single datum is its own lower quartile, median and upper quartile — the
// answer NumPy's `percentile([x], [25, 50, 75])` gives — which also makes
// `InterquartileRange` of one datum `0` rather than unknown.
export function quartiles(values: Iterable<number>): [number, number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) return [sorted[0], sorted[0], sorted[0]];
  const mid = Math.floor(n / 2);
  const upperStart = mid + (n % 2);

  const q1 = median(sorted.slice(0, mid));
  const q2 = median(sorted);
  const q3 = median(sorted.slice(upperStart));

  return [q1, q2, q3];
}

export function bigQuartiles(
  values: Iterable<BigDecimal>
): [BigDecimal, BigDecimal, BigDecimal] {
  const sorted = [...values].sort((a, b) => a.cmp(b));
  const n = sorted.length;
  // Same one-point convention as `quartiles()` above.
  if (n === 1) return [sorted[0], sorted[0], sorted[0]];
  const mid = Math.floor(n / 2);
  const upperStart = mid + (n % 2);

  const q1 = bigMedian(sorted.slice(0, mid));
  const q2 = bigMedian(sorted);
  const q3 = bigMedian(sorted.slice(upperStart));

  return [q1, q2, q3];
}

//
// Covariance / correlation. `xs` and `ys` are paired, equal-length samples.
// `covariance` uses the sample (n − 1) denominator; `populationCovariance` the
// n denominator — mirroring the `variance`/`populationVariance` pair.
// Pearson's `correlation` is denominator-independent (the factor cancels), so
// there is no population variant. A length mismatch or n < 2 yields `NaN`
// (the library validates and turns these into error nodes before calling).
// The paired samples are materialized (a length check needs both), then
// summed in two passes: the means first, then the centered cross sum
// `Σ dx·dy` and the centered squares, with the compensation terms
// `(Σdx)(Σdy)/n` and `(Σd)²/n` that absorb the rounding of the means. The
// one-pass form `Σxy − ΣxΣy/n` pushed a two-point sample's r past ±1 by
// 7·10⁻¹³ at machine precision.
//

/**
 * The centered sums of two paired samples: `Σdx`, `Σdy`, `Σdx·dy`, `Σdx²`
 * and `Σdy²`, with `dx = x − mean(x)` and `dy = y − mean(y)`.
 *
 * With `scaled`, each column's deviations are divided by a POWER OF TWO
 * near the column's largest absolute deviation first, so every centered
 * value lies in [−2, 2] and the squares cannot overflow or underflow for
 * data of machine range (`[10²⁰⁰, 2·10²⁰⁰, 3·10²⁰⁰]`, `[10⁻¹⁵⁰, …]`). A
 * power of two is exact to divide by, so the scaling adds no rounding of
 * its own (a two-point sample keeps r = ±1 exactly). Pearson's r is
 * invariant under that scaling; a covariance is not, so the covariance
 * kernel multiplies the scales back into its result (`covImpl`). The scales
 * are returned for that purpose.
 */
function pairedCenteredSums(
  xs: readonly number[],
  ys: readonly number[],
  scaled = false
): {
  dx: number;
  dy: number;
  dxy: number;
  dx2: number;
  dy2: number;
  /** The binary exponents of the two scales (`sx = 2^ex`, `sy = 2^ey`). */
  ex: number;
  ey: number;
} {
  const n = xs.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let ex = 0;
  let ey = 0;
  if (scaled) {
    let ax = 0;
    let ay = 0;
    for (let i = 0; i < n; i++) {
      ax = Math.max(ax, Math.abs(xs[i] - mx));
      ay = Math.max(ay, Math.abs(ys[i] - my));
    }
    // A constant column (all deviations 0) keeps the scale 1: its sums are
    // 0 either way, and the caller reports the zero variance.
    if (ax > 0 && Number.isFinite(ax)) ex = Math.floor(Math.log2(ax));
    if (ay > 0 && Number.isFinite(ay)) ey = Math.floor(Math.log2(ay));
  }
  const sx = 2 ** ex;
  const sy = 2 ** ey;
  let dx = 0;
  let dy = 0;
  let dxy = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const a = (xs[i] - mx) / sx;
    const b = (ys[i] - my) / sy;
    dx += a;
    dy += b;
    dxy += a * b;
    dx2 += a * a;
    dy2 += b * b;
  }
  return { dx, dy, dxy, dx2, dy2, ex, ey };
}

function bigPairedCenteredSums(
  xs: readonly BigDecimal[],
  ys: readonly BigDecimal[]
): {
  dx: BigDecimal;
  dy: BigDecimal;
  dxy: BigDecimal;
  dx2: BigDecimal;
  dy2: BigDecimal;
} {
  const n = xs.length;
  let mx = BigDecimal.ZERO;
  let my = BigDecimal.ZERO;
  for (let i = 0; i < n; i++) {
    mx = mx.add(xs[i]);
    my = my.add(ys[i]);
  }
  const bn = new BigDecimal(n);
  mx = mx.div(bn);
  my = my.div(bn);
  let dx = BigDecimal.ZERO;
  let dy = BigDecimal.ZERO;
  let dxy = BigDecimal.ZERO;
  let dx2 = BigDecimal.ZERO;
  let dy2 = BigDecimal.ZERO;
  for (let i = 0; i < n; i++) {
    const a = xs[i].sub(mx);
    const b = ys[i].sub(my);
    dx = dx.add(a);
    dy = dy.add(b);
    dxy = dxy.add(a.mul(b));
    dx2 = dx2.add(a.mul(a));
    dy2 = dy2.add(b.mul(b));
  }
  return { dx, dy, dxy, dx2, dy2 };
}

function covImpl(
  xsI: Iterable<number>,
  ysI: Iterable<number>,
  population: boolean
): number {
  const xs = [...xsI];
  const ys = [...ysI];
  const n = xs.length;
  if (n !== ys.length || n < 2) return NaN;
  // The sums are taken over the SCALED deviations, so a product of two
  // deviations cannot overflow while the covariance itself is of machine
  // range: with deviations `[10²⁰⁰, −10²⁰⁰, 0]` and `[10²⁰⁰, 10²⁰⁰, −2·10²⁰⁰]`
  // the covariance is 0, but the unscaled products are `±10⁴⁰⁰` and their
  // sum was `NaN`. The scales are powers of two, so scaling back is exact;
  // the result overflows only when the covariance has no double, which then
  // reads `±Infinity`, the machine answer for such a value.
  const { dx, dy, dxy, ex, ey } = pairedCenteredSums(xs, ys, true);
  const scaled = (dxy - (dx * dy) / n) / (population ? n : n - 1);
  return scaleByPowerOfTwo(scaled, ex + ey);
}

/**
 * `x · 2^e`, applied in steps of at most 2^±512 so that no step overflows or
 * underflows unless the result itself does. The two scales are applied
 * TOGETHER: applying one at a time overflowed an intermediate for a first
 * column near the double maximum and a second near the double minimum
 * (`[2¹⁰²³, −2¹⁰²³]` against `[2⁻¹⁰²³, −2⁻¹⁰²³]`, a covariance of 2), and
 * their product `2^ex · 2^ey` as one factor overflows when both are large
 * while the covariance is small.
 */
function scaleByPowerOfTwo(x: number, e: number): number {
  let r = x;
  while (e > 512) {
    r *= 2 ** 512;
    e -= 512;
  }
  while (e < -512) {
    r *= 2 ** -512;
    e += 512;
  }
  return r * 2 ** e;
}

function bigCovImpl(
  xsI: Iterable<BigDecimal>,
  ysI: Iterable<BigDecimal>,
  population: boolean
): BigDecimal {
  const xs = [...xsI];
  const ys = [...ysI];
  const n = xs.length;
  if (n !== ys.length || n < 2) return BigDecimal.NAN;
  const { dx, dy, dxy } = bigPairedCenteredSums(xs, ys);
  const bn = new BigDecimal(n);
  return dxy
    .sub(dx.mul(dy).div(bn))
    .div(new BigDecimal(population ? n : n - 1));
}

export function covariance(xs: Iterable<number>, ys: Iterable<number>): number {
  return covImpl(xs, ys, false);
}

export function bigCovariance(
  xs: Iterable<BigDecimal>,
  ys: Iterable<BigDecimal>
): BigDecimal {
  return bigCovImpl(xs, ys, false);
}

export function populationCovariance(
  xs: Iterable<number>,
  ys: Iterable<number>
): number {
  return covImpl(xs, ys, true);
}

export function bigPopulationCovariance(
  xs: Iterable<BigDecimal>,
  ys: Iterable<BigDecimal>
): BigDecimal {
  return bigCovImpl(xs, ys, true);
}

/**
 * Pearson's r, in [−1, 1]. The centered sums, scaled per column, keep the
 * rounding of `r` at a few ulps and survive data of machine range; the
 * final clip removes what is left: by the Cauchy–Schwarz inequality
 * |Σdx·dy| ≤ √(Σdx²·Σdy²) holds exactly, so any excess over 1 is rounding,
 * never data — the same remedy NumPy's `corrcoef` applies. This is what lets
 * the `Correlation` operator declare `real<-1..1>`. The denominator is
 * `√(vx·vy)`, which is exact for proportional data (`[1, 2, 3]` against
 * itself gives √4), where `√vx · √vy` rounds one ulp under. A column whose
 * centered squares are not positive — zero, or a tiny negative left by
 * rounding — is a constant column, and the answer is NaN, never a spurious
 * real number from a product of two negatives. The scaled sums keep the
 * product within the machine range.
 */
export function correlation(
  xsI: Iterable<number>,
  ysI: Iterable<number>
): number {
  const xs = [...xsI];
  const ys = [...ysI];
  const n = xs.length;
  if (n !== ys.length || n < 2) return NaN;
  const { dx, dy, dxy, dx2, dy2 } = pairedCenteredSums(xs, ys, true);
  const cov = dxy - (dx * dy) / n;
  const vx = dx2 - (dx * dx) / n;
  const vy = dy2 - (dy * dy) / n;
  if (!(vx > 0) || !(vy > 0)) return NaN; // zero variance → undefined
  return Math.min(1, Math.max(-1, cov / Math.sqrt(vx * vy)));
}

export function bigCorrelation(
  xsI: Iterable<BigDecimal>,
  ysI: Iterable<BigDecimal>
): BigDecimal {
  const xs = [...xsI];
  const ys = [...ysI];
  const n = xs.length;
  if (n !== ys.length || n < 2) return BigDecimal.NAN;
  const { dx, dy, dxy, dx2, dy2 } = bigPairedCenteredSums(xs, ys);
  const bn = new BigDecimal(n);
  const cov = dxy.sub(dx.mul(dy).div(bn));
  const vx = dx2.sub(dx.mul(dx).div(bn));
  const vy = dy2.sub(dy.mul(dy).div(bn));
  // As in `correlation`: a non-positive centered square is a constant column.
  if (!vx.gt(BigDecimal.ZERO) || !vy.gt(BigDecimal.ZERO)) return BigDecimal.NAN;
  const r = cov.div(vx.mul(vy).sqrt());
  if (r.gt(BigDecimal.ONE)) return BigDecimal.ONE;
  if (r.lt(BigDecimal.ONE.neg())) return BigDecimal.ONE.neg();
  return r;
}

export function interquartileRange(values: Iterable<number>): number {
  // IQR = Q3 − Q1, using the same quartile convention as `quartiles()`. (It
  // used to slice the upper half at `mid + 1` while `quartiles` slices at
  // `mid`, so `IQR` disagreed with `Q3 − Q1`.)
  const [q1, , q3] = quartiles(values);
  return q3 - q1;
}

export function bigInterquartileRange(
  values: Iterable<BigDecimal>
): BigDecimal {
  const [q1, , q3] = bigQuartiles(values);
  return q3.sub(q1);
}
