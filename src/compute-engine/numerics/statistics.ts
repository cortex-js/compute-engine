import { BigDecimal } from '../../big-decimal';

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
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0)
    return sorted[mid - 1].add(sorted[mid]).div(BigDecimal.TWO);
  return sorted[mid];
}

export function variance(values: Iterable<number>): number {
  let sum = 0;
  let sum2 = 0;
  let count = 0;
  for (const op of values) {
    sum += op;
    sum2 += op * op;
    count++;
  }
  if (count === 0) return NaN;
  return (sum2 - (sum * sum) / count) / (count - 1);
}

export function bigVariance(values: Iterable<BigDecimal>): BigDecimal {
  let sum = BigDecimal.ZERO;
  let sum2 = BigDecimal.ZERO;
  let count = 0;
  for (const op of values) {
    sum = sum.add(op);
    sum2 = sum2.add(op.mul(op));
    count++;
  }
  if (count === 0) return BigDecimal.NAN;
  return sum2
    .sub(sum.mul(sum).div(new BigDecimal(count)))
    .div(new BigDecimal(count - 1));
}

export function populationVariance(values: Iterable<number>): number {
  let sum = 0;
  let sum2 = 0;
  let count = 0;
  for (const op of values) {
    sum += op;
    sum2 += op * op;
    count++;
  }
  if (count === 0) return NaN;
  return (sum2 - (sum * sum) / count) / count;
}

export function bigPopulationVariance(
  values: Iterable<BigDecimal>
): BigDecimal {
  let sum = BigDecimal.ZERO;
  let sum2 = BigDecimal.ZERO;
  let count = 0;
  for (const op of values) {
    sum = sum.add(op);
    sum2 = sum2.add(op.mul(op));
    count++;
  }
  if (count === 0) return BigDecimal.NAN;
  return sum2
    .sub(sum.mul(sum).div(new BigDecimal(count)))
    .div(new BigDecimal(count));
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
export function quartiles(values: Iterable<number>): [number, number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
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
//

function covImpl(
  xsI: Iterable<number>,
  ysI: Iterable<number>,
  population: boolean
): number {
  const xs = [...xsI];
  const ys = [...ysI];
  const n = xs.length;
  if (n !== ys.length || n < 2) return NaN;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxy += xs[i] * ys[i];
  }
  return (sxy - (sx * sy) / n) / (population ? n : n - 1);
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
  let sx = BigDecimal.ZERO;
  let sy = BigDecimal.ZERO;
  let sxy = BigDecimal.ZERO;
  for (let i = 0; i < n; i++) {
    sx = sx.add(xs[i]);
    sy = sy.add(ys[i]);
    sxy = sxy.add(xs[i].mul(ys[i]));
  }
  return sxy
    .sub(sx.mul(sy).div(new BigDecimal(n)))
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

export function correlation(
  xsI: Iterable<number>,
  ysI: Iterable<number>
): number {
  const xs = [...xsI];
  const ys = [...ysI];
  const n = xs.length;
  if (n !== ys.length || n < 2) return NaN;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sx2 = 0;
  let sy2 = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxy += xs[i] * ys[i];
    sx2 += xs[i] * xs[i];
    sy2 += ys[i] * ys[i];
  }
  const cov = sxy - (sx * sy) / n;
  const vx = sx2 - (sx * sx) / n;
  const vy = sy2 - (sy * sy) / n;
  const d = Math.sqrt(vx * vy);
  if (d === 0) return NaN; // zero variance → correlation undefined
  return cov / d;
}

export function bigCorrelation(
  xsI: Iterable<BigDecimal>,
  ysI: Iterable<BigDecimal>
): BigDecimal {
  const xs = [...xsI];
  const ys = [...ysI];
  const n = xs.length;
  if (n !== ys.length || n < 2) return BigDecimal.NAN;
  let sx = BigDecimal.ZERO;
  let sy = BigDecimal.ZERO;
  let sxy = BigDecimal.ZERO;
  let sx2 = BigDecimal.ZERO;
  let sy2 = BigDecimal.ZERO;
  for (let i = 0; i < n; i++) {
    sx = sx.add(xs[i]);
    sy = sy.add(ys[i]);
    sxy = sxy.add(xs[i].mul(ys[i]));
    sx2 = sx2.add(xs[i].mul(xs[i]));
    sy2 = sy2.add(ys[i].mul(ys[i]));
  }
  const bn = new BigDecimal(n);
  const cov = sxy.sub(sx.mul(sy).div(bn));
  const vx = sx2.sub(sx.mul(sx).div(bn));
  const vy = sy2.sub(sy.mul(sy).div(bn));
  const d = vx.mul(vy).sqrt();
  if (d.isZero()) return BigDecimal.NAN;
  return cov.div(d);
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
