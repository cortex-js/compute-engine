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

/** Welford's running mean and sum of squared deviations over a stream. */
function welford(values: Iterable<number>): { n: number; m2: number } {
  let n = 0;
  let mean = 0;
  let m2 = 0;
  for (const x of values) {
    n += 1;
    const before = x - mean;
    mean += before / n;
    m2 += before * (x - mean);
  }
  return { n, m2 };
}

function bigWelford(values: Iterable<BigDecimal>): {
  n: number;
  m2: BigDecimal;
} {
  let n = 0;
  let mean = BigDecimal.ZERO;
  let m2 = BigDecimal.ZERO;
  for (const x of values) {
    n += 1;
    const before = x.sub(mean);
    mean = mean.add(before.div(new BigDecimal(n)));
    m2 = m2.add(before.mul(x.sub(mean)));
  }
  return { n, m2 };
}

function varImpl(values: Iterable<number>, population: boolean): number {
  const { n, m2 } = welford(values);
  if (n === 0) return NaN;
  return m2 / (population ? n : n - 1);
}

function bigVarImpl(
  values: Iterable<BigDecimal>,
  population: boolean
): BigDecimal {
  const { n, m2 } = bigWelford(values);
  if (n === 0) return BigDecimal.NAN;
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
  return Math.sqrt(variance(values));
}

export function bigStandardDeviation(values: Iterable<BigDecimal>): BigDecimal {
  return bigVariance(values).sqrt();
}

export function populationStandardDeviation(values: Iterable<number>): number {
  return Math.sqrt(populationVariance(values));
}

export function bigPopulationStandardDeviation(
  values: Iterable<BigDecimal>
): BigDecimal {
  return bigPopulationVariance(values).sqrt();
}

export function kurtosis(values: Iterable<number>): number {
  let sum = 0;
  let sum2 = 0;
  let sum3 = 0;
  let sum4 = 0;
  let count = 0;
  for (const op of values) {
    const v = op;
    if (!Number.isFinite(v)) return NaN;
    sum += v;
    sum2 += v * v;
    sum3 += v * v * v;
    sum4 += v * v * v * v;
    count++;
  }
  if (count === 0) return NaN;
  const n = count;
  const m = sum / n;
  // Central moments: m2 = (1/n)Σ(x−m)², m4 = (1/n)Σ(x−m)⁴.
  const m2 = (sum2 - (sum * sum) / n) / n;
  const m4 =
    (sum4 -
      4 * m * sum3 +
      6 * m * m * sum2 -
      4 * m * m * m * sum +
      n * m * m * m * m) /
    n;
  // Non-excess kurtosis β₂ = m4 / m2² (a normal distribution gives 3).
  return m4 / (m2 * m2);
}

export function bigKurtosis(values: Iterable<BigDecimal>): BigDecimal {
  let sum = BigDecimal.ZERO;
  let sum2 = BigDecimal.ZERO;
  let sum3 = BigDecimal.ZERO;
  let sum4 = BigDecimal.ZERO;
  let count = 0;
  for (const op of values) {
    const v = op;
    if (!v.isFinite()) return BigDecimal.NAN;
    sum = sum.add(v);
    sum2 = sum2.add(v.mul(v));
    sum3 = sum3.add(v.mul(v).mul(v));
    sum4 = sum4.add(v.mul(v).mul(v).mul(v));
    count++;
  }
  if (count === 0) return BigDecimal.NAN;
  const m = sum.div(count); // mean
  // Central moments: m2 = (1/n)Σ(x−m)², m4 = (1/n)Σ(x−m)⁴.
  const m2 = sum2.sub(sum.mul(sum).div(count)).div(count);
  const m4 = sum4
    .sub(m.mul(sum3).mul(4))
    .add(m.mul(m).mul(sum2).mul(6))
    .sub(m.mul(m).mul(m).mul(sum).mul(4))
    .add(m.mul(m).mul(m).mul(m).mul(count))
    .div(count);
  // Non-excess kurtosis β₂ = m4 / m2² (a normal distribution gives 3).
  return m4.div(m2.mul(m2));
}

export function skewness(values: Iterable<number>): number {
  let sum = 0;
  let sum2 = 0;
  let sum3 = 0;
  let count = 0;
  for (const op of values) {
    const v = op;
    if (!Number.isFinite(v)) return NaN;
    sum += v;
    sum2 += v * v;
    sum3 += v * v * v;
    count++;
  }
  if (count === 0) return NaN;
  const n = count;
  const m = sum / n;
  // Central moments: m2 = (1/n)Σ(x−m)², m3 = (1/n)Σ(x−m)³.
  const m2 = (sum2 - (sum * sum) / n) / n;
  const m3 = (sum3 - 3 * m * sum2 + 3 * m * m * sum - n * m * m * m) / n;
  // Moment coefficient of skewness g₁ = m3 / m2^(3/2).
  return m3 / Math.pow(m2, 3 / 2);
}

export function bigSkewness(values: Iterable<BigDecimal>): BigDecimal {
  let sum = BigDecimal.ZERO;
  let sum2 = BigDecimal.ZERO;
  let sum3 = BigDecimal.ZERO;
  let count = 0;
  for (const op of values) {
    const v = op;
    if (!v.isFinite()) return BigDecimal.NAN;
    sum = sum.add(v);
    sum2 = sum2.add(v.mul(v));
    sum3 = sum3.add(v.mul(v).mul(v));
    count++;
  }
  if (count === 0) return BigDecimal.NAN;
  const m = sum.div(count); // mean
  // Central moments: m2 = (1/n)Σ(x−m)², m3 = (1/n)Σ(x−m)³.
  const m2 = sum2.sub(sum.mul(sum).div(count)).div(count);
  const m3 = sum3
    .sub(m.mul(sum2).mul(3))
    .add(m.mul(m).mul(sum).mul(3))
    .sub(m.mul(m).mul(m).mul(count))
    .div(count);
  // Moment coefficient of skewness g₁ = m3 / m2^(3/2) = m3 / (m2·√m2).
  return m3.div(m2.mul(m2.sqrt()));
}

export function mode(values: Iterable<number>): number {
  const counts: Record<number, number> = {};
  for (const v of values) {
    counts[v] = (counts[v] ?? 0) + 1;
  }
  let max = 0;
  let mode = NaN;
  for (const v in counts) {
    const c = counts[v];
    if (c > max) {
      max = c;
      mode = +v;
    }
  }
  return mode;
}

export function bigMode(values: Iterable<BigDecimal>): BigDecimal {
  const counts: Record<string, number> = {};
  for (const v of values) {
    counts[v.toString()] = (counts[v.toString()] ?? 0) + 1;
  }
  let max = 0;
  let mode = BigDecimal.NAN;
  for (const v in counts) {
    const c = counts[v];
    if (c > max) {
      max = c;
      mode = new BigDecimal(v);
    }
  }
  return mode;
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
 * invariant under that scaling, so `correlation` asks for it; a covariance
 * is not, so the covariance kernels take the unscaled sums.
 */
function pairedCenteredSums(
  xs: readonly number[],
  ys: readonly number[],
  scaled = false
): { dx: number; dy: number; dxy: number; dx2: number; dy2: number } {
  const n = xs.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sx = 1;
  let sy = 1;
  if (scaled) {
    let ax = 0;
    let ay = 0;
    for (let i = 0; i < n; i++) {
      ax = Math.max(ax, Math.abs(xs[i] - mx));
      ay = Math.max(ay, Math.abs(ys[i] - my));
    }
    // A constant column (all deviations 0) keeps the scale 1: its sums are
    // 0 either way, and the caller reports the zero variance.
    if (ax > 0 && Number.isFinite(ax)) sx = 2 ** Math.floor(Math.log2(ax));
    if (ay > 0 && Number.isFinite(ay)) sy = 2 ** Math.floor(Math.log2(ay));
  }
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
  return { dx, dy, dxy, dx2, dy2 };
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
  const { dx, dy, dxy } = pairedCenteredSums(xs, ys);
  return (dxy - (dx * dy) / n) / (population ? n : n - 1);
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
